import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep
from app.schemas.eta import ETAResponse
from app.services.rate_limit import eta_limiter, limit_by_ip
from app.services.routing.eta_service import eta_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/routing", tags=["routing"])


@router.get("/eta", response_model=ETAResponse)
def get_live_eta(
    request: Request,
    route_id: int = Query(..., description="ID of route"),
    direction: str = Query("outbound", pattern="^(outbound|inbound)$"),
    stop_lat: float = Query(..., ge=-90, le=90, description="Boarding stop latitude"),
    stop_lng: float = Query(..., ge=-180, le=180, description="Boarding stop longitude"),
    stop_name: Optional[str] = Query(None, max_length=150, description="Optional stop name"),
    db: Session = Depends(get_db_dep),
):
    """
    Calculate real-time map-matched ETA to a specific boarding stop.
    Returns approaching vehicle information, distance, and ETA in minutes/seconds.
    If no vehicle is approaching, returns null values with status 'no_approaching_vehicle'.
    """
    limit_by_ip(eta_limiter, request, "Juda ko'p ETA so'rovi. Bir oz kutib qayta urining.")
    try:
        response = eta_service.calculate_eta(
            route_id=route_id,
            direction_type=direction,
            stop_lat=stop_lat,
            stop_lng=stop_lng,
            db=db,
            stop_name=stop_name,
        )
        return response
    except Exception as exc:
        logger.error(f"Error calculating ETA for route {route_id}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to calculate ETA",
        ) from exc
