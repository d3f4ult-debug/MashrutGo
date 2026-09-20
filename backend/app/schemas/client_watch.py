from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class WatchStartRequest(BaseModel):
    route_id: int
    direction: str = Field("outbound", pattern="^(outbound|inbound)$")
    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)
    accuracy_meters: Optional[float] = Field(None, ge=0.0, le=5000.0)
    session_id: Optional[str] = Field(
        None, min_length=16, max_length=64,
        description="Optional client-generated secret; generated server-side when omitted",
    )


class WatchHeartbeatRequest(BaseModel):
    watch_id: int
    session_id: str = Field(..., min_length=16, max_length=64)
    lat: Optional[float] = Field(None, ge=-90.0, le=90.0)
    lng: Optional[float] = Field(None, ge=-180.0, le=180.0)


class WatchStopRequest(BaseModel):
    watch_id: int
    session_id: str = Field(..., min_length=16, max_length=64)


class WatchResponse(BaseModel):
    id: int
    watch_id: Optional[int] = None
    client_session_id: str
    route_id: int
    direction: str
    lat: float
    lng: float
    status: str  # active, on_car, stopped, expired
    started_at: datetime
    expires_at: datetime

    model_config = ConfigDict(from_attributes=True)

    def model_post_init(self, __context):
        if self.watch_id is None:
            self.watch_id = self.id


class RideStateUpdateRequest(BaseModel):
    watch_id: int
    session_id: str = Field(..., min_length=16, max_length=64)
    state: str = Field(..., pattern="^(on_car|exited)$", description="'on_car' (Mashinadaman) or 'exited' (Tushdim)")
    vehicle_id: Optional[int] = Field(None, description="Optional concrete vehicle identifier if scanned via QR")


class RideStateResponse(BaseModel):
    id: int
    route_id: Optional[int] = None
    vehicle_id: Optional[int] = None
    state: str  # waiting, on_car, exited
    boarded_at: Optional[datetime] = None
    exited_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CurrentRideResponse(BaseModel):
    active: bool
    watch: Optional[WatchResponse] = None
    ride_state: Optional[RideStateResponse] = None


class WaitingPassengerResponse(BaseModel):
    watch_id: int
    route_id: int
    direction: str
    client_lat: float
    client_lng: float
    waiting_since: datetime
    action: str = "active"


class WaitingPassengersListResponse(BaseModel):
    route_id: int
    direction: Optional[str] = None
    total_waiting: int
    passengers: List[WaitingPassengerResponse]
