// Super Admin API (`/admin/*` + Uyushma creation). Maps backend DTOs <-> UI view models.
// No fallbacks: every error propagates as ApiError / Error so pages render real error states.
import { apiClient, type Query } from './client'
import type {
  AdminClientQuery,
  AdminClientUser,
  AdminGlobalKPIs,
  AdminLiveShift,
  AdminSettingsValues,
  AdminSystemSettings,
  AdminUyushma,
  AdminUyushmaCore,
  AdminUyushmaCreateInput,
  AdminUyushmaUpdateInput,
  AuditLogEntry,
  AuditLogFilters,
  LedgerHealth,
  NumericSettingKey,
  NumericSettingSpec,
  Paginated,
  WalletLedgerEntry,
} from '../../types/admin'

// ---------------------------------------------------------------- DTOs (backend/app/schemas/admin.py, uyushma.py)

export type AdminKpisDto = AdminGlobalKPIs

export interface UyushmaReadDto {
  id: number
  name: string
  code: string
  phone: string
  address: string | null
  region: string | null
  contact_person: string | null
  license_number: string | null
  is_active: boolean
  archived_at: string | null
  archive_reason: string | null
  created_at: string
}

export interface UyushmaAdminReadDto extends UyushmaReadDto {
  status: string
  routes_count: number
  drivers_count: number
  vehicles_count: number
  admin_phone: string | null
}

export interface PaginatedDto<T> {
  items: T[]
  total: number
  page: number
  size: number
  pages: number
}

export interface AdminClientDto {
  id: number
  phone: string
  full_name: string
  wallet_balance: number
  total_rides: number
  is_blocked: boolean
  block_reason: string | null
  last_active_at: string | null
  created_at: string
}

export interface LedgerEntryDto {
  id: number
  entry_type: string
  amount_uzs: number
  balance_after_uzs: number
  reference_type: string | null
  reference_id: string | null
  description: string
  created_at: string
}

export interface LedgerHealthDto {
  wallets_checked: number
  inconsistent_wallets: number[]
}

export interface AdminShiftDto {
  id: number
  driver_id: number
  driver_name: string
  driver_phone: string
  uyushma_id: number
  uyushma_name: string
  vehicle_id: number
  vehicle_internal_id: string
  vehicle_plate: string | null
  route_id: number
  route_number: string
  direction: string
  started_at: string
  last_gps_at: string | null
  is_online: boolean
  current_lat: number | null
  current_lng: number | null
}

export type SystemSettingsDto = AdminSystemSettings

export interface AuditLogDto {
  id: number
  created_at: string
  actor_user_id: number | null
  actor_name: string | null
  actor_role: string | null
  action: string
  target_type: string | null
  target_id: string | null
  uyushma_id: number | null
  reason: string | null
  changes: unknown
  ip_address: string | null
}

// ---------------------------------------------------------------- validation (mirrors backend rules)

const PHONE_RE = /^\+998\d{9}$/
const CODE_RE = /^[A-Za-z0-9_-]+$/

/** Mirrors backend `normalize_phone`: returns `+998XXXXXXXXX` or null when invalid. */
export function normalizePhone(value: string | null | undefined): string | null {
  let digits = (value ?? '').replace(/\D/g, '')
  if (digits.length === 9) digits = `998${digits}`
  const normalized = `+${digits}`
  return PHONE_RE.test(normalized) ? normalized : null
}

/** Audit reasons: 3..255 characters after trimming (backend `ReasonRequest`). */
export function validateReason(reason: string | null | undefined, what = 'Sabab'): string {
  const trimmed = (reason ?? '').trim()
  if (trimmed.length < 3) throw new Error(`${what} kamida 3 ta belgidan iborat bo‘lishi kerak`)
  if (trimmed.length > 255) throw new Error(`${what} 255 ta belgidan oshmasligi kerak`)
  return trimmed
}

/** Mirrors `SETTING_SPECS` in backend/app/services/settings_service.py. */
export const NUMERIC_SETTING_SPECS: Record<NumericSettingKey, NumericSettingSpec> = {
  gps_interval_seconds: { min: 2, max: 60, integer: true },
  refund_window_minutes: { min: 0, max: 1440, integer: true },
  platform_commission_percent: { min: 0, max: 20, integer: false },
  max_unassigned_vehicles: { min: 0, max: 10_000, integer: true },
  min_topup_uzs: { min: 100, max: 1_000_000, integer: true },
  max_topup_uzs: { min: 1000, max: 50_000_000, integer: true },
}

