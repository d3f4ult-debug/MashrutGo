from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import (
    get_db_dep,
    get_optional_current_user,
    require_uyushma_admin,
    verify_tenant_access,
)
from app.core.roles import UserRole
from app.models.transport import Route, RouteDirection
from app.models.user import User
from app.schemas.route import (
    AutoPathRequest,
    AutoPathResponse,
    RouteCreate,
    RouteDirectionCreate,
    RouteDirectionRead,
    RoutePublishRequest,
    RouteRead,
    RouteUpdate,
    WaypointCreate,
    WaypointRead,
)
from app.services.audit_service import log_audit_event
from app.services.route_service import (
    add_direction_waypoint,
    create_route,
    delete_direction_waypoint,
    generate_and_save_direction_path,
    get_route_or_404,
    set_direction_waypoints,
    update_route,
    upsert_route_direction,
)
from app.services.routing.maptiler_adapter import MapTilerAdapter

router = APIRouter(prefix="/routes", tags=["routes"])
maptiler_adapter = MapTilerAdapter()


@router.get("", response_model=List[RouteRead])
def list_routes(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    uyushma_id: Optional[int] = None,
    search: Optional[str] = None,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db_dep),
):
    """
    List routes.
    - Public / Client: only published routes (`is_published=True`).
    - Uyushma Admin / Super Admin: can view both published and unpublished.
    """
    query = db.query(Route)

    # Permission filter
    is_admin = current_user and current_user.role in (
        UserRole.SUPER_ADMIN.value,
        UserRole.UYUSHMA_ADMIN.value,
    )

    if not is_admin:
        query = query.filter(Route.is_published.is_(True))
    elif current_user.role == UserRole.UYUSHMA_ADMIN.value and not uyushma_id:
        query = query.filter(Route.uyushma_id == current_user.uyushma_id)

    if uyushma_id is not None:
        query = query.filter(Route.uyushma_id == uyushma_id)

    if search:
        search_fmt = f"%{search}%"
        query = query.filter(
            (Route.route_number.ilike(search_fmt)) | (Route.name.ilike(search_fmt))
        )

    routes = query.offset(skip).limit(limit).all()
    return routes


@router.get("/{id}", response_model=RouteRead)
def get_route(
    id: int,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db_dep),
):
    """Retrieve complete route details including outbound/inbound directions and waypoints."""
    route = get_route_or_404(db, id)

    # If route is not published, only Uyushma/SuperAdmin can inspect
    if not route.is_published:
        if not current_user or current_user.role not in (
            UserRole.SUPER_ADMIN.value,
            UserRole.UYUSHMA_ADMIN.value,
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Route is not published",
            )
        verify_tenant_access(current_user, route.uyushma_id)

    return route


