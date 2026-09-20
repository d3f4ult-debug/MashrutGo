from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class DeviceTokenRegister(BaseModel):
    token: str = Field(..., min_length=20, max_length=512)
    platform: str = Field("android", pattern="^(android|ios|web)$")
    app_version: Optional[str] = Field(None, max_length=30)


class NotificationRead(BaseModel):
    id: int
    title: str
    body: str
    notification_type: str
    data: Dict[str, Any] = {}
    is_read: bool
    created_at: datetime


class PlaceRead(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    address: str
    kind: str
    source: str


class LiveFleetVehicle(BaseModel):
    vehicle_pk: int
    vehicle_id: str  # internal id (same key as realtime events)
    plate_number: Optional[str] = None
    model: Optional[str] = None
    color: Optional[str] = None
    driver_id: int
    driver_name: str
    driver_phone: str
    uyushma_id: int
    uyushma_name: str
    route_id: int
    route_number: str
    route_name: Optional[str] = None
    direction: str
    has_fix: bool
    lat: Optional[float] = None
    lng: Optional[float] = None
    heading: float = 0.0
    speed_kmh: float = 0.0
    shift_status: str  # on_route, in_parking, awaiting_gps, stale
    shift_started_at: datetime
    last_seen: Optional[datetime] = None
    is_stale: bool
    parking_id: Optional[int] = None
    parking_name: Optional[str] = None
