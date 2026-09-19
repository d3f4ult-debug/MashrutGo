// ── Uyushma (Organization) Domain Types (Stage 4) ──

export interface UyushmaKPIs {
  uyushma_id: string;
  owned_routes_count: number;
  active_shifts_count: number;
  visible_vehicles_count: number;
  parkings_count: number;
  today_payments_total: number;
  today_payments_count: number;
  pending_cashouts_count: number;
  pending_cashouts_total: number;
}

export interface RouteDirectionConfig {
  id: string;
  direction: 'outbound' | 'inbound';
  start_name: string;
  end_name: string;
  stops_count: number;
  distance_km: number;
  estimated_duration_min: number;
  is_active: boolean;
}

export interface UyushmaRoute {
  id: string;
  uyushma_id: string;
  route_number: string;      // e.g. "12" or "101"
  route_name: string;        // e.g. "O'sh ko'chasi — Yangi Bozor"
  description?: string;
  is_active: boolean;
  assigned_vehicles_count: number;
  assigned_drivers_count: number;
  directions: RouteDirectionConfig[];
  created_at: string;
}

export interface UyushmaDriver {
  id: string;
  uyushma_id: string;
  full_name: string;
  phone: string;
  email: string;
  is_active: boolean;
  assigned_vehicle_id?: string;
  assigned_vehicle_plate?: string;
  assigned_route_id?: string;
  assigned_route_number?: string;
  active_shift?: {
    id: string;
    started_at: string;
    is_online: boolean;
  } | null;
  created_at: string;
}

export type VehicleType = 'minibus' | 'bus' | 'damas' | 'isuzu' | 'other';

export interface UyushmaVehicle {
  id: string;                 // internal ID (mandatory, e.g. "VEH-101")
  uyushma_id: string;
  license_plate?: string;     // optional e.g. "60 A 777 AA"
  model?: string;             // optional e.g. "Isuzu NP37"
  color?: string;             // optional e.g. "Oq"
  type?: VehicleType;         // optional
  is_active: boolean;
  assigned_route_id?: string;
  assigned_route_number?: string;
  assigned_driver_id?: string;
  assigned_driver_name?: string;
  is_on_shift?: boolean;
  created_at: string;
}

export interface UyushmaParking {
  id: string;
  uyushma_id: string;
  name: string;              // e.g. "Eski shahar bosh bekati"
  lat: number;
  lng: number;
  radius_m: number;          // geofence radius (e.g. 100 meters)
  capacity: number;          // max parking slots
  current_vehicle_count: number;
  is_active: boolean;
  created_at: string;
}

export type FareRuleType = 'fixed' | 'distance' | 'zone' | 'time_based';

export interface UyushmaFareRule {
  id: string;
  uyushma_id: string;
  name: string;              // e.g. "Standart shahar tarifi"
  rule_type: FareRuleType;   // MVP fixed, extensible to distance/zone/time_based
  amount: number;            // in UZS (base fare)
  target_route_id?: string;  // null/undefined for all routes
  target_route_number?: string;
  per_km_rate?: number;      // for distance rule
  included_km?: number;      // for distance rule
  cross_zone_extra?: number; // for zone rule
  peak_multiplier?: number;  // for time_based rule
  is_active: boolean;
  description?: string;
  created_at: string;
}
