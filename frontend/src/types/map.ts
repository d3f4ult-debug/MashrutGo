// ── Map & realtime types used by Driver live map ──

/** GeoJSON LineString for route geometry */
export interface RouteGeometry {
  type: 'LineString';
  coordinates: [number, number][]; // [lng, lat]
}

/** Route direction with geometry from backend */
export interface RouteDirection {
  id: string;
  route_id: string;
  direction: 'outbound' | 'inbound';
  start_name: string;
  end_name: string;
  geometry: RouteGeometry;
}

/** Assigned route info for the driver */
export interface DriverRouteInfo {
  route_id: string;
  route_number: string;
  route_name: string;
  directions: RouteDirection[];
}

/** Waiting client marker — client in "Kutayapman" state */
export interface WaitingClient {
  session_id: string;      // no PII, just session/marker ID
  lat: number;
  lng: number;
  timestamp: number;       // Unix ms
}

/** Parking/stoyanka geofence status */
export interface ParkingStatus {
  parking_id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  vehicle_count: number;
  is_driver_inside: boolean;
}

// ── WebSocket event types ──

export type WsEventType =
  | 'client.watch.started'
  | 'client.watch.updated'
  | 'client.watch.stopped'   // "Mashinadaman" or explicit stop
  | 'parking.count.updated'
  | 'vehicle.location.updated'
  | 'payment.received'
  | 'payment.refunded'
  | 'cashout.status_updated';

export interface WsEvent<T = unknown> {
  type: WsEventType;
  payload: T;
  timestamp: number;
}

/** Payload for client.watch.started / .updated */
export interface ClientWatchPayload {
  session_id: string;
  lat: number;
  lng: number;
}

/** Payload for client.watch.stopped ("Mashinadaman") */
export interface ClientWatchStoppedPayload {
  session_id: string;
}

/** Payload for parking.count.updated */
export interface ParkingCountPayload {
  parking_id: string;
  vehicle_count: number;
  is_driver_inside: boolean;
}
