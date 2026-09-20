from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class AdminKPIs(BaseModel):
    total_uyushmalar: int
    total_routes: int
    published_routes: int
    total_drivers: int
    total_vehicles: int
    active_shifts: int
    visible_vehicles: int
    total_clients: int
    total_parkings: int
    today_gross_revenue: int
    today_platform_commission: int
    today_payments_count: int
    pending_cashouts_count: int
    system_status: str  # healthy, maintenance


class AdminClientRead(BaseModel):
    id: int
    phone: str
    full_name: str
    wallet_balance: int
    total_rides: int
    is_blocked: bool
    block_reason: Optional[str] = None
    last_active_at: Optional[datetime] = None
    created_at: datetime


class BlockRequest(BaseModel):
    block: bool
    reason: Optional[str] = Field(None, max_length=255)


class AdminShiftRead(BaseModel):
    id: int
    driver_id: int
    driver_name: str
    driver_phone: str
    uyushma_id: int
    uyushma_name: str
    vehicle_id: int
    vehicle_internal_id: str
    vehicle_plate: Optional[str] = None
    route_id: int
    route_number: str
    direction: str
    started_at: datetime
    last_gps_at: Optional[datetime] = None
    is_online: bool
    current_lat: Optional[float] = None
    current_lng: Optional[float] = None


class SystemSettingsRead(BaseModel):
    gps_interval_seconds: int
    refund_window_minutes: int
    platform_commission_percent: float
    maintenance_mode: bool
    fcm_notifications_enabled: bool
    max_unassigned_vehicles: int
    min_topup_uzs: int
    max_topup_uzs: int
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None


class SystemSettingsUpdate(BaseModel):
    gps_interval_seconds: Optional[int] = None
    refund_window_minutes: Optional[int] = None
    platform_commission_percent: Optional[float] = None
    maintenance_mode: Optional[bool] = None
    fcm_notifications_enabled: Optional[bool] = None
    max_unassigned_vehicles: Optional[int] = None
    min_topup_uzs: Optional[int] = None
    max_topup_uzs: Optional[int] = None


class AuditLogRead(BaseModel):
    id: int
    created_at: datetime
    actor_user_id: Optional[int] = None
    actor_name: Optional[str] = None
    actor_role: Optional[str] = None
    action: str
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    uyushma_id: Optional[int] = None
    reason: Optional[str] = None
    changes: Optional[Any] = None
    ip_address: Optional[str] = None


class LedgerHealthRead(BaseModel):
    wallets_checked: int
    inconsistent_wallets: list[int]
