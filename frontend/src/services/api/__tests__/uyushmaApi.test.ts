import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import { apiClient } from '../client'
import { fareBody, uyushmaApi } from '../uyushmaApi'

const api = apiClient as unknown as { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> }

const driverDto = (over: Record<string, unknown> = {}) => ({
  id: 5,
  uyushma_id: 1,
  full_name: 'Akmal Yo‘ldoshev',
  phone: '+998901112233',
  is_active: true,
  is_on_shift: false,
  created_at: '2026-09-01T00:00:00Z',
  ...over,
})

const vehicleDto = (over: Record<string, unknown> = {}) => ({
  id: 9,
  internal_id: 'AND01-V0009',
  qr_payload: 'qr',
  uyushma_id: 1,
  plate_number: '01 A 123 BC',
  capacity: 12,
  is_active: true,
  is_on_shift: false,
  created_at: '2026-09-01T00:00:00Z',
  ...over,
})

/** Loads the client-side rule cache the way the pages do before opening a form. */
async function loadScope(uyushmaId: string, drivers: unknown[], vehicles: unknown[]) {
  api.get.mockResolvedValueOnce(drivers)
  await uyushmaApi.getDrivers(uyushmaId)
  api.get.mockResolvedValueOnce(vehicles)
  await uyushmaApi.getVehicles(uyushmaId)
}

describe('validateAssignment (1 Driver = 1 Vehicle = 1 Route)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows re-assigning and clearing the links of the record being edited', async () => {
    // Driver 5 drives vehicle 9 today
    await loadScope('1', [driverDto({ vehicle_id: 9, vehicle_plate: '01 A 123 BC' })], [vehicleDto({ driver_id: 5, driver_name: 'Akmal Yo‘ldoshev' })])

    // Editing that vehicle and handing it to another driver is a normal re-assignment
    expect(uyushmaApi.validateAssignment({ uyushmaId: '1', form: 'vehicle', vehicleId: '9', driverId: undefined }).valid).toBe(true)
    // Editing that driver and clearing their vehicle must be possible too
    expect(uyushmaApi.validateAssignment({ uyushmaId: '1', form: 'driver', driverId: '5', vehicleId: undefined }).valid).toBe(true)
    // ...and keeping the same pair stays valid
    expect(uyushmaApi.validateAssignment({ uyushmaId: '1', form: 'driver', driverId: '5', vehicleId: '9' }).valid).toBe(true)
  })

  it('blocks a link that would break the rule on the other side', async () => {
    await loadScope(
      '1',
      [driverDto({ id: 5, vehicle_id: 9, vehicle_plate: '01 A 123 BC' }), driverDto({ id: 6, full_name: 'Botir', vehicle_id: null })],
      [vehicleDto({ id: 9, driver_id: 5, driver_name: 'Akmal Yo‘ldoshev' })],
    )

    // Driver form: taking a vehicle that already belongs to somebody else
    const taken = uyushmaApi.validateAssignment({ uyushmaId: '1', form: 'driver', driverId: '6', vehicleId: '9' })
    expect(taken.valid).toBe(false)
    expect(taken.error).toMatch(/allaqachon/)

    // Vehicle form: picking a driver who already drives another vehicle
    const busy = uyushmaApi.validateAssignment({ uyushmaId: '1', form: 'vehicle', vehicleId: '12', driverId: '5' })
    expect(busy.valid).toBe(false)

    // A driver gets a route through the vehicle, never directly
    expect(uyushmaApi.validateAssignment({ uyushmaId: '1', form: 'driver', driverId: '6', routeId: '3' }).valid).toBe(false)
  })

  it('never validates against another tenant’s cached lists', async () => {
    await loadScope('1', [driverDto({ id: 5, vehicle_id: 9, vehicle_plate: '01 A 123 BC' })], [vehicleDto({ id: 9, driver_id: 5 })])
    // Super Admin switches uyushma: nothing is known about tenant 2 yet, so no rule can be claimed
    expect(uyushmaApi.validateAssignment({ uyushmaId: '2', form: 'vehicle', vehicleId: '9', driverId: '5' }).valid).toBe(true)
  })
})

describe('fareBody', () => {
  it('sends the whole config for a full rule save', () => {
    const body = fareBody({
      name: 'Pik tarif',
      rule_type: 'time_based',
      amount: 3000,
      peak_multiplier: 1.3,
      peak_start_hour: 7,
      peak_end_hour: 10,
    })
    expect(body.config).toEqual({ peak_multiplier: 1.3, peak_start_hour: 7, peak_end_hour: 10 })
    expect(body.base_fare_uzs).toBe(3000)
  })

  it('leaves the stored config untouched on a partial update', () => {
    // Toggling is_active must not erase the rule's peak window
    expect(fareBody({ is_active: false })).toEqual({ is_active: false })
  })
})

describe('updateFareRule', () => {
  it('puts the config of the edited rule type', async () => {
    api.put.mockResolvedValue({
      id: 4,
      uyushma_id: 1,
      name: 'Pik tarif',
      rule_type: 'time_based',
      base_fare_uzs: 3000,
      extra_fare_per_km_uzs: 0,
      config: { peak_multiplier: 1.3, peak_start_hour: 22, peak_end_hour: 6 },
      is_active: true,
      created_at: '2026-09-01T00:00:00Z',
    })
    const updated = await uyushmaApi.updateFareRule('1', '4', {
      rule_type: 'time_based',
      peak_multiplier: 1.3,
      peak_start_hour: 22,
      peak_end_hour: 6,
    })
    expect(api.put).toHaveBeenCalledWith('/uyushma/1/fares/4', {
      rule_type: 'time_based',
      config: { peak_multiplier: 1.3, peak_start_hour: 22, peak_end_hour: 6 },
    })
    // A window that crosses midnight survives the round trip
    expect(updated.peak_start_hour).toBe(22)
    expect(updated.peak_end_hour).toBe(6)
  })
})
