// Uyushma operations API (tenant-scoped on the backend). Maps backend DTOs <-> UI view models.
import { apiClient } from './client'
import type {
  FareRuleType,
  UyushmaDriver,
  UyushmaFareRule,
  UyushmaKPIs,
  UyushmaParking,
  UyushmaRoute,
  UyushmaVehicle,
  VehicleType,
} from '../../types/uyushma'

// ---------------------------------------------------------------- DTOs

interface KpiDto extends Omit<UyushmaKPIs, 'uyushma_id'> {
  uyushma_id: number
}

interface RouteSummaryDto {
  id: number
  uyushma_id: number
  route_number: string
  name: string
  description?: string | null
  is_published: boolean
  vehicles_count: number
  drivers_count: number
  online_vehicles_count: number
  fare_uzs: number | null
  directions: {
    id: number
    direction_type: 'outbound' | 'inbound'
    origin_name: string
    destination_name: string
    stops_count: number
    distance_meters: number
    duration_seconds: number
    has_geometry: boolean
  }[]
  created_at: string
}

interface DriverDto {
  id: number
  uyushma_id: number
  full_name: string
  phone: string
  email?: string | null
  license_number?: string | null
  is_active: boolean
  vehicle_id?: number | null
  vehicle_internal_id?: string | null
  vehicle_plate?: string | null
  route_id?: number | null
  route_number?: string | null
  active_shift?: { id: number; started_at: string; is_online: boolean } | null
  created_at: string
}

interface VehicleDto {
  id: number
  internal_id: string
  qr_payload: string
  uyushma_id: number
  plate_number?: string | null
  model?: string | null
  color?: string | null
  vehicle_type?: VehicleType | null
  nfc_tag_id?: string | null
  capacity: number
  is_active: boolean
  route_id?: number | null
  route_number?: string | null
  driver_id?: number | null
  driver_name?: string | null
  is_on_shift: boolean
  created_at: string
}

interface ParkingDto {
  id: number
  uyushma_id: number | null
  name: string
  lat: number
  lng: number
  radius_meters: number
  capacity?: number | null
  is_active: boolean
  vehicle_count: number
  created_at: string
}

interface FareDto {
  id: number
  uyushma_id: number
  route_id?: number | null
  route_number?: string | null
  name: string
  description?: string | null
  rule_type: FareRuleType
  base_fare_uzs: number
  extra_fare_per_km_uzs: number
  config: { included_km?: number; cross_zone_extra?: number; peak_multiplier?: number; peak_start_hour?: number; peak_end_hour?: number }
  is_active: boolean
  created_at: string
}

// ---------------------------------------------------------------- mappers

const str = (v: number | null | undefined) => (v === null || v === undefined ? undefined : String(v))
const num = (v: string | undefined | null) => (v ? Number(v) : null)

function requireScope(uyushmaId: string): string {
  if (!uyushmaId) throw new Error('Uyushma tanlanmagan')
  return uyushmaId
}

export function mapRouteSummary(r: RouteSummaryDto): UyushmaRoute {
  return {
    id: String(r.id),
    uyushma_id: String(r.uyushma_id),
    route_number: r.route_number,
    route_name: r.name,
    description: r.description ?? undefined,
    is_active: r.is_published,
    assigned_vehicles_count: r.vehicles_count,
    assigned_drivers_count: r.drivers_count,
    online_vehicles_count: r.online_vehicles_count,
    fare_uzs: r.fare_uzs,
    directions: r.directions.map((d) => ({
      id: String(d.id),
      direction: d.direction_type,
      start_name: d.origin_name,
      end_name: d.destination_name,
      stops_count: d.stops_count,
      distance_km: Math.round(d.distance_meters / 100) / 10,
      estimated_duration_min: Math.round(d.duration_seconds / 60),
      is_active: d.has_geometry,
    })),
    created_at: r.created_at,
  }
}

