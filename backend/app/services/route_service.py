import json
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.shift import DriverShift
from app.models.transport import Route, RouteDirection, RouteWaypoint, Vehicle
from app.models.uyushma import Uyushma
from app.schemas.route import (
    DirectionSaveRequest,
    DirectionSummary,
    RouteCreate,
    RouteDirectionCreate,
    RouteUpdate,
    UyushmaRouteSummary,
    WaypointCreate,
)
from app.services.fare_engine import quote_fare
from app.services.realtime.tracking_service import tracking_service
from app.services.routing.base import BaseRoutingProvider, RoutingProviderError
from app.services.routing.maptiler_adapter import haversine_distance
from app.services.routing.providers import GeodesicFallbackProvider, get_routing_provider

GEODESIC_WARNING = (
    "Yo'l ko'chalar bo'yicha emas, to'g'ri chiziqlar bilan taxminiy chizildi "
    "(ROUTING_PROVIDER=geodesic). Aniq geometriya uchun OSRM serverini sozlang."
)


def create_route(db: Session, payload: RouteCreate, uyushma_id: int) -> Route:
    uyushma = db.query(Uyushma).filter(Uyushma.id == uyushma_id).first()
    if not uyushma:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Uyushma with ID {uyushma_id} not found")
    if uyushma.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Uyushma is archived")

    existing = (
        db.query(Route)
        .filter(Route.uyushma_id == uyushma_id, Route.route_number == payload.route_number)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{payload.route_number}' raqamli yo'nalish bu Uyushmada allaqachon mavjud",
        )

    route = Route(
        uyushma_id=uyushma_id,
        route_number=payload.route_number.strip(),
        name=payload.name.strip(),
        description=payload.description,
        is_published=False,
    )
    db.add(route)
    db.commit()
    db.refresh(route)
    return route


def get_route_or_404(db: Session, route_id: int) -> Route:
    route = db.query(Route).filter(Route.id == route_id).first()
    if not route:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Route with ID {route_id} not found")
    return route


def get_direction_or_404(db: Session, route_id: int, direction_type: str) -> RouteDirection:
    if direction_type not in ("outbound", "inbound"):
        raise HTTPException(status_code=422, detail="direction must be outbound or inbound")
    direction = (
        db.query(RouteDirection)
        .filter(RouteDirection.route_id == route_id, RouteDirection.direction_type == direction_type)
        .first()
    )
    if not direction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Direction '{direction_type}' not found on route {route_id}",
        )
    return direction


def validate_publishable(route: Route) -> None:
    """A route is only visible to clients once both directions have real geometry."""
    types = {d.direction_type: d for d in route.directions}
    missing = [t for t in ("outbound", "inbound") if t not in types]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Yo'nalishni chop etish uchun ikkala yo'nalish kerak (yo'q: {', '.join(missing)})",
        )
    for d in types.values():
        if not d.polyline:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"'{d.direction_type}' yo'nalishining geometriyasi saqlanmagan",
            )


def update_route(db: Session, route: Route, payload: RouteUpdate) -> Route:
    if payload.route_number and payload.route_number != route.route_number:
        existing = (
            db.query(Route)
            .filter(Route.uyushma_id == route.uyushma_id, Route.route_number == payload.route_number)
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"'{payload.route_number}' raqamli yo'nalish bu Uyushmada allaqachon mavjud",
            )
        route.route_number = payload.route_number.strip()

    if payload.name is not None:
        route.name = payload.name.strip()
    if payload.description is not None:
        route.description = payload.description
    if payload.is_published is not None:
        if payload.is_published:
            validate_publishable(route)
        route.is_published = payload.is_published

    db.commit()
    db.refresh(route)
    return route


def archive_route(db: Session, route: Route) -> Route:
    active = db.query(DriverShift.id).filter(DriverShift.route_id == route.id, DriverShift.status == "active").first()
    if active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Yo'nalishda faol smenalar bor: avval ularni yakunlang")
    route.is_archived = True
    route.is_published = False
    # Vehicles keep their history but are detached so they can be reassigned
    db.query(Vehicle).filter(Vehicle.route_id == route.id).update({"route_id": None})
    db.commit()
    db.refresh(route)
    return route