export const SETTING_KEYS: (keyof AdminSettingsValues)[] = [
  'gps_interval_seconds',
  'refund_window_minutes',
  'platform_commission_percent',
  'maintenance_mode',
  'fcm_notifications_enabled',
  'max_unassigned_vehicles',
  'min_topup_uzs',
  'max_topup_uzs',
]

export type SettingsErrors = Partial<Record<keyof AdminSettingsValues, string>>

/** Client-side range validation (the backend re-validates and answers 422 with `detail`). */
export function validateSettings(values: Partial<AdminSettingsValues>): SettingsErrors {
  const errors: SettingsErrors = {}
  ;(Object.keys(NUMERIC_SETTING_SPECS) as NumericSettingKey[]).forEach((key) => {
    if (!(key in values)) return
    const spec = NUMERIC_SETTING_SPECS[key]
    const v = values[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors[key] = 'Son kiriting'
    } else if (spec.integer && !Number.isInteger(v)) {
      errors[key] = 'Butun son bo‘lishi kerak'
    } else if (v < spec.min || v > spec.max) {
      errors[key] = `${spec.min.toLocaleString('ru-RU')} – ${spec.max.toLocaleString('ru-RU')} oralig‘ida bo‘lishi kerak`
    }
  })
  const { min_topup_uzs: min, max_topup_uzs: max } = values
  if (typeof min === 'number' && typeof max === 'number' && !errors.min_topup_uzs && !errors.max_topup_uzs && min > max) {
    errors.min_topup_uzs = 'Minimal summa maksimal summadan katta bo‘lmasligi kerak'
  }
  return errors
}

/** Only the keys whose value differs (so the audit diff contains real changes only). */
export function diffSettings(original: AdminSettingsValues, draft: AdminSettingsValues): Partial<AdminSettingsValues> {
  const changes: Partial<AdminSettingsValues> = {}
  SETTING_KEYS.forEach((key) => {
    if (original[key] !== draft[key]) (changes as Record<string, unknown>)[key] = draft[key]
  })
  return changes
}

export const WALLET_ADJUST_LIMIT_UZS = 10_000_000

export function validateAdjustAmount(amount: number): number {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) throw new Error('Summa butun son (so‘m) bo‘lishi kerak')
  if (amount === 0) throw new Error('Summa noldan farqli bo‘lishi kerak')
  if (Math.abs(amount) > WALLET_ADJUST_LIMIT_UZS) {
    throw new Error(`Bir martalik tuzatish ${WALLET_ADJUST_LIMIT_UZS.toLocaleString('ru-RU')} so‘mdan oshmasligi kerak`)
  }
  return amount
}

/** Local calendar date (`YYYY-MM-DD`, from `<input type="date">`) -> UTC ISO bound of that local day. */
export function localDateToUtcIso(date: string, bound: 'start' | 'end'): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '')
  if (!m) return undefined
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
  const local = bound === 'start' ? new Date(y, mo, d, 0, 0, 0, 0) : new Date(y, mo, d, 23, 59, 59, 999)
  return Number.isNaN(local.getTime()) ? undefined : local.toISOString()
}

const opt = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? undefined : v)
const trimOrNull = (v: string | undefined) => {
  const t = (v ?? '').trim()
  return t ? t : null
}

