from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict


class ShiftStartRequest(BaseModel):
    direction: str = Field("outbound", pattern="^(outbound|inbound)$", examples=["outbound"])


class ShiftEndRequest(BaseModel):
    notes: Optional[str] = None


class ShiftResponse(BaseModel):
    id: int
    driver_id: int
    vehicle_id: int
    route_id: int
    direction: str
    status: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    last_gps_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class GPSPointInput(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0, examples=[40.7821])
    lng: float = Field(..., ge=-180.0, le=180.0, examples=[72.3442])
    speed_kmh: float = Field(0.0, ge=0.0, le=200.0, examples=[32.5])
    heading: float = Field(0.0, ge=0.0, le=360.0, examples=[115.0])
    accuracy_meters: float = Field(5.0, ge=0.0, le=500.0, examples=[4.2])
    captured_at: datetime = Field(..., examples=["2026-09-19T06:30:15.000Z"])
    idempotency_key: Optional[str] = Field(None, max_length=64, examples=["550e8400-e29b-41d4-a716-446655440000"])


class GPSBatchSyncRequest(BaseModel):
    batch_id: str = Field(..., examples=["batch_12345"])
    points: List[GPSPointInput] = Field(..., min_length=1)


class GPSBatchSyncResponse(BaseModel):
    batch_id: str
    processed_count: int
    duplicate_count: int
    discarded_count: int
    latest_captured_at: Optional[datetime] = None


class LiveVehicleStateResponse(BaseModel):
    vehicle_id: str  # Vehicle internal_id
    route_id: int
    route_number: str
    direction: str
    lat: float
    lng: float
    speed_kmh: float
    heading: float
    accuracy_meters: float
    captured_at: datetime
    is_stale: bool = False
    parking_id: Optional[int] = None
    parking_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ParkingCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=150, examples=["Andijon Markaziy Avtovokzal"])
    lat: float = Field(..., ge=-90.0, le=90.0, examples=[40.7821])
    lng: float = Field(..., ge=-180.0, le=180.0, examples=[72.3442])
    radius_meters: int = Field(100, ge=10, le=1000, examples=[100])
    capacity: Optional[int] = Field(None, ge=1, le=500, examples=[50])
    uyushma_id: Optional[int] = None


class ParkingResponse(BaseModel):
    id: int
    name: str
    lat: float
    lng: float
    radius_meters: int
    capacity: Optional[int] = None
    is_active: bool
    vehicle_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
