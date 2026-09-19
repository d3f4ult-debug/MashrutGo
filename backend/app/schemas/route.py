from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict


class CoordinatePoint(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0, examples=[40.7821])
    lng: float = Field(..., ge=-180.0, le=180.0, examples=[72.3442])
    name: Optional[str] = Field(None, examples=["Andijon Vokzali"])


class WaypointBase(BaseModel):
    order: int = Field(..., ge=1, examples=[1])
    name: Optional[str] = Field(None, examples=["Yangi Bozor"])
    lat: float = Field(..., ge=-90.0, le=90.0, examples=[40.7712])
    lng: float = Field(..., ge=-180.0, le=180.0, examples=[72.3501])
    is_stop: bool = Field(True, description="Whether transport stops for boarding/alighting")


class WaypointCreate(WaypointBase):
    pass


class WaypointRead(WaypointBase):
    id: int
    route_direction_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RouteDirectionBase(BaseModel):
    direction_type: str = Field(..., pattern="^(outbound|inbound)$", examples=["outbound"])
    origin_name: str = Field(..., examples=["Andijon shahar vokzali"])
    destination_name: str = Field(..., examples=["Asaka markaz"])
    origin_lat: float = Field(..., ge=-90.0, le=90.0, examples=[40.7821])
    origin_lng: float = Field(..., ge=-180.0, le=180.0, examples=[72.3442])
    destination_lat: float = Field(..., ge=-90.0, le=90.0, examples=[40.7554])
    destination_lng: float = Field(..., ge=-180.0, le=180.0, examples=[72.3610])
    polyline: Optional[str] = None
    distance_meters: int = 0
    duration_seconds: int = 0


class RouteDirectionCreate(RouteDirectionBase):
    pass


class RouteDirectionRead(RouteDirectionBase):
    id: int
    route_id: int
    waypoints: List[WaypointRead] = []
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RouteBase(BaseModel):
    route_number: str = Field(..., min_length=1, max_length=20, examples=["1", "10A", "22"])
    name: str = Field(..., min_length=2, max_length=150, examples=["Vokzal — Eski Shahar"])
    description: Optional[str] = Field(None, max_length=500)


class RouteCreate(RouteBase):
    uyushma_id: Optional[int] = None


class RouteUpdate(BaseModel):
    route_number: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    is_published: Optional[bool] = None


class RouteRead(RouteBase):
    id: int
    uyushma_id: int
    is_published: bool
    directions: List[RouteDirectionRead] = []
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RouteListItem(RouteBase):
    id: int
    uyushma_id: int
    is_published: bool
    directions_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AutoPathRequest(BaseModel):
    origin: CoordinatePoint
    destination: CoordinatePoint
    waypoints: List[CoordinatePoint] = []
    profile: str = Field("driving", examples=["driving"])


class AutoPathResponse(BaseModel):
    distance_meters: int
    duration_seconds: int
    geojson: Dict[str, Any]
    polyline: str
    provider: str


class RoutePublishRequest(BaseModel):
    is_published: bool