export function mapDriver(d: DriverDto): UyushmaDriver {
  return {
    id: String(d.id),
    uyushma_id: String(d.uyushma_id),
    full_name: d.full_name,
    phone: d.phone,
    email: d.email ?? '',
    license_number: d.license_number ?? undefined,
    is_active: d.is_active,
    assigned_vehicle_id: str(d.vehicle_id),
    assigned_vehicle_plate: d.vehicle_plate || d.vehicle_internal_id || undefined,
    assigned_route_id: str(d.route_id),
    assigned_route_number: d.route_number ?? undefined,
    active_shift: d.active_shift
      ? { id: String(d.active_shift.id), started_at: d.active_shift.started_at, is_online: d.active_shift.is_online }
      : null,
    created_at: d.created_at,
  }
}

export function mapVehicle(v: VehicleDto): UyushmaVehicle {
  return {
    id: String(v.id),
    internal_id: v.internal_id,
    qr_payload: v.qr_payload,
    uyushma_id: String(v.uyushma_id),
    license_plate: v.plate_number ?? undefined,
    model: v.model ?? undefined,
    color: v.color ?? undefined,
    type: v.vehicle_type ?? undefined,
    nfc_tag_id: v.nfc_tag_id ?? undefined,
    capacity: v.capacity,
    is_active: v.is_active,
    assigned_route_id: str(v.route_id),
    assigned_route_number: v.route_number ?? undefined,
    assigned_driver_id: str(v.driver_id),
    assigned_driver_name: v.driver_name ?? undefined,
    is_on_shift: v.is_on_shift,
    created_at: v.created_at,
  }
}

function mapParking(p: ParkingDto): UyushmaParking {
  return {
    id: String(p.id),
    uyushma_id: String(p.uyushma_id ?? ''),
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    radius_m: p.radius_meters,
    capacity: p.capacity ?? 0,
    current_vehicle_count: p.vehicle_count,
    is_active: p.is_active,
    created_at: p.created_at,
  }
}

function mapFare(f: FareDto): UyushmaFareRule {
  return {
    id: String(f.id),
    uyushma_id: String(f.uyushma_id),
    name: f.name,
    rule_type: f.rule_type,
    amount: f.base_fare_uzs,
    target_route_id: str(f.route_id),
    target_route_number: f.route_number ?? undefined,
    per_km_rate: f.extra_fare_per_km_uzs || undefined,
    included_km: f.config.included_km,
    cross_zone_extra: f.config.cross_zone_extra,
    peak_multiplier: f.config.peak_multiplier,
    peak_start_hour: f.config.peak_start_hour,
    peak_end_hour: f.config.peak_end_hour,
    is_active: f.is_active,
    description: f.description ?? undefined,
    created_at: f.created_at,
  }
}

export function fareBody(data: Partial<UyushmaFareRule>) {
  const config: Record<string, number> = {}
  if (data.included_km !== undefined) config.included_km = Number(data.included_km)
  if (data.cross_zone_extra !== undefined) config.cross_zone_extra = Number(data.cross_zone_extra)
  if (data.peak_multiplier !== undefined) config.peak_multiplier = Number(data.peak_multiplier)
  if (data.peak_start_hour !== undefined) config.peak_start_hour = Number(data.peak_start_hour)
  if (data.peak_end_hour !== undefined) config.peak_end_hour = Number(data.peak_end_hour)
  const body: Record<string, unknown> = {}
  if (data.name !== undefined) body.name = data.name
  if (data.description !== undefined) body.description = data.description || null
  if (data.rule_type !== undefined) body.rule_type = data.rule_type
  if (data.amount !== undefined) body.base_fare_uzs = Math.round(Number(data.amount))
  if (data.per_km_rate !== undefined) body.extra_fare_per_km_uzs = Math.round(Number(data.per_km_rate) || 0)
  if ('target_route_id' in data) body.route_id = num(data.target_route_id)
  if (data.is_active !== undefined) body.is_active = data.is_active
  // The backend stores `config` as one JSON blob, so sending it replaces the stored one. Only a
  // caller that knows the whole rule (the fare form, which always sends `rule_type`) may do that;
  // a partial update such as an is_active toggle must leave the peak window alone.
  if (Object.keys(config).length > 0 || data.rule_type !== undefined) body.config = config
  return body
}

// Last loaded lists power the instant client-side rule check; the backend stays authoritative.
// Keyed by tenant: a Super Admin who switches uyushma must never be validated against the previous
// tenant's drivers and vehicles.
const cache: { uyushmaId: string | null; drivers: UyushmaDriver[]; vehicles: UyushmaVehicle[] } = {
  uyushmaId: null,
  drivers: [],
  vehicles: [],
}

