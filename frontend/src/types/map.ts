// ── Realtime contract types (docs/contracts/REALTIME_EVENTS.md) ──

// ── WebSocket events (server -> client), see docs/contracts/REALTIME_EVENTS.md ──

export type WsEventType =
  | 'vehicle.location.updated'
  | 'route.vehicle.status'
  | 'parking.count.updated'
  | 'parking.status'
  | 'client.nearby.snapshot'
  | 'client.nearby.broadcast'
  | 'client.nearby.removed'
  | 'payment.received'
  | 'payment.refunded'
  | 'cashout.status_updated'
  | 'shift.force_ended'
  | 'subscribed'
  | 'error'

export interface WsEvent<T = unknown> {
  type: WsEventType
  payload: T
  timestamp: number
}

export interface VehicleLocationPayload {
  vehicle_id: string
  plate_number?: string | null
  route_id: number
  route_number: string
  direction: 'outbound' | 'inbound'
  lat: number
  lng: number
  heading: number
  speed_kmh: number
  accuracy_meters: number
  captured_at: string
  is_stale: boolean
  parking_id?: number | null
  parking_name?: string | null
}

export interface RouteStatusPayload {
  route_id: number
  route_number: string
  online_vehicles_count: number
  status: 'online' | 'no_online_vehicle_visible'
  has_live_vehicles: boolean
}

export interface NearbyClientPayload {
  watch_id: string
  route_id: number
  direction: 'outbound' | 'inbound'
  client_lat: number
  client_lng: number
  waiting_since: string | null
  action: 'active' | 'updated'
}

export interface NearbyRemovedPayload {
  watch_id: string
  reason: 'on_car' | 'exited' | 'cancelled' | 'expired' | 'replaced'
}

export interface NearbySnapshotPayload {
  route_id: number
  passengers: NearbyClientPayload[]
}

export interface ParkingCountPayload {
  parking_id: number
  parking_name: string
  vehicle_count: number
}

export interface DriverParkingPayload {
  parking_id: number | null
  parking_name: string | null
  is_inside: boolean
}
