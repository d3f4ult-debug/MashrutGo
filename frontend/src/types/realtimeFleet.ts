// ── Realtime operations fleet (Uyushma / Super Admin live map) ──
// Built from GET /operations/live-fleet (REST snapshot) + public WebSocket events.

/**
 * - on_route      fresh GPS fix outside every parking geofence
 * - in_parking    fresh GPS fix inside a parking geofence
 * - stale         last fix older than the stale threshold (position kept, not live)
 * - awaiting_gps  shift started, no GPS fix received yet (listed, not drawn on the map)
 */
export type FleetStatus = 'on_route' | 'in_parking' | 'stale' | 'awaiting_gps'

export type FleetDirection = 'outbound' | 'inbound'

/** One vehicle on an active shift, as last known by the client (no computed state). */
export interface FleetVehicle {
  /** vehicle database id */
  vehicle_pk: string
  /** internal id (QR sticker) — the key used by realtime events */
  vehicle_id: string
  plate_number: string | null
  model: string | null
  color: string | null
  driver_id: string
  driver_name: string
  driver_phone: string
  uyushma_id: string
  uyushma_name: string
  route_id: string
  route_number: string
  route_name: string | null
  direction: FleetDirection
  has_fix: boolean
  lat: number | null
  lng: number | null
  heading: number
  speed_kmh: number
  /** backend already flagged the last fix as stale (cleared by a newer live fix) */
  server_stale: boolean
  shift_started_at: string
  /** GPS captured_at of the last fix (ISO UTC) */
  last_seen: string | null
  last_seen_ms: number | null
  parking_id: string | null
  parking_name: string | null
}

/** FleetVehicle + state computed against the current clock. */
export interface LiveFleetVehicle extends FleetVehicle {
  status: FleetStatus
  /** ms since the last fix (null without a fix) */
  age_ms: number | null
}

export interface FleetParking {
  id: string
  uyushma_id: string | null
  name: string
  lat: number
  lng: number
  radius_m: number
  capacity: number | null
  /** live vehicles inside the geofence (fresh fixes only) */
  vehicle_count: number
  is_active: boolean
}

export interface FleetRouteOption {
  id: string
  route_number: string
  name: string | null
  /** set when routes of several tenants are mixed (Super Admin "all") */
  uyushma_name: string | null
  vehicles_count: number
}

export type FleetScope = { kind: 'all' } | { kind: 'tenant'; uyushmaId: string }

export interface FleetFilters {
  routeId: string | 'all'
  status: FleetStatus | 'all'
  search: string
}

export type FleetStatusCounts = Record<FleetStatus, number> & { total: number }

// ── Realtime payloads (backend/app/services/realtime/tracking_service.py) ──

export interface VehicleLocationEvent {
  vehicle_id: string
  plate_number?: string | null
  route_id: number
  route_number?: string
  direction?: string
  lat: number
  lng: number
  heading?: number
  speed_kmh?: number
  accuracy_meters?: number
  captured_at: string
  is_stale?: boolean
  parking_id?: number | null
  parking_name?: string | null
}

export interface RouteVehicleStatusEvent {
  route_id: number
  route_number: string
  online_vehicles_count: number
  status: string
  has_live_vehicles: boolean
}

export interface ParkingCountEvent {
  parking_id: number
  parking_name?: string
  vehicle_count: number
  vehicles?: { vehicle_id: string; route_number: string; captured_at: string }[]
}
