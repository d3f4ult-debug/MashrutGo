from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep
from app.schemas.misc import PlaceRead
from app.services.geo_service import search_places

router = APIRouter(prefix="/geo", tags=["geo"])


@router.get("/search", response_model=List[PlaceRead])
async def geo_search(
    q: str = Query(..., min_length=2, max_length=100),
    limit: int = Query(8, ge=1, le=20),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
    db: Session = Depends(get_db_dep),
):
    """Places for A/B pickers: real stops/terminals/stoyankas from the DB plus MapTiler geocoding."""
    near = (lat, lng) if lat is not None and lng is not None else None
    places = await search_places(db, q, limit=limit, near=near)
    return [PlaceRead(**p.__dict__) for p in places]
