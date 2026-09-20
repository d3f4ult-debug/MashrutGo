// ── Uyushma (Organization) view models (mapped from backend DTOs in services/api/uyushmaApi.ts) ──

export interface UyushmaKPIs {
  uyushma_id: string
  owned_routes_count: number
  published_routes_count: number
  drivers_count: number
  vehicles_count: number
  active_shifts_count: number
  visible_vehicles_count: number
  parkings_count: number
  parked_vehicles_count: number
  today_payments_total: number
  today_payments_count: number
  pending_cashouts_count: number
  pending_cashouts_total: number
}

export interface RouteDirectionConfig {
  id: string
  direction: 'outbound' | 'inbound'
  start_name: string
  end_name: string
  stops_count: number
  distance_km: number
  estimated_duration_min: number
  /** true when the direction has saved road geometry */
  is_active: boolean
}

export interface UyushmaRoute {
  id: string
  uyushma_id: string
  route_number: string
  route_name: string
  description?: string
  /** published (visible to passengers) */
  is_active: boolean
  assigned_vehicles_count: number
  assigned_drivers_count: number
  online_vehicles_count: number
  fare_uzs: number | null
  directions: RouteDirectionConfig[]
  created_at: string
}

export interface UyushmaDriver {
  id: string
  uyushma_id: string
  full_name: string
  phone: string
  email: string
  license_number?: string
  is_active: boolean
  assigned_vehicle_id?: string
  assigned_vehicle_plate?: string
  assigned_route_id?: string
  assigned_route_number?: string
  active_shift?: {
    id: string
    started_at: string
    is_online: boolean
  } | null
  created_at: string
}

export type VehicleType = 'damas' | 'gazel' | 'isuzu' | 'bus' | 'minibus' | 'other'

export interface UyushmaVehicle {
  /** database id (used in API paths and assignments) */
  id: string
  /** mandatory, system-wide unique internal id printed on the QR sticker */
  internal_id: string
  qr_payload: string
  uyushma_id: string
  license_plate?: string
  model?: string
  color?: string
  type?: VehicleType
  nfc_tag_id?: string
  capacity: number
  is_active: boolean
  assigned_route_id?: string
  assigned_route_number?: string
  assigned_driver_id?: string
  assigned_driver_name?: string
  is_on_shift?: boolean
  created_at: string
}

export interface UyushmaParking {
  id: string
  uyushma_id: string
  name: string
  lat: number
  lng: number
  radius_m: number
  capacity: number
  current_vehicle_count: number
  is_active: boolean
  created_at: string
}

export type FareRuleType = 'fixed' | 'distance' | 'zone' | 'time_based'

export interface UyushmaFareRule {
  id: string
  uyushma_id: string
  name: string
  rule_type: FareRuleType
  amount: number
  target_route_id?: string
  target_route_number?: string
  per_km_rate?: number
  included_km?: number
  cross_zone_extra?: number
  peak_multiplier?: number
  peak_start_hour?: number
  peak_end_hour?: number
  is_active: boolean
  description?: string
  created_at: string
}