function cacheFor(uyushmaId: string): { drivers: UyushmaDriver[]; vehicles: UyushmaVehicle[] } {
  if (cache.uyushmaId !== uyushmaId) return { drivers: [], vehicles: [] }
  return cache
}

function rememberScope(uyushmaId: string) {
  if (cache.uyushmaId === uyushmaId) return
  cache.uyushmaId = uyushmaId
  cache.drivers = []
  cache.vehicles = []
}

/** What the user is editing right now: its own existing links are the ones being changed. */
export interface AssignmentInput {
  uyushmaId: string
  form: 'driver' | 'vehicle'
  driverId?: string
  vehicleId?: string
  routeId?: string
}

export const uyushmaApi = {
  async getKPIs(uyushmaId: string): Promise<UyushmaKPIs> {
    const k = await apiClient.get<KpiDto>(`/uyushma/${requireScope(uyushmaId)}/kpis`)
    return { ...k, uyushma_id: String(k.uyushma_id) }
  },

  /**
   * Mirrors the backend "1 Driver = 1 Vehicle = 1 Route" rule for instant form feedback.
   *
   * Only the links of the OTHER side are enforced: on the vehicle form the vehicle's own driver is
   * exactly what is being changed (re-assigning or clearing it is legitimate), and on the driver
   * form the driver's own vehicle is. Checking both sides made every re-assignment impossible.
   */
  validateAssignment({ uyushmaId, form, driverId, vehicleId, routeId }: AssignmentInput): {
    valid: boolean
    error?: string
  } {
    const { drivers, vehicles } = cacheFor(uyushmaId)
    if (form === 'driver' && vehicleId) {
      const vehicle = vehicles.find((v) => v.id === vehicleId)
      const owner = vehicle?.assigned_driver_id
      if (vehicle && owner && owner !== driverId) {
        return {
          valid: false,
          error: `Qoida (1 Driver = 1 Vehicle): ${vehicle.license_plate || vehicle.internal_id} transporti allaqachon ${vehicle.assigned_driver_name}ga biriktirilgan`,
        }
      }
    }
    if (form === 'vehicle' && driverId) {
      const driver = drivers.find((d) => d.id === driverId)
      const owned = driver?.assigned_vehicle_id
      if (driver && owned && owned !== vehicleId) {
        return {
          valid: false,
          error: `Qoida (1 Driver = 1 Vehicle): ${driver.full_name} allaqachon boshqa transportga (${driver.assigned_vehicle_plate}) biriktirilgan`,
        }
      }
    }
    // A driver reaches a route through their vehicle, never directly
    if (form === 'driver' && routeId && !vehicleId) {
      return { valid: false, error: 'Yo‘nalish transport orqali biriktiriladi: avval transport tanlang' }
    }
    return { valid: true }
  },

  // ── Routes ──
  async getRoutes(uyushmaId: string): Promise<UyushmaRoute[]> {
    return (await apiClient.get<RouteSummaryDto[]>(`/uyushma/${requireScope(uyushmaId)}/routes`)).map(mapRouteSummary)
  },

  async findRoute(uyushmaId: string, routeId: string): Promise<UyushmaRoute | undefined> {
    return (await this.getRoutes(uyushmaId)).find((r) => r.id === routeId)
  },

  /** Creates route metadata (draft). Directions/geometry are created in the visual Route Editor. */
  async createRoute(uyushmaId: string, data: Partial<UyushmaRoute>): Promise<UyushmaRoute> {
    const created = await apiClient.post<{ id: number }>('/routes', {
      uyushma_id: Number(requireScope(uyushmaId)),
      route_number: data.route_number?.trim(),
      name: data.route_name?.trim(),
      description: data.description || null,
    })
    const summary = await this.findRoute(uyushmaId, String(created.id))
    if (!summary) throw new Error('Yo‘nalish yaratildi, lekin ro‘yxatda topilmadi')
    return summary
  },

  async updateRoute(uyushmaId: string, routeId: string, updates: Partial<UyushmaRoute>): Promise<UyushmaRoute> {
    const body: Record<string, unknown> = {}
    if (updates.route_number !== undefined) body.route_number = updates.route_number.trim()
    if (updates.route_name !== undefined) body.name = updates.route_name.trim()
    if (updates.description !== undefined) body.description = updates.description
    if (Object.keys(body).length) await apiClient.put(`/routes/${routeId}`, body)
    if (updates.is_active !== undefined) {
      await apiClient.post(`/routes/${routeId}/publish`, { is_published: updates.is_active })
    }
    const summary = await this.findRoute(uyushmaId, routeId)
    if (!summary) throw new Error('Yo‘nalish topilmadi')
    return summary
  },

  /** Soft delete (archive). */
  async deleteRoute(_uyushmaId: string, routeId: string): Promise<boolean> {
    await apiClient.delete(`/routes/${routeId}`)
    return true
  },

  // ── Drivers ──
  async getDrivers(uyushmaId: string): Promise<UyushmaDriver[]> {
    const list = (await apiClient.get<DriverDto[]>(`/uyushma/${requireScope(uyushmaId)}/drivers`)).map(mapDriver)
    rememberScope(uyushmaId)
    cache.drivers = list
    return list
  },

  async createDriver(
    uyushmaId: string,
    data: {
      full_name: string
      phone: string
      email?: string
      password: string
      license_number?: string
      assigned_route_id?: string
      assigned_vehicle_id?: string
    },
  ): Promise<UyushmaDriver> {
    const dto = await apiClient.post<DriverDto>(`/uyushma/${requireScope(uyushmaId)}/drivers`, {
      full_name: data.full_name.trim(),
      phone: data.phone,
      email: data.email || null,
      password: data.password,
      license_number: data.license_number || null,
      vehicle_id: num(data.assigned_vehicle_id),
      route_id: data.assigned_vehicle_id ? num(data.assigned_route_id) : null,
    })
    return mapDriver(dto)
  },

  async updateDriver(uyushmaId: string, driverId: string, updates: Partial<UyushmaDriver> & { password?: string }): Promise<UyushmaDriver> {
    const body: Record<string, unknown> = {}
    if (updates.full_name !== undefined) body.full_name = updates.full_name.trim()
    if (updates.phone !== undefined) body.phone = updates.phone
    if (updates.email !== undefined) body.email = updates.email || null
    if (updates.license_number !== undefined) body.license_number = updates.license_number || null
    if (updates.password) body.password = updates.password
    if (updates.is_active !== undefined) body.is_active = updates.is_active
    if ('assigned_vehicle_id' in updates) body.vehicle_id = num(updates.assigned_vehicle_id)
    if ('assigned_route_id' in updates && updates.assigned_vehicle_id) body.route_id = num(updates.assigned_route_id)
    return mapDriver(await apiClient.put<DriverDto>(`/uyushma/${requireScope(uyushmaId)}/drivers/${driverId}`, body))
  },

  /** Deactivates the account and releases the vehicle (history is kept). */
  async deleteDriver(uyushmaId: string, driverId: string): Promise<boolean> {
    await apiClient.delete(`/uyushma/${requireScope(uyushmaId)}/drivers/${driverId}`)
    return true
  },

  // ── Vehicles ──
  async getVehicles(uyushmaId: string): Promise<UyushmaVehicle[]> {
    const list = (await apiClient.get<VehicleDto[]>(`/uyushma/${requireScope(uyushmaId)}/vehicles`)).map(mapVehicle)
    rememberScope(uyushmaId)
    cache.vehicles = list
    return list
  },

  async createVehicle(uyushmaId: string, data: Partial<UyushmaVehicle>): Promise<UyushmaVehicle> {
    const dto = await apiClient.post<VehicleDto>(`/uyushma/${requireScope(uyushmaId)}/vehicles`, {
      internal_id: data.internal_id?.trim() || null,
      plate_number: data.license_plate || null,
      model: data.model || null,
      color: data.color || null,
      vehicle_type: data.type || null,
      nfc_tag_id: data.nfc_tag_id || null,
      capacity: data.capacity ?? 7,
      route_id: num(data.assigned_route_id),
      driver_id: num(data.assigned_driver_id),
      is_active: data.is_active ?? true,
    })
    return mapVehicle(dto)
  },

  async updateVehicle(uyushmaId: string, vehicleId: string, updates: Partial<UyushmaVehicle>): Promise<UyushmaVehicle> {
    const body: Record<string, unknown> = {}
    if ('license_plate' in updates) body.plate_number = updates.license_plate || null
    if ('model' in updates) body.model = updates.model || null
    if ('color' in updates) body.color = updates.color || null
    if ('type' in updates) body.vehicle_type = updates.type || null
    if ('nfc_tag_id' in updates) body.nfc_tag_id = updates.nfc_tag_id || null
    if (updates.capacity !== undefined) body.capacity = updates.capacity
    if ('assigned_route_id' in updates) body.route_id = num(updates.assigned_route_id)
    if ('assigned_driver_id' in updates) body.driver_id = num(updates.assigned_driver_id)
    if (updates.is_active !== undefined) body.is_active = updates.is_active
    return mapVehicle(await apiClient.put<VehicleDto>(`/uyushma/${requireScope(uyushmaId)}/vehicles/${vehicleId}`, body))
  },

  /** Deactivates the vehicle and detaches driver/route (payments keep their history). */
  async deleteVehicle(uyushmaId: string, vehicleId: string): Promise<boolean> {
    await apiClient.delete(`/uyushma/${requireScope(uyushmaId)}/vehicles/${vehicleId}`)
    return true
  },

  // ── Parkings ──
  async getParkings(uyushmaId: string): Promise<UyushmaParking[]> {
    return (await apiClient.get<ParkingDto[]>(`/uyushma/${requireScope(uyushmaId)}/parkings`)).map(mapParking)
  },

  async createParking(uyushmaId: string, data: Partial<UyushmaParking>): Promise<UyushmaParking> {
    return mapParking(
      await apiClient.post<ParkingDto>(`/uyushma/${requireScope(uyushmaId)}/parkings`, {
        name: data.name,
        lat: data.lat,
        lng: data.lng,
        radius_meters: data.radius_m,
        capacity: data.capacity || null,
        is_active: data.is_active ?? true,
      }),
    )
  },

  async updateParking(uyushmaId: string, parkingId: string, updates: Partial<UyushmaParking>): Promise<UyushmaParking> {
    const body: Record<string, unknown> = {}
    if (updates.name !== undefined) body.name = updates.name
    if (updates.lat !== undefined) body.lat = updates.lat
    if (updates.lng !== undefined) body.lng = updates.lng
    if (updates.radius_m !== undefined) body.radius_meters = updates.radius_m
    if (updates.capacity !== undefined) body.capacity = updates.capacity || null
    if (updates.is_active !== undefined) body.is_active = updates.is_active
    return mapParking(await apiClient.put<ParkingDto>(`/uyushma/${requireScope(uyushmaId)}/parkings/${parkingId}`, body))
  },

  async deleteParking(uyushmaId: string, parkingId: string): Promise<boolean> {
    await apiClient.delete(`/uyushma/${requireScope(uyushmaId)}/parkings/${parkingId}`)
    return true
  },

  // ── Fare rules ──
  async getFareRules(uyushmaId: string): Promise<UyushmaFareRule[]> {
    return (await apiClient.get<FareDto[]>(`/uyushma/${requireScope(uyushmaId)}/fares`)).map(mapFare)
  },

  async createFareRule(uyushmaId: string, data: Partial<UyushmaFareRule>): Promise<UyushmaFareRule> {
    return mapFare(await apiClient.post<FareDto>(`/uyushma/${requireScope(uyushmaId)}/fares`, fareBody(data)))
  },

  async updateFareRule(uyushmaId: string, fareId: string, updates: Partial<UyushmaFareRule>): Promise<UyushmaFareRule> {
    return mapFare(await apiClient.put<FareDto>(`/uyushma/${requireScope(uyushmaId)}/fares/${fareId}`, fareBody(updates)))
  },

  /** Tariffs used by payments are only deactivated, never deleted. */
  async deleteFareRule(uyushmaId: string, fareId: string): Promise<boolean> {
    await apiClient.delete(`/uyushma/${requireScope(uyushmaId)}/fares/${fareId}`)
    return true
  },
}
