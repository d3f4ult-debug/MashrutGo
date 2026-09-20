"""
Place search for the client A/B pickers.

Combines real data only:
1. Stops, terminals and stoyankas from published routes in our DB (exact boarding points);
2. MapTiler geocoding (addresses/POIs), biased to the Andijon region, when a key is configured.
Nothing is invented: without a MapTiler key, only DB places are returned.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.transport import Parking, Route, RouteDirection, RouteWaypoint
from app.services.routing.maptiler_adapter import MapTilerAdapter

# Andijon viloyati bounding box: (min_lng, min_lat, max_lng, max_lat)
ANDIJON_BBOX: Tuple[float, float, float, float] = (71.90, 40.40, 73.20, 41.10)
ANDIJON_CENTER: Tuple[float, float] = (40.7829, 72.3442)  # (lat, lng)


@dataclass
class Place:
    id: str
    name: str
    lat: float
    lng: float
    address: str
    kind: str  # stop, terminal, parking, address, poi
    source: str  # db, maptiler


def _norm(value: str) -> str:
    return (
        value.lower()
        .replace("‘", "'")
        .replace("’", "'")
        .replace("ʻ", "'")
        .replace("`", "'")
        .strip()
    )


def search_db_places(db: Session, query: str, limit: int = 8) -> List[Place]:
    needle = _norm(query)
    places: Dict[str, Place] = {}

    published = (
        db.query(RouteDirection)
        .join(Route, Route.id == RouteDirection.route_id)
        .filter(Route.is_published.is_(True), Route.is_archived.is_(False))
        .all()
    )
    for direction in published:
        label = f"{direction.route.route_number}-yo'nalish"
        for name, lat, lng in (
            (direction.origin_name, direction.origin_lat, direction.origin_lng),
            (direction.destination_name, direction.destination_lat, direction.destination_lng),
        ):
            key = _norm(name)
            if needle in key and key not in places:
                places[key] = Place(f"terminal-{direction.id}-{key}", name, lat, lng, label, "terminal", "db")
        wps = (
            db.query(RouteWaypoint)
            .filter(RouteWaypoint.route_direction_id == direction.id, RouteWaypoint.is_stop.is_(True))
            .all()
        )
        for wp in wps:
            if not wp.name:
                continue
            key = _norm(wp.name)
            if needle in key and key not in places:
                places[key] = Place(f"stop-{wp.id}", wp.name, wp.lat, wp.lng, label, "stop", "db")

    for parking in db.query(Parking).filter(Parking.is_active.is_(True)).all():
        key = _norm(parking.name)
        if needle in key and key not in places:
            places[key] = Place(f"parking-{parking.id}", parking.name, parking.lat, parking.lng, "Stoyanka", "parking", "db")

    ranked = sorted(places.values(), key=lambda p: (not _norm(p.name).startswith(needle), len(p.name)))
    return ranked[:limit]


async def search_places(
    db: Session,
    query: str,
    limit: int = 8,
    near: Optional[Tuple[float, float]] = None,
) -> List[Place]:
    query = query.strip()
    if len(query) < 2:
        return []
    results = search_db_places(db, query, limit)
    if len(results) < limit:
        geocoded = await MapTilerAdapter().geocode(
            query,
            proximity=near or ANDIJON_CENTER,
            bbox=ANDIJON_BBOX,
            limit=limit - len(results),
        )
        seen = {_norm(p.name) for p in results}
        for idx, g in enumerate(geocoded):
            if _norm(g.name) in seen:
                continue
            results.append(
                Place(
                    id=f"geo-{idx}-{g.lat:.5f}-{g.lng:.5f}",
                    name=g.name,
                    lat=g.lat,
                    lng=g.lng,
                    address=g.address,
                    kind=g.place_type or "address",
                    source="maptiler",
                )
            )
    return results[:limit]