/** Builds the `UyushmaCreate` body; throws a user-facing Error when the input is invalid. */
export function buildUyushmaCreateBody(input: AdminUyushmaCreateInput): Record<string, unknown> {
  const name = input.name.trim()
  const code = input.code.trim()
  if (name.length < 2 || name.length > 150) throw new Error('Uyushma nomi 2–150 belgidan iborat bo‘lishi kerak')
  if (code.length < 2 || code.length > 50 || !CODE_RE.test(code)) {
    throw new Error('Kod 2–50 belgi: faqat lotin harflari, raqamlar, "-" va "_" (masalan AND-02)')
  }
  const phone = normalizePhone(input.phone)
  if (!phone) throw new Error('Uyushma telefoni +998XXXXXXXXX formatida bo‘lishi kerak')

  const body: Record<string, unknown> = {
    name,
    code,
    phone,
    address: trimOrNull(input.address),
    region: trimOrNull(input.region),
    contact_person: trimOrNull(input.contact_person),
    license_number: trimOrNull(input.license_number),
  }

  if (input.admin) {
    const fullName = input.admin.full_name.trim()
    const adminPhone = normalizePhone(input.admin.phone)
    if (fullName.length < 2 || fullName.length > 100) throw new Error('Admin F.I.Sh. 2–100 belgidan iborat bo‘lishi kerak')
    if (!adminPhone) throw new Error('Admin telefoni +998XXXXXXXXX formatida bo‘lishi kerak')
    if (input.admin.password.length < 8 || input.admin.password.length > 128) {
      throw new Error('Admin paroli kamida 8 ta belgidan iborat bo‘lishi kerak')
    }
    body.admin_full_name = fullName
    body.admin_phone = adminPhone
    body.admin_password = input.admin.password
  }
  return body
}

/** Builds the `UyushmaUpdate` body (only provided keys; empty optional text clears the field). */
export function buildUyushmaUpdateBody(input: AdminUyushmaUpdateInput): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (name.length < 2 || name.length > 150) throw new Error('Uyushma nomi 2–150 belgidan iborat bo‘lishi kerak')
    body.name = name
  }
  if (input.phone !== undefined) {
    const phone = normalizePhone(input.phone)
    if (!phone) throw new Error('Uyushma telefoni +998XXXXXXXXX formatida bo‘lishi kerak')
    body.phone = phone
  }
  (['address', 'region', 'contact_person', 'license_number'] as const).forEach((key) => {
    if (input[key] !== undefined) body[key] = trimOrNull(input[key])
  })
  return body
}

// ---------------------------------------------------------------- mappers

const id = (v: number | null | undefined): string | null => (v === null || v === undefined ? null : String(v))

export function mapPage<D, V>(dto: PaginatedDto<D>, map: (d: D) => V): Paginated<V> {
  return { items: dto.items.map(map), total: dto.total, page: dto.page, size: dto.size, pages: dto.pages }
}

export function mapUyushmaCore(u: UyushmaReadDto): AdminUyushmaCore {
  return {
    id: String(u.id),
    name: u.name,
    code: u.code,
    phone: u.phone,
    address: opt(u.address),
    region: opt(u.region),
    contact_person: opt(u.contact_person),
    license_number: opt(u.license_number),
    status: u.archived_at ? 'archived' : 'active',
    archived_at: u.archived_at,
    archive_reason: opt(u.archive_reason),
    created_at: u.created_at,
  }
}

export function mapAdminUyushma(u: UyushmaAdminReadDto): AdminUyushma {
  return {
    ...mapUyushmaCore(u),
    status: u.status === 'archived' || u.archived_at ? 'archived' : 'active',
    routes_count: u.routes_count,
    drivers_count: u.drivers_count,
    vehicles_count: u.vehicles_count,
    admin_phone: opt(u.admin_phone),
  }
}

export function mapClient(c: AdminClientDto): AdminClientUser {
  return {
    id: String(c.id),
    phone: c.phone,
    full_name: c.full_name,
    wallet_balance: c.wallet_balance,
    total_rides: c.total_rides,
    is_blocked: c.is_blocked,
    block_reason: opt(c.block_reason),
    last_active_at: c.last_active_at,
    created_at: c.created_at,
  }
}

export function mapLedgerEntry(e: LedgerEntryDto): WalletLedgerEntry {
  return {
    id: String(e.id),
    entry_type: e.entry_type,
    amount_uzs: e.amount_uzs,
    balance_after_uzs: e.balance_after_uzs,
    reference_type: opt(e.reference_type),
    reference_id: opt(e.reference_id),
    description: e.description,
    created_at: e.created_at,
  }
}

export function mapLedgerHealth(h: LedgerHealthDto): LedgerHealth {
  return {
    wallets_checked: h.wallets_checked,
    inconsistent_wallet_ids: h.inconsistent_wallets.map(String),
    is_consistent: h.inconsistent_wallets.length === 0,
  }
}