def _parse_polyline(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        geo = json.loads(value)
    except ValueError:
        raise HTTPException(status_code=422, detail="polyline must be a GeoJSON LineString")
    return _validate_geojson(geo)


def upsert_route_direction(db: Session, route_id: int, payload: RouteDirectionCreate) -> RouteDirection:
    polyline = _parse_polyline(payload.polyline)
    direction = (
        db.query(RouteDirection)
        .filter(RouteDirection.route_id == route_id, RouteDirection.direction_type == payload.direction_type)
        .first()
    )
    if direction:
        direction.origin_name = payload.origin_name
        direction.destination_name = payload.destination_name
        direction.origin_lat = payload.origin_lat
        direction.origin_lng = payload.origin_lng
        direction.destination_lat = payload.destination_lat
        direction.destination_lng = payload.destination_lng
        if polyline:
            direction.polyline = polyline
        if payload.distance_meters:
            direction.distance_meters = payload.distance_meters
        if payload.duration_seconds:
            direction.duration_seconds = payload.duration_seconds
    else:
        direction = RouteDirection(
            route_id=route_id,
            direction_type=payload.direction_type,
            origin_name=payload.origin_name,
            destination_name=payload.destination_name,
            origin_lat=payload.origin_lat,
            origin_lng=payload.origin_lng,
            destination_lat=payload.destination_lat,
            destination_lng=payload.destination_lng,
            polyline=polyline,
            distance_meters=payload.distance_meters or 0,
            duration_seconds=payload.duration_seconds or 0,
        )
        db.add(direction)

    db.commit()
    db.refresh(direction)
    return direction


def _validate_geojson(geojson: dict) -> str:
    coords = geojson.get("coordinates") if isinstance(geojson, dict) else None
    if geojson.get("type") != "LineString" or not isinstance(coords, list) or len(coords) < 2:
        raise HTTPException(status_code=422, detail="geojson must be a LineString with >= 2 points")
    if len(coords) > 20000:
        raise HTTPException(status_code=422, detail="geometry is too large")
    for pt in coords:
        if (
            not isinstance(pt, (list, tuple))
            or len(pt) < 2
            or not all(isinstance(c, (int, float)) for c in pt[:2])
            or not (-180 <= pt[0] <= 180 and -90 <= pt[1] <= 90)
        ):
            raise HTTPException(status_code=422, detail="geometry contains invalid coordinates")
    return json.dumps({"type": "LineString", "coordinates": [[float(p[0]), float(p[1])] for p in coords]})


# Road routers snap A/B to the nearest road; anything farther than this is not this direction's geometry
MAX_ENDPOINT_OFFSET_METERS = 1500


def _line_length_meters(coords: List[List[float]]) -> float:
    return sum(haversine_distance(a[1], a[0], b[1], b[0]) for a, b in zip(coords, coords[1:]))


def _checked_geometry(payload: DirectionSaveRequest) -> tuple:
    """
    Validate the previewed geometry against A and B and derive trustworthy distance/duration.
    Returns (polyline_json | None, distance_m, duration_s).
    """
    if not payload.geojson:
        return None, 0, 0
    polyline = _validate_geojson(payload.geojson)
    coords = json.loads(polyline)["coordinates"]
    start_gap = haversine_distance(payload.origin_lat, payload.origin_lng, coords[0][1], coords[0][0])
    end_gap = haversine_distance(payload.destination_lat, payload.destination_lng, coords[-1][1], coords[-1][0])
    if start_gap > MAX_ENDPOINT_OFFSET_METERS or end_gap > MAX_ENDPOINT_OFFSET_METERS:
        raise HTTPException(
            status_code=422,
            detail="Geometriya A va B nuqtalariga mos kelmaydi: yo'lni qayta hisoblang",
        )
    length = int(round(_line_length_meters(coords)))
    distance = payload.distance_meters
    # Provider distances follow the drawn line; a wildly different number is not trusted
    if distance <= 0 or not (0.5 * length <= distance <= 1.5 * length + 50):
        distance = length
    duration = payload.duration_seconds
    if duration <= 0:
        duration = int(distance / (20 / 3.6))  # conservative 20 km/h city average
    return polyline, distance, duration


def save_direction(db: Session, route: Route, direction_type: str, payload: DirectionSaveRequest) -> RouteDirection:
    """Atomically replace one direction's endpoints, waypoints and geometry (visual editor save)."""
    if direction_type not in ("outbound", "inbound"):
        raise HTTPException(status_code=422, detail="direction must be outbound or inbound")
    polyline, distance_meters, duration_seconds = _checked_geometry(payload)
    direction = (
        db.query(RouteDirection)
        .filter(RouteDirection.route_id == route.id, RouteDirection.direction_type == direction_type)
        .first()
    )
    if direction is None:
        direction = RouteDirection(route_id=route.id, direction_type=direction_type)
        db.add(direction)
    direction.origin_name = payload.origin_name.strip()
    direction.destination_name = payload.destination_name.strip()
    direction.origin_lat, direction.origin_lng = payload.origin_lat, payload.origin_lng
    direction.destination_lat, direction.destination_lng = payload.destination_lat, payload.destination_lng
    direction.polyline = polyline
    direction.distance_meters = distance_meters
    direction.duration_seconds = duration_seconds
    db.flush()

    db.query(RouteWaypoint).filter(RouteWaypoint.route_direction_id == direction.id).delete()
    for idx, wp in enumerate(payload.waypoints, start=1):
        db.add(
            RouteWaypoint(
                route_direction_id=direction.id,
                order=idx,
                name=(wp.name or "").strip() or None,
                lat=wp.lat,
                lng=wp.lng,
                is_stop=wp.is_stop,
            )
        )
    if route.is_published and not direction.polyline:
        route.is_published = False
    db.commit()
    db.refresh(direction)
    return direction


def set_direction_waypoints(db: Session, direction: RouteDirection, waypoints_data: List[WaypointCreate]) -> List[RouteWaypoint]:
    db.query(RouteWaypoint).filter(RouteWaypoint.route_direction_id == direction.id).delete()
    created = []
    for idx, wp in enumerate(waypoints_data, start=1):
        waypoint = RouteWaypoint(
            route_direction_id=direction.id,
            order=idx,
            name=wp.name,
            lat=wp.lat,
            lng=wp.lng,
            is_stop=wp.is_stop,
        )
        db.add(waypoint)
        created.append(waypoint)
    db.commit()
    for w in created:
        db.refresh(w)
    return created


def add_direction_waypoint(db: Session, direction: RouteDirection, payload: WaypointCreate) -> RouteWaypoint:
    existing_count = db.query(RouteWaypoint).filter(RouteWaypoint.route_direction_id == direction.id).count()
    target_order = payload.order if payload.order <= existing_count + 1 else existing_count + 1
    db.query(RouteWaypoint).filter(
        RouteWaypoint.route_direction_id == direction.id,
        RouteWaypoint.order >= target_order,
    ).update({"order": RouteWaypoint.order + 1})
    waypoint = RouteWaypoint(
        route_direction_id=direction.id,
        order=target_order,
        name=payload.name,
        lat=payload.lat,
        lng=payload.lng,
        is_stop=payload.is_stop,
    )
    db.add(waypoint)
    db.commit()
    db.refresh(waypoint)
    return waypoint


def delete_direction_waypoint(db: Session, direction: RouteDirection, waypoint_id: int) -> None:
    wp = (
        db.query(RouteWaypoint)
        .filter(RouteWaypoint.id == waypoint_id, RouteWaypoint.route_direction_id == direction.id)
        .first()
    )
    if not wp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Waypoint {waypoint_id} not found on this direction")
    deleted_order = wp.order
    db.delete(wp)
    db.flush()
    db.query(RouteWaypoint).filter(
        RouteWaypoint.route_direction_id == direction.id,
        RouteWaypoint.order > deleted_order,
    ).update({"order": RouteWaypoint.order - 1})
    db.commit()


def provider_warning(provider_name: str) -> Optional[str]:
    return GEODESIC_WARNING if provider_name == GeodesicFallbackProvider.name else None


async def generate_and_save_direction_path(
    db: Session,
    direction: RouteDirection,
    provider: Optional[BaseRoutingProvider] = None,
) -> RouteDirection:
    """Route A -> ordered waypoints -> B through the routing provider and persist the geometry."""
    provider = provider or get_routing_provider()
    coords = [(direction.origin_lat, direction.origin_lng)]
    coords.extend((wp.lat, wp.lng) for wp in direction.waypoints)
    coords.append((direction.destination_lat, direction.destination_lng))
    try:
        result = await provider.calculate_route(coords, profile="driving")
    except RoutingProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Yo'l chizish xizmati xatosi: {exc}") from exc
    direction.polyline = result.polyline
    direction.distance_meters = result.distance_meters
    direction.duration_seconds = result.duration_seconds
    db.commit()
    db.refresh(direction)
    return direction


def summarize_route(db: Session, route: Route) -> UyushmaRouteSummary:
    vehicles = db.query(Vehicle).filter(Vehicle.route_id == route.id).all()
    quote = quote_fare(db, route.uyushma_id, route.id)
    return UyushmaRouteSummary(
        id=route.id,
        uyushma_id=route.uyushma_id,
        route_number=route.route_number,
        name=route.name,
        description=route.description,
        is_published=route.is_published,
        vehicles_count=len(vehicles),
        drivers_count=sum(1 for v in vehicles if v.driver_id is not None),
        online_vehicles_count=tracking_service.online_count(route.id),
        fare_uzs=quote.amount_uzs if quote else None,
        directions=[
            DirectionSummary(
                id=d.id,
                direction_type=d.direction_type,
                origin_name=d.origin_name,
                destination_name=d.destination_name,
                stops_count=len(d.waypoints) + 2,
                distance_meters=d.distance_meters,
                duration_seconds=d.duration_seconds,
                has_geometry=bool(d.polyline),
            )
            for d in route.directions
        ],
        created_at=route.created_at,
        updated_at=route.updated_at,
    )
