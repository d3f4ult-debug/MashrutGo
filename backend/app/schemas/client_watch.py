from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class WatchStartRequest(BaseModel):
    route_id: int
    direction: str = Field("outbound", description="'outbound' or 'inbound'")
    lat: float
    lng: float
    accuracy_meters: Optional[float] = Field(5.0, ge=0.0)
    session_id: Optional[str] = Field(None, description="Client-generated UUID or persistent session ID")


class WatchHeartbeatRequest(BaseModel):
    watch_id: int
    lat: Optional[float] = None
    lng: Optional[float] = None


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
    state: str = Field(..., description="'waiting', 'on_car', or 'exited'")
    vehicle_id: Optional[int] = Field(None, description="Optional concrete vehicle identifier if scanned via QR")


class RideStateResponse(BaseModel):
    id: int
    client_session_id: str
    route_id: Optional[int] = None
    vehicle_id: Optional[int] = None
    state: str  # waiting, on_car, exited
    boarded_at: Optional[datetime] = None
    exited_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


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
