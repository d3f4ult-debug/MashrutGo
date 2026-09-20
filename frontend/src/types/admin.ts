// ── Super Admin view models (mapped from backend DTOs in services/api/adminApi.ts) ──
// Ids are strings in the UI (consistent with the other role modules); timestamps are raw ISO UTC
// strings from the API and must be rendered with utils/format helpers.

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  size: number
  pages: number
}

/** `GET /admin/kpis` */
export interface AdminGlobalKPIs {
  total_uyushmalar: number
  total_routes: number
  published_routes: number
  total_drivers: number
  total_vehicles: number
  active_shifts: number
  /** Vehicles with a fresh GPS fix (what passengers currently see on the map). */
  visible_vehicles: number
  total_clients: number
  total_parkings: number
  today_gross_revenue: number
  today_platform_commission: number
  today_payments_count: number
  pending_cashouts_count: number
  /** `healthy` | `maintenance` today; kept open so a new backend state is shown verbatim. */
  system_status: string
}

export type UyushmaStatus = 'active' | 'archived'

/** Uyushma fields shared by `UyushmaRead` (create response) and the admin list. */
export interface AdminUyushmaCore {
  id: string
  name: string
  code: string
  phone: string
  address?: string
  region?: string
  contact_person?: string
  license_number?: string
  status: UyushmaStatus
  archived_at: string | null
  archive_reason?: string
  created_at: string
}

/** `GET /admin/uyushmalar` item (`UyushmaAdminRead`). */
export interface AdminUyushma extends AdminUyushmaCore {
  routes_count: number
  drivers_count: number
  vehicles_count: number
  /** Login phone of the Uyushma admin account, if one exists. */
  admin_phone?: string
}

export interface AdminUyushmaAdminAccountInput {
  full_name: string
  phone: string
  password: string
}

export interface AdminUyushmaCreateInput {
  name: string
  code: string
  phone: string
  address?: string
  region?: string
  contact_person?: string
  license_number?: string
  /** Uyushma admin login created in the same transaction (all three fields or none). */
  admin?: AdminUyushmaAdminAccountInput | null
}

export interface AdminUyushmaUpdateInput {
  name?: string
  phone?: string
  address?: string
  region?: string
  contact_person?: string
  license_number?: string
}

/** `GET /admin/clients` item. */
export interface AdminClientUser {
  id: string
  phone: string
  full_name: string
  wallet_balance: number
  total_rides: number
  is_blocked: boolean
  block_reason?: string
  last_active_at: string | null
  created_at: string
}

export interface AdminClientQuery {
  search?: string
  status?: 'active' | 'blocked'
  page?: number
  size?: number
}

/** Ledger entry returned by `POST /admin/wallets/{user_id}/adjust`. */
export interface WalletLedgerEntry {
  id: string
  entry_type: string
  amount_uzs: number
  balance_after_uzs: number
  reference_type?: string
  reference_id?: string
  description: string
  created_at: string
}

/** `GET /admin/ledger/health` */
export interface LedgerHealth {
  wallets_checked: number
  inconsistent_wallet_ids: string[]
  is_consistent: boolean
}

/** `GET /admin/shifts/live` item — every row is an ACTIVE shift. */
export interface AdminLiveShift {
  id: string
  driver_id: string
  driver_name: string
  driver_phone: string
  uyushma_id: string
  uyushma_name: string
  vehicle_id: string
  vehicle_internal_id: string
  vehicle_plate?: string
  route_id: string
  route_number: string
  /** `outbound` | `inbound` */
  direction: string
  started_at: string
  last_gps_at: string | null
  /** Fresh GPS fix (visible on the passenger map). False = "GPS ko'rinmayapti", not "no vehicle". */
  is_online: boolean
  current_lat: number | null
  current_lng: number | null
}

/** Editable settings (keys mirror backend SETTING_SPECS). */
export interface AdminSettingsValues {
  gps_interval_seconds: number
  refund_window_minutes: number
  platform_commission_percent: number
  maintenance_mode: boolean
  fcm_notifications_enabled: boolean
  max_unassigned_vehicles: number
  min_topup_uzs: number
  max_topup_uzs: number
}

/** `GET/PUT /admin/settings` */
export interface AdminSystemSettings extends AdminSettingsValues {
  updated_at: string | null
  updated_by: string | null
}

export type NumericSettingKey = {
  [K in keyof AdminSettingsValues]: AdminSettingsValues[K] extends number ? K : never
}[keyof AdminSettingsValues]

export type BooleanSettingKey = Exclude<keyof AdminSettingsValues, NumericSettingKey>

export interface NumericSettingSpec {
  min: number
  max: number
  integer: boolean
}

/** `GET /admin/audit-logs` item. `changes` is arbitrary JSON recorded by the backend. */
export interface AuditLogEntry {
  id: string
  created_at: string
  actor_user_id: string | null
  actor_name: string | null
  actor_role: string | null
  action: string
  target_type: string | null
  target_id: string | null
  uyushma_id: string | null
  reason: string | null
  changes: unknown
  ip_address: string | null
}

export interface AuditLogFilters {
  /** Case-insensitive substring match on the action string (e.g. `client.`). */
  action?: string
  target_type?: string
  actor_user_id?: string
  uyushma_id?: string
  /** Local calendar dates `YYYY-MM-DD` (converted to UTC day bounds for the API). */
  date_from?: string
  date_to?: string
  page?: number
  size?: number
}
