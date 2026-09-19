// ── Realtime Fleet Operations Types (Stage 8) ──

export type ShiftStatus = 'on_route' | 'in_parking' | 'shift_ended' | 'offline';

export interface LiveVehicleTelemetry {
  vehicle_id: string;
  plate_number: string;
  model: string;
  color?: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string;
  driver_avatar?: string;
  uyushma_id: string;
  uyushma_name: string;
  route_id: string;
  route_number: string;
  direction: 'outbound' | 'inbound';
  lat: number;
  lng: number;
  heading: number;        // in degrees 0-360
  speed_kmh: number;      // km/h
  shift_status: ShiftStatus;
  last_seen: number;      // Unix timestamp (ms)
  is_stale?: boolean;     // computed: true if no GPS for >30s
  is_offline?: boolean;   // computed: true if no GPS for >120s or shift ended
  assigned_parking_id?: string;
}

export interface LiveParkingZone {
  id: string;
  name: string;
  uyushma_id: string;
  lat: number;
  lng: number;
  radius_m: number;
  current_vehicles_count: number;
  capacity: number;
}

export interface RouteOption {
  id: string;
  number: string;
  name: string;
  color?: string;
  active_vehicles_count: number;
}