@router.post("", response_model=RouteRead, status_code=status.HTTP_201_CREATED)
def create_route_endpoint(
    payload: RouteCreate,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Create new route metadata. Tenant-isolated."""
    target_uyushma_id = payload.uyushma_id
    if current_user.role == UserRole.UYUSHMA_ADMIN.value:
        target_uyushma_id = current_user.uyushma_id
    elif not target_uyushma_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="uyushma_id is required for Super Admin creation",
        )

    verify_tenant_access(current_user, target_uyushma_id)
    route = create_route(db, payload, target_uyushma_id)

    log_audit_event(
        db=db,
        action="route.create",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="route",
        target_id=str(route.id),
        changes={"route_number": route.route_number, "name": route.name},
    )
    return route


@router.put("/{id}", response_model=RouteRead)
def update_route_endpoint(
    id: int,
    payload: RouteUpdate,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Update route metadata. Tenant-isolated."""
    route = get_route_or_404(db, id)
    verify_tenant_access(current_user, route.uyushma_id)

    updated = update_route(db, route, payload)
    log_audit_event(
        db=db,
        action="route.update",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="route",
        target_id=str(route.id),
    )
    return updated


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route_endpoint(
    id: int,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Delete a route and its directions/waypoints. Tenant-isolated."""
    route = get_route_or_404(db, id)
    verify_tenant_access(current_user, route.uyushma_id)

    db.delete(route)
    db.commit()

    log_audit_event(
        db=db,
        action="route.delete",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="route",
        target_id=str(id),
    )


@router.post("/{id}/publish", response_model=RouteRead)
def publish_route_endpoint(
    id: int,
    payload: RoutePublishRequest,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Publish or unpublish route for public discovery. Tenant-isolated."""
    route = get_route_or_404(db, id)
    verify_tenant_access(current_user, route.uyushma_id)

    route.is_published = payload.is_published
    db.commit()
    db.refresh(route)

    log_audit_event(
        db=db,
        action="route.publish" if payload.is_published else "route.unpublish",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="route",
        target_id=str(route.id),
    )
    return route


# ------------------------------------------------------------------------------
# Direction & Waypoint Endpoints (Route Editor)
# ------------------------------------------------------------------------------


@router.post("/{id}/directions", response_model=RouteDirectionRead, status_code=status.HTTP_200_OK)
def upsert_direction_endpoint(
    id: int,
    payload: RouteDirectionCreate,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Create or update outbound or inbound direction geometry and coordinates."""
    route = get_route_or_404(db, id)
    verify_tenant_access(current_user, route.uyushma_id)

    direction = upsert_route_direction(db, id, payload)
    log_audit_event(
        db=db,
        action="direction.upsert",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="direction",
        target_id=str(direction.id),
        changes={"direction_type": direction.direction_type},
    )
    return direction


@router.post(
    "/{id}/directions/{direction_type}/waypoints",
    response_model=List[WaypointRead],
)
def set_waypoints_endpoint(
    id: int,
    direction_type: str,
    waypoints: List[WaypointCreate],
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Save or reorder ordered waypoints for a specific route direction."""
    route = get_route_or_404(db, id)
    verify_tenant_access(current_user, route.uyushma_id)

    direction = (
        db.query(RouteDirection)
        .filter(RouteDirection.route_id == id, RouteDirection.direction_type == direction_type)
        .first()
    )
    if not direction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Direction '{direction_type}' not found on route {id}",
        )

    result = set_direction_waypoints(db, direction, waypoints)
    return result


@router.post(
    "/{id}/directions/{direction_type}/waypoints/add",
    response_model=WaypointRead,
    status_code=status.HTTP_201_CREATED,
)
def add_waypoint_endpoint(
    id: int,
    direction_type: str,
    waypoint: WaypointCreate,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Add a single waypoint to a route direction."""
    route = get_route_or_404(db, id)
    verify_tenant_access(current_user, route.uyushma_id)

    direction = (
        db.query(RouteDirection)
        .filter(RouteDirection.route_id == id, RouteDirection.direction_type == direction_type)
        .first()
    )
    if not direction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Direction '{direction_type}' not found on route {id}",
        )

    return add_direction_waypoint(db, direction, waypoint)


@router.delete(
    "/{id}/directions/{direction_type}/waypoints/{waypoint_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_waypoint_endpoint(
    id: int,
    direction_type: str,
    waypoint_id: int,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Remove a waypoint and reorder the remaining waypoints."""
    route = get_route_or_404(db, id)
    verify_tenant_access(current_user, route.uyushma_id)

    direction = (
        db.query(RouteDirection)
        .filter(RouteDirection.route_id == id, RouteDirection.direction_type == direction_type)
        .first()
    )
    if not direction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Direction '{direction_type}' not found on route {id}",
        )

    delete_direction_waypoint(db, direction, waypoint_id)


# ------------------------------------------------------------------------------
# MapTiler Routing Engine Endpoints
# ------------------------------------------------------------------------------


@router.post("/editor/auto-path", response_model=AutoPathResponse)
async def auto_path_preview(
    payload: AutoPathRequest,
    current_user: User = Depends(require_uyushma_admin),
):
    """
    Interactive Route Editor helper:
    Request auto path through A → waypoints → B using MapTiler routing adapter.
    Does not save to DB — used for realtime preview on map.
    """
    coords = [(payload.origin.lat, payload.origin.lng)]
    for wp in payload.waypoints:
        coords.append((wp.lat, wp.lng))
    coords.append((payload.destination.lat, payload.destination.lng))

    res = await maptiler_adapter.calculate_route(coords, profile=payload.profile)

    return AutoPathResponse(
        distance_meters=res.distance_meters,
        duration_seconds=res.duration_seconds,
        geojson=res.geojson,
        polyline=res.polyline,
        provider=res.provider,
    )


@router.post(
    "/{id}/directions/{direction_type}/generate-path",
    response_model=RouteDirectionRead,
)
async def generate_and_save_path_endpoint(
    id: int,
    direction_type: str,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """
    Generate auto path through saved A, waypoints, and B using MapTiler adapter,
    and persist the resulting geometry (GeoJSON LineString) and metrics into DB.
    """
    route = get_route_or_404(db, id)
    verify_tenant_access(current_user, route.uyushma_id)

    direction = (
        db.query(RouteDirection)
        .filter(RouteDirection.route_id == id, RouteDirection.direction_type == direction_type)
        .first()
    )
    if not direction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Direction '{direction_type}' not found on route {id}",
        )

    updated_dir = await generate_and_save_direction_path(db, direction, maptiler_adapter)
    return updated_dir
