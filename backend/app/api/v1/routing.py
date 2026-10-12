from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep
from app.schemas.routing import RouteSearchRequest, RouteSearchResponse
from app.services.routing.graph_router import GraphRouter

router = APIRouter(prefix="/routing", tags=["routing"])


@router.post("/search", response_model=RouteSearchResponse)
def search_itineraries(
    payload: RouteSearchRequest,
    db: Session = Depends(get_db_dep),
):
    """
    Multi-modal A to B route search (POST JSON):
    - Calculates walking-only baseline (0 UZS fare)
    - Calculates direct transit routes (0 transfers)
    - Calculates transfer routes (1 transfer)
    - Evaluates and tags fastest, cheapest, least_walking, and least_transfers itineraries
    - Never hides published routes if online vehicles are missing (displays no_online_vehicle_visible)
    - Accessible anonymously without authentication
    """
    response = GraphRouter.search(db, payload)
    return response


@router.get("/search", response_model=RouteSearchResponse)
def search_itineraries_get(
    origin_lat: float = Query(..., description="Origin latitude, e.g. 40.7821"),
    origin_lng: float = Query(..., description="Origin longitude, e.g. 72.3442"),
    dest_lat: float = Query(..., description="Destination latitude, e.g. 40.7741"),
    dest_lng: float = Query(..., description="Destination longitude, e.g. 72.3612"),
    mode: str = Query("fastest", description="Optimization mode (fastest, cheapest, least_walking, least_transfers)"),
    db: Session = Depends(get_db_dep),
):
    """
    Multi-modal A to B route search (GET Query Parameters):
    Convenience endpoint for Client PWA URL-based routing queries.
    """
    from app.schemas.routing import CoordinateInput, RoutingPreferences
    payload = RouteSearchRequest(
        origin=CoordinateInput(lat=origin_lat, lng=origin_lng),
        destination=CoordinateInput(lat=dest_lat, lng=dest_lng),
        preferences=RoutingPreferences(mode=mode),
    )
    return GraphRouter.search(db, payload)
