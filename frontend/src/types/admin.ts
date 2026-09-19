// ── Super Admin Domain Types (Stage 7) ──

export interface AdminGlobalKPIs {
  total_uyushmalar: number;
  total_routes: number;
  total_drivers: number;
  total_vehicles: number;
  active_shifts: number;
  total_clients: number;
  total_parkings: number;
  today_gross_revenue: number;
  today_platform_commission: number;
  system_status: 'healthy' | 'degraded' | 'maintenance';
}

export interface AdminUyushma {
  id: string;
  name: string;
  region: string;             // e.g. "Andijon viloyati"
  contact_person: string;
  contact_phone: string;
  admin_email: string;
  license_number: string;
  routes_count: number;
  drivers_count: number;
  vehicles_count: number;
  status: 'active' | 'archived';
  created_at: string;
}

export interface AdminClientUser {
  id: string;
  phone: string;
  full_name?: string;
  wallet_balance: number;     // in UZS
  total_rides: number;
  is_blocked: boolean;
  block_reason?: string;
  last_active_at: string;
  created_at: string;
}

export interface AdminLiveShift {
  id: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string;
  uyushma_id: string;
  uyushma_name: string;
  vehicle_id: string;
  vehicle_plate: string;
  route_id: string;
  route_number: string;
  started_at: string;
  last_heartbeat_at: string;
  is_online: boolean;
  current_lat?: number;
  current_lng?: number;
}

export interface AdminSystemSettings {
  gps_interval_seconds: number;       // default 5s
  refund_window_minutes: number;      // default 30 min
  platform_commission_percent: number;// default 1.0%
  maintenance_mode: boolean;
  fcm_notifications_enabled: boolean;
  max_unassigned_vehicles: number;
  updated_at: string;
  updated_by: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_name: string;
  actor_role: string;
  action_type:
    | 'create_uyushma'
    | 'archive_uyushma'
    | 'block_client'
    | 'unblock_client'
    | 'force_end_shift'
    | 'update_system_settings'
    | 'reject_cashout'
    | 'refund_payment';
  entity_type: 'uyushma' | 'client' | 'shift' | 'settings' | 'cashout' | 'payment';
  entity_id: string;
  description: string;
  audit_reason?: string;
  ip_address?: string;
}