export function mapShift(s: AdminShiftDto): AdminLiveShift {
  return {
    id: String(s.id),
    driver_id: String(s.driver_id),
    driver_name: s.driver_name,
    driver_phone: s.driver_phone,
    uyushma_id: String(s.uyushma_id),
    uyushma_name: s.uyushma_name,
    vehicle_id: String(s.vehicle_id),
    vehicle_internal_id: s.vehicle_internal_id,
    vehicle_plate: opt(s.vehicle_plate),
    route_id: String(s.route_id),
    route_number: s.route_number,
    direction: s.direction,
    started_at: s.started_at,
    last_gps_at: s.last_gps_at,
    is_online: s.is_online,
    current_lat: s.current_lat ?? null,
    current_lng: s.current_lng ?? null,
  }
}

export function mapSettings(s: SystemSettingsDto): AdminSystemSettings {
  return {
    gps_interval_seconds: s.gps_interval_seconds,
    refund_window_minutes: s.refund_window_minutes,
    platform_commission_percent: s.platform_commission_percent,
    maintenance_mode: s.maintenance_mode,
    fcm_notifications_enabled: s.fcm_notifications_enabled,
    max_unassigned_vehicles: s.max_unassigned_vehicles,
    min_topup_uzs: s.min_topup_uzs,
    max_topup_uzs: s.max_topup_uzs,
    updated_at: s.updated_at ?? null,
    updated_by: s.updated_by ?? null,
  }
}

export function mapAuditLog(a: AuditLogDto): AuditLogEntry {
  return {
    id: String(a.id),
    created_at: a.created_at,
    actor_user_id: id(a.actor_user_id),
    actor_name: a.actor_name ?? null,
    actor_role: a.actor_role ?? null,
    action: a.action,
    target_type: a.target_type ?? null,
    target_id: a.target_id ?? null,
    uyushma_id: id(a.uyushma_id),
    reason: a.reason ?? null,
    changes: a.changes ?? null,
    ip_address: a.ip_address ?? null,
  }
}

export function auditQuery(filters: AuditLogFilters): Query {
  return {
    action: filters.action?.trim() || undefined,
    target_type: filters.target_type || undefined,
    actor_user_id: filters.actor_user_id || undefined,
    uyushma_id: filters.uyushma_id || undefined,
    date_from: filters.date_from ? localDateToUtcIso(filters.date_from, 'start') : undefined,
    date_to: filters.date_to ? localDateToUtcIso(filters.date_to, 'end') : undefined,
    page: filters.page ?? 1,
    size: filters.size ?? 50,
  }
}

// ---------------------------------------------------------------- API

