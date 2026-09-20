import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import { apiClient } from '../client'
import {
  adminApi,
  auditQuery,
  buildUyushmaCreateBody,
  buildUyushmaUpdateBody,
  diffSettings,
  localDateToUtcIso,
  mapAdminUyushma,
  mapAuditLog,
  mapClient,
  mapShift,
  normalizePhone,
  validateAdjustAmount,
  validateReason,
  validateSettings,
  type AdminShiftDto,
  type AuditLogDto,
  type UyushmaAdminReadDto,
} from '../adminApi'
import type { AdminSystemSettings } from '../../../types/admin'

const api = apiClient as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

const uyushmaDto: UyushmaAdminReadDto = {
  id: 1,
  name: 'Andijon Shahar Uyushmasi',
  code: 'AND-01',
  phone: '+998742230001',
  address: null,
  region: 'Andijon viloyati',
  contact_person: null,
  license_number: null,
  is_active: true,
  archived_at: null,
  archive_reason: null,
  created_at: '2026-09-19T12:57:57.342869Z',
  status: 'active',
  routes_count: 4,
  drivers_count: 4,
  vehicles_count: 4,
  admin_phone: '+998901234568',
}

const settingsDto: AdminSystemSettings = {
  gps_interval_seconds: 5,
  refund_window_minutes: 30,
  platform_commission_percent: 0,
  maintenance_mode: false,
  fcm_notifications_enabled: true,
  max_unassigned_vehicles: 50,
  min_topup_uzs: 1000,
  max_topup_uzs: 2_000_000,
  updated_at: null,
  updated_by: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('validation helpers', () => {
  it('normalizes Uzbek phone numbers like the backend', () => {
    expect(normalizePhone('+998 90 123 45 67')).toBe('+998901234567')
    expect(normalizePhone('901234567')).toBe('+998901234567')
    expect(normalizePhone('998901234567')).toBe('+998901234567')
    expect(normalizePhone('+99890123')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })

  it('requires audit reasons of 3..255 characters', () => {
    expect(validateReason('  abc  ')).toBe('abc')
    expect(() => validateReason('ab')).toThrow(/kamida 3/)
    expect(() => validateReason('x'.repeat(256))).toThrow(/255/)
  })

  it('validates wallet adjustment amounts (non-zero integer within ±10M)', () => {
    expect(validateAdjustAmount(-5000)).toBe(-5000)
    expect(() => validateAdjustAmount(0)).toThrow(/noldan/)
    expect(() => validateAdjustAmount(10_000_001)).toThrow()
    expect(() => validateAdjustAmount(1.5)).toThrow(/butun/)
  })

  it('mirrors SETTING_SPECS ranges and cross-checks top-up limits', () => {
    expect(validateSettings(settingsDto)).toEqual({})
    const errors = validateSettings({
      gps_interval_seconds: 1,
      platform_commission_percent: 20.5,
      refund_window_minutes: 1.5,
      min_topup_uzs: 5000,
      max_topup_uzs: 4000,
    })
    expect(errors.gps_interval_seconds).toBeDefined()
    expect(errors.platform_commission_percent).toBeDefined()
    expect(errors.refund_window_minutes).toMatch(/Butun/)
    expect(errors.min_topup_uzs).toMatch(/maksimal/)
    expect(validateSettings({ gps_interval_seconds: Number.NaN }).gps_interval_seconds).toBe('Son kiriting')
    // Only provided keys are validated
    expect(validateSettings({ maintenance_mode: true })).toEqual({})
  })

  it('diffs only the settings that changed', () => {
    expect(diffSettings(settingsDto, { ...settingsDto })).toEqual({})
    expect(diffSettings(settingsDto, { ...settingsDto, maintenance_mode: true, gps_interval_seconds: 10 })).toEqual({
      maintenance_mode: true,
      gps_interval_seconds: 10,
    })
  })

  it('converts local calendar dates to UTC day bounds', () => {
    expect(localDateToUtcIso('2026-09-19', 'start')).toBe(new Date(2026, 8, 19, 0, 0, 0, 0).toISOString())
    expect(localDateToUtcIso('2026-09-19', 'end')).toBe(new Date(2026, 8, 19, 23, 59, 59, 999).toISOString())
    expect(localDateToUtcIso('19.09.2026', 'start')).toBeUndefined()
  })
})

describe('Uyushma bodies', () => {
  it('builds UyushmaCreate with an admin account (all three fields)', () => {
    const body = buildUyushmaCreateBody({
      name: '  Asaka Uyushmasi ',
      code: 'ASK-01',
      phone: '+998 74 223 00 02',
      region: '',
      admin: { full_name: 'Ali Valiyev', phone: '90 555 11 22', password: 'secret123' },
    })
    expect(body).toEqual({
      name: 'Asaka Uyushmasi',
      code: 'ASK-01',
      phone: '+998742230002',
      address: null,
      region: null,
      contact_person: null,
      license_number: null,
      admin_full_name: 'Ali Valiyev',
      admin_phone: '+998905551122',
      admin_password: 'secret123',
    })
  })

  it('omits admin fields when no admin account is requested', () => {
    const body = buildUyushmaCreateBody({ name: 'Asaka', code: 'ASK', phone: '+998742230002', admin: null })
    expect(body).not.toHaveProperty('admin_phone')
    expect(body).not.toHaveProperty('admin_password')
    expect(body).not.toHaveProperty('admin_full_name')
  })

  it('rejects invalid code, phone and short admin password', () => {
    expect(() => buildUyushmaCreateBody({ name: 'Asaka', code: 'bad code', phone: '+998742230002' })).toThrow(/Kod/)
    expect(() => buildUyushmaCreateBody({ name: 'Asaka', code: 'ASK', phone: '123' })).toThrow(/telefoni/)
    expect(() =>
      buildUyushmaCreateBody({
        name: 'Asaka',
        code: 'ASK',
        phone: '+998742230002',
        admin: { full_name: 'Ali', phone: '+998905551122', password: 'short' },
      }),
    ).toThrow(/8 ta/)
  })

  it('builds UyushmaUpdate with only provided keys; empty optional text clears the field', () => {
    expect(buildUyushmaUpdateBody({ name: ' New ', address: '' })).toEqual({ name: 'New', address: null })
    expect(buildUyushmaUpdateBody({ phone: '742230003' })).toEqual({ phone: '+998742230003' })
  })
})

describe('mappers', () => {
  it('maps UyushmaAdminRead (ids to strings, nulls to undefined)', () => {
    const u = mapAdminUyushma(uyushmaDto)
    expect(u).toMatchObject({ id: '1', code: 'AND-01', status: 'active', admin_phone: '+998901234568', routes_count: 4 })
    expect(u.address).toBeUndefined()
    expect(mapAdminUyushma({ ...uyushmaDto, status: 'archived', archived_at: '2026-09-19T13:00:00Z', admin_phone: null })).toMatchObject({
      status: 'archived',
      admin_phone: undefined,
    })
  })

  it('maps clients keeping a missing last activity as null', () => {
    const c = mapClient({
      id: 7,
      phone: '+998901112233',
      full_name: 'Demo',
      wallet_balance: 50000,
      total_rides: 0,
      is_blocked: false,
      block_reason: null,
      last_active_at: null,
      created_at: '2026-09-19T12:58:02Z',
    })
    expect(c).toMatchObject({ id: '7', wallet_balance: 50000, last_active_at: null, block_reason: undefined })
  })

  it('maps live shifts including GPS age fields and direction', () => {
    const dto: AdminShiftDto = {
      id: 12,
      driver_id: 3,
      driver_name: 'Otabek',
      driver_phone: '+998901110001',
      uyushma_id: 1,
      uyushma_name: 'AND',
      vehicle_id: 4,
      vehicle_internal_id: 'AND-0004',
      vehicle_plate: null,
      route_id: 2,
      route_number: '12',
      direction: 'inbound',
      started_at: '2026-09-19T10:00:00Z',
      last_gps_at: null,
      is_online: false,
      current_lat: null,
      current_lng: null,
    }
    expect(mapShift(dto)).toMatchObject({
      id: '12',
      vehicle_plate: undefined,
      vehicle_internal_id: 'AND-0004',
      direction: 'inbound',
      last_gps_at: null,
      is_online: false,
      current_lat: null,
    })
  })

  it('maps audit logs with arbitrary JSON changes', () => {
    const dto: AuditLogDto = {
      id: 5,
      created_at: '2026-09-19T13:00:00Z',
      actor_user_id: 1,
      actor_name: 'Super Administrator',
      actor_role: 'super_admin',
      action: 'settings.update',
      target_type: 'settings',
      target_id: 'global',
      uyushma_id: null,
      reason: null,
      changes: { gps_interval_seconds: { old: 5, new: 10 } },
      ip_address: '127.0.0.1',
    }
    expect(mapAuditLog(dto)).toEqual({
      id: '5',
      created_at: '2026-09-19T13:00:00Z',
      actor_user_id: '1',
      actor_name: 'Super Administrator',
      actor_role: 'super_admin',
      action: 'settings.update',
      target_type: 'settings',
      target_id: 'global',
      uyushma_id: null,
      reason: null,
      changes: { gps_interval_seconds: { old: 5, new: 10 } },
      ip_address: '127.0.0.1',
    })
  })

  it('builds the audit query with UTC day bounds and defaults', () => {
    expect(auditQuery({ action: '  client. ', date_from: '2026-09-01', date_to: '2026-09-19', page: 2 })).toEqual({
      action: 'client.',
      target_type: undefined,
      actor_user_id: undefined,
      uyushma_id: undefined,
      date_from: localDateToUtcIso('2026-09-01', 'start'),
      date_to: localDateToUtcIso('2026-09-19', 'end'),
      page: 2,
      size: 50,
    })
  })
})

describe('adminApi requests', () => {
  it('GET /admin/kpis returns the real KPIs untouched', async () => {
    const kpis = {
      total_uyushmalar: 1,
      total_routes: 4,
      published_routes: 4,
      total_drivers: 4,
      total_vehicles: 4,
      active_shifts: 0,
      visible_vehicles: 0,
      total_clients: 1,
      total_parkings: 3,
      today_gross_revenue: 0,
      today_platform_commission: 0,
      today_payments_count: 0,
      pending_cashouts_count: 0,
      system_status: 'healthy',
    }
    api.get.mockResolvedValueOnce(kpis)
    await expect(adminApi.getKPIs()).resolves.toEqual(kpis)
    expect(api.get).toHaveBeenCalledWith('/admin/kpis', { signal: undefined })
  })

  it('propagates backend errors instead of falling back to demo data', async () => {
    api.get.mockRejectedValueOnce(new Error('Serverga ulanib bo‘lmadi'))
    await expect(adminApi.getUyushmalar()).rejects.toThrow('Serverga ulanib bo‘lmadi')
    api.get.mockRejectedValueOnce(new Error('Not authenticated'))
    await expect(adminApi.getLiveShifts()).rejects.toThrow('Not authenticated')
  })

  it('creates an Uyushma via POST /uyushma (not /admin)', async () => {
    api.post.mockResolvedValueOnce({ ...uyushmaDto, id: 9, code: 'ASK-01' })
    const created = await adminApi.createUyushma({
      name: 'Asaka',
      code: 'ASK-01',
      phone: '+998742230002',
      admin: { full_name: 'Ali Valiyev', phone: '+998905551122', password: 'secret123' },
    })
    expect(created).toMatchObject({ id: '9', code: 'ASK-01', status: 'active' })
    expect(api.post).toHaveBeenCalledWith('/uyushma', expect.objectContaining({ code: 'ASK-01', admin_phone: '+998905551122' }))
  })

  it('does not send a request when client-side validation fails', async () => {
    await expect(adminApi.archiveUyushma('3', ' a ')).rejects.toThrow(/kamida 3/)
    await expect(adminApi.setClientBlocked('7', true, '')).rejects.toThrow(/kamida 3/)
    await expect(adminApi.forceEndShift('12', '')).rejects.toThrow(/kamida 3/)
    await expect(adminApi.adjustWallet('7', 0, 'test', 'key-0')).rejects.toThrow(/noldan/)
    await expect(adminApi.updateSettings({ gps_interval_seconds: 100 })).rejects.toThrow()
    expect(api.post).not.toHaveBeenCalled()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('archives with the trimmed reason', async () => {
    api.post.mockResolvedValueOnce({ ...uyushmaDto, id: 3, status: 'archived', archived_at: '2026-09-19T13:00:00Z' })
    const archived = await adminApi.archiveUyushma('3', '  shartnoma tugadi ')
    expect(api.post).toHaveBeenCalledWith('/admin/uyushmalar/3/archive', { reason: 'shartnoma tugadi' })
    expect(archived.status).toBe('archived')
  })

  it('updates an Uyushma via PUT /admin/uyushmalar/{id}', async () => {
    api.put.mockResolvedValueOnce({ ...uyushmaDto, name: 'Yangi nom' })
    const u = await adminApi.updateUyushma('1', { name: 'Yangi nom', license_number: '' })
    expect(api.put).toHaveBeenCalledWith('/admin/uyushmalar/1', { name: 'Yangi nom', license_number: null })
    expect(u.name).toBe('Yangi nom')
  })

  it('lists clients with server-side search and pagination', async () => {
    api.get.mockResolvedValueOnce({ items: [], total: 0, page: 2, size: 25, pages: 1 })
    const page = await adminApi.getClients({ search: ' 9989 ', page: 2 })
    expect(api.get).toHaveBeenCalledWith('/admin/clients', { signal: undefined, query: { search: '9989', page: 2, size: 25 } })
    expect(page).toEqual({ items: [], total: 0, page: 2, size: 25, pages: 1 })
  })

  it('blocks with a reason and unblocks with an optional reason', async () => {
    const client = {
      id: 7,
      phone: '+998901112233',
      full_name: 'Demo',
      wallet_balance: 0,
      total_rides: 0,
      is_blocked: true,
      block_reason: 'firibgarlik',
      last_active_at: null,
      created_at: '2026-09-19T12:58:02Z',
    }
    api.post.mockResolvedValueOnce(client)
    await adminApi.setClientBlocked('7', true, ' firibgarlik ')
    expect(api.post).toHaveBeenLastCalledWith('/admin/clients/7/toggle-block', { block: true, reason: 'firibgarlik' })

    api.post.mockResolvedValueOnce({ ...client, is_blocked: false, block_reason: null })
    const unblocked = await adminApi.setClientBlocked('7', false)
    expect(api.post).toHaveBeenLastCalledWith('/admin/clients/7/toggle-block', { block: false, reason: null })
    expect(unblocked.is_blocked).toBe(false)
  })

  it('adjusts a wallet and maps the ledger entry', async () => {
    api.post.mockResolvedValueOnce({
      id: 44,
      entry_type: 'adjustment',
      amount_uzs: -5000,
      balance_after_uzs: 45000,
      reference_type: 'admin',
      reference_id: '1',
      description: 'Administrator tuzatishi: xato',
      created_at: '2026-09-19T13:10:00Z',
    })
    const entry = await adminApi.adjustWallet('7', -5000, 'xato to‘lov', 'adj-key-1')
    expect(api.post).toHaveBeenCalledWith(
      '/admin/wallets/7/adjust',
      { amount_uzs: -5000, reason: 'xato to‘lov' },
      { headers: { 'Idempotency-Key': 'adj-key-1' } },
    )
    expect(entry).toMatchObject({ id: '44', amount_uzs: -5000, balance_after_uzs: 45000 })
  })

  it('reports ledger health', async () => {
    api.get.mockResolvedValueOnce({ wallets_checked: 5, inconsistent_wallets: [3] })
    await expect(adminApi.getLedgerHealth()).resolves.toEqual({
      wallets_checked: 5,
      inconsistent_wallet_ids: ['3'],
      is_consistent: false,
    })
  })

  it('force-ends a shift with a reason', async () => {
    api.post.mockResolvedValueOnce({ detail: 'Shift force-ended', shift_id: 12 })
    await adminApi.forceEndShift('12', 'GPS 2 soat kelmayapti')
    expect(api.post).toHaveBeenCalledWith('/admin/shifts/12/force-end', { reason: 'GPS 2 soat kelmayapti' })
  })

  it('reads and saves settings (only changed keys are sent)', async () => {
    api.get.mockResolvedValueOnce(settingsDto)
    await expect(adminApi.getSettings()).resolves.toEqual(settingsDto)

    const saved = { ...settingsDto, maintenance_mode: true, updated_at: '2026-09-19T13:20:00Z', updated_by: 'Super Administrator' }
    api.put.mockResolvedValueOnce(saved)
    await expect(adminApi.updateSettings({ maintenance_mode: true })).resolves.toEqual(saved)
    expect(api.put).toHaveBeenCalledWith('/admin/settings', { maintenance_mode: true })
  })

  it('queries the audit log with filters', async () => {
    api.get.mockResolvedValueOnce({ items: [], total: 0, page: 1, size: 50, pages: 1 })
    await adminApi.getAuditLogs({ target_type: 'shift', actor_user_id: '1' })
    expect(api.get).toHaveBeenCalledWith('/admin/audit-logs', {
      signal: undefined,
      query: expect.objectContaining({ target_type: 'shift', actor_user_id: '1', page: 1, size: 50 }),
    })
  })
})
