from typing import Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict


class CoordinateInput(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0, examples=[40.7821])
    lng: float = Field(..., ge=-180.0, le=180.0, examples=[72.3442])
    name: Optional[str] = Field(None, examples=["Andijon Vokzali"])

    model_config = ConfigDict(from_attributes=True)


class RoutingPreferences(BaseModel):
    mode: str = Field("fastest", examples=["fastest", "cheapest", "least_walking", "least_transfers"])
    max_transfers: Optional[int] = Field(None, ge=0, le=5)
    allow_walking_only: bool = Field(True, description="Always include walking-only baseline")


class RouteSearchRequest(BaseModel):
    origin: CoordinateInput
    destination: CoordinateInput
    preferences: Optional[RoutingPreferences] = None


class ItineraryLeg(BaseModel):
    leg_type: str = Field(..., examples=["walking", "transit"])
    route_id: Optional[int] = None
    route_number: Optional[str] = None
    route_name: Optional[str] = None
    direction_type: Optional[str] = None
    origin_name: str
    origin_coord: CoordinateInput
    destination_name: str
    destination_coord: CoordinateInput
    distance_meters: int
    duration_minutes: int
    fare_uzs: int = 0
    stops_count: Optional[int] = None
    polyline: Optional[str] = None
    live_status: Optional[str] = Field(None, examples=["online_vehicles_visible", "no_online_vehicle_visible"])

    model_config = ConfigDict(from_attributes=True)


class Itinerary(BaseModel):
    id: str
    mode_classification: str = Field(..., examples=["fastest", "cheapest", "least_walking", "least_transfers", "balanced"])
    mode_tags: List[str] = []
    total_duration_minutes: int
    total_distance_meters: int
    walking_distance_meters: int
    walking_duration_minutes: int
    transit_duration_minutes: int
    wait_duration_minutes: int
    transfers_count: int
    total_fare_uzs: int
    live_status: str = Field(..., examples=["online_vehicles_visible", "no_online_vehicle_visible"])
    live_confidence: float = Field(..., ge=0.0, le=1.0)
    legs: List[ItineraryLeg]

    model_config = ConfigDict(from_attributes=True)


class RouteSearchResponse(BaseModel):
    origin: CoordinateInput
    destination: CoordinateInput
    recommended: Dict[str, Itinerary]
    itineraries: List[Itinerary]

    model_config = ConfigDict(from_attributes=True)