export const adminApi = {
  // ── Dashboard ──
  async getKPIs(signal?: AbortSignal): Promise<AdminGlobalKPIs> {
    const k = await apiClient.get<AdminKpisDto>('/admin/kpis', { signal })
    return { ...k }
  },

  async getLedgerHealth(signal?: AbortSignal): Promise<LedgerHealth> {
    return mapLedgerHealth(await apiClient.get<LedgerHealthDto>('/admin/ledger/health', { signal, timeoutMs: 60_000 }))
  },

  // ── Uyushmalar ──
  async getUyushmalar(signal?: AbortSignal): Promise<AdminUyushma[]> {
    return (await apiClient.get<UyushmaAdminReadDto[]>('/admin/uyushmalar', { signal })).map(mapAdminUyushma)
  },

  /** `POST /uyushma` (Super Admin only), optionally with the Uyushma admin login. */
  async createUyushma(input: AdminUyushmaCreateInput): Promise<AdminUyushmaCore> {
    return mapUyushmaCore(await apiClient.post<UyushmaReadDto>('/uyushma', buildUyushmaCreateBody(input)))
  },

  async updateUyushma(uyushmaId: string, input: AdminUyushmaUpdateInput): Promise<AdminUyushma> {
    const body = buildUyushmaUpdateBody(input)
    return mapAdminUyushma(await apiClient.put<UyushmaAdminReadDto>(`/admin/uyushmalar/${uyushmaId}`, body))
  },

  /** Creates the Uyushma admin login, or resets the existing one's name, phone and password. */
  async setUyushmaAdmin(uyushmaId: string, input: { full_name: string; phone: string; password: string }): Promise<AdminUyushma> {
    const phone = normalizePhone(input.phone)
    if (!phone) throw new Error('Admin telefon raqami +998XXXXXXXXX formatida bo‘lishi kerak')
    if (input.full_name.trim().length < 2) throw new Error('Admin F.I.Sh. kamida 2 ta belgi')
    if (input.password.length < 8) throw new Error('Parol kamida 8 ta belgidan iborat bo‘lishi kerak')
    return mapAdminUyushma(
      await apiClient.put<UyushmaAdminReadDto>(`/admin/uyushmalar/${uyushmaId}/admin`, {
        full_name: input.full_name.trim(),
        phone,
        password: input.password,
      }),
    )
  },

  /** Soft archive; backend answers 409 while the Uyushma has active shifts. */
  async archiveUyushma(uyushmaId: string, reason: string): Promise<AdminUyushma> {
    const body = { reason: validateReason(reason, 'Arxivlash sababi') }
    return mapAdminUyushma(await apiClient.post<UyushmaAdminReadDto>(`/admin/uyushmalar/${uyushmaId}/archive`, body))
  },

  // ── Clients ──
  async getClients(query: AdminClientQuery = {}, signal?: AbortSignal): Promise<Paginated<AdminClientUser>> {
    const dto = await apiClient.get<PaginatedDto<AdminClientDto>>('/admin/clients', {
      signal,
      query: { search: query.search?.trim() || undefined, status: query.status, page: query.page ?? 1, size: query.size ?? 25 },
    })
    return mapPage(dto, mapClient)
  },

  /** Block requires a reason (>= 3 chars); unblock may carry an optional reason for the audit log. */
  async setClientBlocked(userId: string, block: boolean, reason?: string): Promise<AdminClientUser> {
    const trimmed = (reason ?? '').trim()
    const body = block
      ? { block: true, reason: validateReason(reason, 'Bloklash sababi') }
      : { block: false, reason: trimmed ? trimmed.slice(0, 255) : null }
    return mapClient(await apiClient.post<AdminClientDto>(`/admin/clients/${userId}/toggle-block`, body))
  },

  /**
   * Audited `adjustment` ledger entry (positive = credit, negative = debit).
   * Reuse `idempotencyKey` for retries of the same correction: the backend then never posts twice.
   */
  async adjustWallet(userId: string, amountUzs: number, reason: string, idempotencyKey: string): Promise<WalletLedgerEntry> {
    const body = { amount_uzs: validateAdjustAmount(amountUzs), reason: validateReason(reason, 'Tuzatish sababi') }
    return mapLedgerEntry(
      await apiClient.post<LedgerEntryDto>(`/admin/wallets/${userId}/adjust`, body, { headers: { 'Idempotency-Key': idempotencyKey } }),
    )
  },

  // ── Live shifts ──
  async getLiveShifts(signal?: AbortSignal): Promise<AdminLiveShift[]> {
    return (await apiClient.get<AdminShiftDto[]>('/admin/shifts/live', { signal })).map(mapShift)
  },

  async forceEndShift(shiftId: string, reason: string): Promise<void> {
    await apiClient.post(`/admin/shifts/${shiftId}/force-end`, { reason: validateReason(reason, 'To‘xtatish sababi') })
  },

  // ── Settings ──
  async getSettings(signal?: AbortSignal): Promise<AdminSystemSettings> {
    return mapSettings(await apiClient.get<SystemSettingsDto>('/admin/settings', { signal }))
  },

  /** Sends only the given keys; validates ranges first (mirrors backend SETTING_SPECS). */
  async updateSettings(changes: Partial<AdminSettingsValues>): Promise<AdminSystemSettings> {
    const errors = validateSettings(changes)
    const first = Object.entries(errors)[0]
    if (first) throw new Error(`${first[0]}: ${first[1]}`)
    return mapSettings(await apiClient.put<SystemSettingsDto>('/admin/settings', changes))
  },

  // ── Audit ──
  async getAuditLogs(filters: AuditLogFilters = {}, signal?: AbortSignal): Promise<Paginated<AuditLogEntry>> {
    const dto = await apiClient.get<PaginatedDto<AuditLogDto>>('/admin/audit-logs', { signal, query: auditQuery(filters) })
    return mapPage(dto, mapAuditLog)
  },
}
