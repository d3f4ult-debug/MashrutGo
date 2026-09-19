from typing import List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.transport import Route, RouteDirection, RouteWaypoint
from app.models.uyushma import Uyushma
from app.schemas.route import (
    RouteCreate,
    RouteDirectionCreate,
    RouteUpdate,
    WaypointCreate,
)
from app.services.routing.maptiler_adapter import MapTilerAdapter


def create_route(db: Session, payload: RouteCreate, uyushma_id: int) -> Route:
    """Create a new route under the specified Uyushma."""
    # Verify Uyushma exists
    uyushma = db.query(Uyushma).filter(Uyushma.id == uyushma_id).first()
    if not uyushma:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Uyushma with ID {uyushma_id} not found",
        )

    # Check route number uniqueness within this Uyushma
    existing = (
        db.query(Route)
        .filter(Route.uyushma_id == uyushma_id, Route.route_number == payload.route_number)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Route number '{payload.route_number}' already exists in this Uyushma",
        )

    route = Route(
        uyushma_id=uyushma_id,
        route_number=payload.route_number,
        name=payload.name,
        description=payload.description,
        is_published=False,
    )
    db.add(route)
    db.commit()
    db.refresh(route)
    return route


def get_route_or_404(db: Session, route_id: int) -> Route:
    """Fetch Route by ID or raise 404."""
    route = db.query(Route).filter(Route.id == route_id).first()
    if not route:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Route with ID {route_id} not found",
        )
    return route


def update_route(db: Session, route: Route, payload: RouteUpdate) -> Route:
    """Update route fields with uniqueness check if route_number changes."""
    if payload.route_number and payload.route_number != route.route_number:
        existing = (
            db.query(Route)
            .filter(Route.uyushma_id == route.uyushma_id, Route.route_number == payload.route_number)
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Route number '{payload.route_number}' already exists in this Uyushma",
            )
        route.route_number = payload.route_number

    if payload.name is not None:
        route.name = payload.name
    if payload.description is not None:
        route.description = payload.description
    if payload.is_published is not None:
        route.is_published = payload.is_published

    db.commit()
    db.refresh(route)
    return route


def upsert_route_direction(
    db: Session,
    route_id: int,
    payload: RouteDirectionCreate,
) -> RouteDirection:
    """Create or update outbound/inbound direction for a route."""
    direction = (
        db.query(RouteDirection)
        .filter(
            RouteDirection.route_id == route_id,
            RouteDirection.direction_type == payload.direction_type,
        )
        .first()
    )

    if direction:
        direction.origin_name = payload.origin_name
        direction.destination_name = payload.destination_name
        direction.origin_lat = payload.origin_lat
        direction.origin_lng = payload.origin_lng
        direction.destination_lat = payload.destination_lat
        direction.destination_lng = payload.destination_lng
        if payload.polyline:
            direction.polyline = payload.polyline
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
            polyline=payload.polyline,
            distance_meters=payload.distance_meters or 0,
            duration_seconds=payload.duration_seconds or 0,
        )
        db.add(direction)

    db.commit()
    db.refresh(direction)
    return direction


def set_direction_waypoints(
    db: Session,
    direction: RouteDirection,
    waypoints_data: List[WaypointCreate],
) -> List[RouteWaypoint]:
    """Replace all waypoints for a direction with a new ordered list."""
    # Delete existing
    db.query(RouteWaypoint).filter(RouteWaypoint.route_direction_id == direction.id).delete()

    created_waypoints = []
    # Ensure sequential ordering 1..N
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
        created_waypoints.append(waypoint)

    db.commit()
    for w in created_waypoints:
        db.refresh(w)
    return created_waypoints


def add_direction_waypoint(
    db: Session,
    direction: RouteDirection,
    payload: WaypointCreate,
) -> RouteWaypoint:
    """Add a single waypoint to the direction at specified or append position."""
    # Count existing
    existing_count = (
        db.query(RouteWaypoint)
        .filter(RouteWaypoint.route_direction_id == direction.id)
        .count()
    )
    target_order = payload.order if payload.order <= existing_count + 1 else existing_count + 1

    # Shift subsequent waypoints if inserted in between
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


def delete_direction_waypoint(
    db: Session,
    direction: RouteDirection,
    waypoint_id: int,
) -> None:
    """Delete waypoint by ID and reorder remaining waypoints sequentially."""
    wp = (
        db.query(RouteWaypoint)
        .filter(
            RouteWaypoint.id == waypoint_id,
            RouteWaypoint.route_direction_id == direction.id,
        )
        .first()
    )
    if not wp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Waypoint {waypoint_id} not found on this direction",
        )

    deleted_order = wp.order
    db.delete(wp)
    db.commit()

    # Reorder remaining
    db.query(RouteWaypoint).filter(
        RouteWaypoint.route_direction_id == direction.id,
        RouteWaypoint.order > deleted_order,
    ).update({"order": RouteWaypoint.order - 1})
    db.commit()


async def generate_and_save_direction_path(
    db: Session,
    direction: RouteDirection,
    adapter: Optional[MapTilerAdapter] = None,
) -> RouteDirection:
    """
    Read A, ordered waypoints, and B for the direction,
    call routing adapter, and persist resulting polyline/distance/duration.
    """
    adapter = adapter or MapTilerAdapter()

    coords = [(direction.origin_lat, direction.origin_lng)]
    for wp in direction.waypoints:
        coords.append((wp.lat, wp.lng))
    coords.append((direction.destination_lat, direction.destination_lng))

    result = await adapter.calculate_route(coords, profile="driving")

    direction.polyline = result.polyline
    direction.distance_meters = result.distance_meters
    direction.duration_seconds = result.duration_seconds
    db.commit()
    db.refresh(direction)
    return direction
