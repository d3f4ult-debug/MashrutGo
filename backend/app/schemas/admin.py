from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict

from app.schemas.driver import LiveVehicleStateResponse


# --- Dashboard Summary ---
class DashboardSummaryResponse(BaseModel):
    total_uyushmas: int
    total_routes: int
    published_routes: int
    total_drivers: int
    active_drivers: int
    total_vehicles: int
    active_vehicles: int
    online_vehicles_count: int
    active_shifts_count: int
    total_parkings: int
    vehicles_in_parking_count: int
    total_clients: int
    total_transactions_count: int
    total_transaction_volume_uzs: int
    total_payments_count: int
    total_payment_volume_uzs: int
    total_refunds_count: int
    total_refund_volume_uzs: int
    pending_cashouts_count: int
    pending_cashout_amount_uzs: int


# --- Vehicle CRUD & Filter ---
class VehicleCreateRequest(BaseModel):
    internal_id: Optional[str] = Field(None, description="Unique vehicle code, auto-generated if omitted (e.g. AND-101)")
    uyushma_id: Optional[int] = Field(None, description="Uyushma ID. If omitted, uses current admin's uyushma")
    driver_id: Optional[int] = None
    route_id: Optional[int] = None
    plate_number: Optional[str] = None
    model: str = "Damas"
    color: Optional[str] = None
    capacity: int = Field(7, ge=1, le=100)
    is_active: bool = True


class VehicleUpdateRequest(BaseModel):
    driver_id: Optional[int] = None
    route_id: Optional[int] = None
    plate_number: Optional[str] = None
    model: Optional[str] = None
    color: Optional[str] = None
    capacity: Optional[int] = None
    is_active: Optional[bool] = None


class VehicleDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    internal_id: str
    uyushma_id: int
    uyushma_name: Optional[str] = None
    driver_id: Optional[int] = None
    driver_name: Optional[str] = None
    route_id: Optional[int] = None
    route_number: Optional[str] = None
    plate_number: Optional[str] = None
    model: Optional[str] = "Damas"
    color: Optional[str] = None
    capacity: int = 7
    is_active: bool = True
    is_online: bool = False
    created_at: datetime
    updated_at: datetime


class VehicleListResponse(BaseModel):
    items: List[VehicleDetailResponse]
    total: int
    page: int
    size: int
    pages: int


# --- Driver CRUD & Filter ---
class DriverUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    license_number: Optional[str] = None
    is_active: Optional[bool] = None
    uyushma_id: Optional[int] = None


class DriverDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    uyushma_id: int
    uyushma_name: Optional[str] = None
    full_name: str
    phone: str
    license_number: Optional[str] = None
    is_active: bool
    assigned_vehicle_id: Optional[int] = None
    assigned_vehicle_internal_id: Optional[str] = None
    has_active_shift: bool = False
    wallet_balance_uzs: int = 0
    created_at: datetime


class DriverListResponse(BaseModel):
    items: List[DriverDetailResponse]
    total: int
    page: int
    size: int
    pages: int


# --- Tariff / FareRule CRUD & Filter ---
class TariffCreateRequest(BaseModel):
    uyushma_id: Optional[int] = None
    route_id: Optional[int] = None
    rule_type: str = Field("fixed", pattern="^(fixed|distance|zone)$")
    base_fare_uzs: int = Field(2500, gt=0)
    extra_fare_per_km_uzs: int = Field(0, ge=0)
    is_active: bool = True


class TariffUpdateRequest(BaseModel):
    rule_type: Optional[str] = None
    base_fare_uzs: Optional[int] = None
    extra_fare_per_km_uzs: Optional[int] = None
    is_active: Optional[bool] = None


class TariffResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    uyushma_id: int
    uyushma_name: Optional[str] = None
    route_id: Optional[int] = None
    route_number: Optional[str] = None
    rule_type: str
    base_fare_uzs: int
    extra_fare_per_km_uzs: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TariffListResponse(BaseModel):
    items: List[TariffResponse]
    total: int
    page: int
    size: int
    pages: int


# --- Client Management ---
class ClientDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int  # User id
    phone: str
    full_name: str
    is_active: bool
    preferred_language: str = "uz"
    wallet_balance_uzs: int = 0
    rides_count: int = 0
    created_at: datetime


class ClientUpdateRequest(BaseModel):
    is_active: Optional[bool] = None
    full_name: Optional[str] = None


class ClientListResponse(BaseModel):
    items: List[ClientDetailResponse]
    total: int
    page: int
    size: int
    pages: int


# --- Shift Monitoring ---
class ShiftDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    driver_id: int
    driver_name: Optional[str] = None
    vehicle_id: int
    vehicle_internal_id: Optional[str] = None
    route_id: int
    route_number: Optional[str] = None
    direction: str
    status: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    last_gps_at: Optional[datetime] = None


class ShiftListResponse(BaseModel):
    items: List[ShiftDetailResponse]
    total: int
    page: int
    size: int
    pages: int


# --- System Settings CRUD ---
class SettingCreateRequest(BaseModel):
    key: str = Field(..., max_length=100)
    value: str
    description: Optional[str] = None


class SettingUpdateRequest(BaseModel):
    value: str
    description: Optional[str] = None


class SettingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    value: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# --- Audit Logs ---
class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_user_id: Optional[int] = None
    actor_role: Optional[str] = None
    action: str
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    changes_json: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    items: List[AuditLogResponse]
    total: int
    page: int
    size: int
    pages: int


# --- Live Status Overview ---
class LiveStatusOverviewResponse(BaseModel):
    online_vehicles: List[LiveVehicleStateResponse]
    total_online: int
    by_route: Dict[str, int]
    in_parking_count: int
