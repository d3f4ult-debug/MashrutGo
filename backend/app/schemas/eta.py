from typing import Optional
from pydantic import BaseModel, Field


class ETARequest(BaseModel):
    route_id: int
    direction: str = Field("outbound", description="'outbound' or 'inbound'")
    stop_lat: float
    stop_lng: float


class ETAResponse(BaseModel):
    route_id: int
    direction: str
    has_approaching_vehicle: bool
    approaching_vehicle_id: Optional[str] = None
    plate_number: Optional[str] = None
    eta_seconds: Optional[int] = None
    eta_minutes: Optional[int] = None
    distance_meters: Optional[int] = None
    speed_kmh: Optional[float] = None
    confidence: float
    status: str  # "approaching", "in_parking", "no_approaching_vehicle", "arriving_now"
    boarding_stop_name: Optional[str] = None
