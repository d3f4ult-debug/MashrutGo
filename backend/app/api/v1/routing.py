from fastapi import APIRouter, Depends
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
    Multi-modal A to B route search:
    - Calculates walking-only baseline (0 UZS fare)
    - Calculates direct transit routes (0 transfers)
    - Calculates transfer routes (1 transfer)
    - Evaluates and tags fastest, cheapest, least_walking, and least_transfers itineraries
    - Never hides published routes if online vehicles are missing (displays no_online_vehicle_visible)
    - Accessible anonymously without authentication
    """
    response = GraphRouter.search(db, payload)
    return response
