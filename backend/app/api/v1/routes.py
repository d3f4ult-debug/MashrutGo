from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import (
    get_db_dep,
    get_optional_current_user,
    require_uyushma_admin,
    verify_tenant_access,
)
from app.core.roles import UserRole
from app.models.transport import Route
from app.models.user import User
from app.schemas.route import (
    AutoPathRequest,
    AutoPathResponse,
    DirectionSaveRequest,
    RouteCreate,
    RouteDetailRead,
    RouteDirectionCreate,
    RouteDirectionRead,
    RoutePublishRequest,
    RouteRead,
    RouteUpdate,
    WaypointCreate,
    WaypointRead,
)
from app.services.audit_service import client_ip, record_audit_event
from app.services.fare_engine import quote_fare
from app.services.realtime.tracking_service import tracking_service
from app.services.route_service import (
    add_direction_waypoint,
    archive_route,
    create_route,
    delete_direction_waypoint,
    generate_and_save_direction_path,
    get_direction_or_404,
    get_route_or_404,
    provider_warning,
    save_direction,
    set_direction_waypoints,
    update_route,
    upsert_route_direction,
    validate_publishable,
)
from app.services.routing.base import InvalidCoordinateError, RoutingProviderError
from app.services.routing.providers import get_routing_provider

router = APIRouter(prefix="/routes", tags=["routes"])


def _is_operator(user: Optional[User]) -> bool:
    return bool(user and user.role in (UserRole.SUPER_ADMIN.value, UserRole.UYUSHMA_ADMIN.value))


def _load_managed_route(db: Session, route_id: int, user: User) -> Route:
    route = get_route_or_404(db, route_id)
    verify_tenant_access(user, route.uyushma_id)
    if route.is_archived:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Route is archived")
    return route


def _audit(db: Session, request: Request, user: User, action: str, route: Route, changes=None) -> None:
    record_audit_event(
        db,
        action=action,
        actor_user_id=user.id,
        actor_role=user.role,
        target_type="route",
        target_id=route.id,
        uyushma_id=route.uyushma_id,
        changes=changes,
        ip_address=client_ip(request),
    )
    db.commit()


@router.get("", response_model=List[RouteRead])
def list_routes(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    uyushma_id: Optional[int] = None,
    search: Optional[str] = Query(None, max_length=50),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db_dep),
):
    """
    List routes.
    - Public / clients / drivers: published routes only.
    - Uyushma admin: own routes (published and drafts). Super admin: all, optional `uyushma_id` filter.
    """
    query = db.query(Route).filter(Route.is_archived.is_(False))
    if not _is_operator(current_user):
        query = query.filter(Route.is_published.is_(True))
        if uyushma_id is not None:
            query = query.filter(Route.uyushma_id == uyushma_id)
    elif current_user.role == UserRole.UYUSHMA_ADMIN.value:
        # Tenant isolation: an Uyushma admin never lists another tenant's drafts
        query = query.filter(Route.uyushma_id == current_user.uyushma_id)
    elif uyushma_id is not None:
        query = query.filter(Route.uyushma_id == uyushma_id)

    if search:
        term = f"%{search.strip()}%"
        query = query.filter(Route.route_number.ilike(term) | Route.name.ilike(term))

    return query.order_by(Route.route_number).offset(skip).limit(limit).all()


@router.get("/{id}", response_model=RouteDetailRead)
def get_route(
    id: int,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db_dep),
):
    """Route with both directions, ordered stops, fare and live vehicle count."""
    route = get_route_or_404(db, id)
    if not route.is_published or route.is_archived:
        if not _is_operator(current_user):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route is not published")
        verify_tenant_access(current_user, route.uyushma_id)

    quote = quote_fare(db, route.uyushma_id, route.id)
    detail = RouteDetailRead.model_validate(
        {
            **RouteRead.model_validate(route).model_dump(),
            "uyushma_name": route.uyushma.name if route.uyushma else "",
            "fare_uzs": quote.amount_uzs if quote else None,
            "online_vehicles_count": tracking_service.online_count(route.id),
        }
    )
    return detail


@router.post("", response_model=RouteRead, status_code=status.HTTP_201_CREATED)
def create_route_endpoint(
    payload: RouteCreate,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Create route metadata (draft). Uyushma admins always create in their own tenant."""
    target_uyushma_id = payload.uyushma_id
    if current_user.role == UserRole.UYUSHMA_ADMIN.value:
        target_uyushma_id = current_user.uyushma_id
    elif not target_uyushma_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uyushma_id is required for Super Admin creation")

    verify_tenant_access(current_user, target_uyushma_id)
    route = create_route(db, payload, target_uyushma_id)
    _audit(db, request, current_user, "route.create", route, {"route_number": route.route_number, "name": route.name})
    return route


@router.put("/{id}", response_model=RouteRead)
def update_route_endpoint(
    id: int,
    payload: RouteUpdate,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    route = _load_managed_route(db, id, current_user)
    updated = update_route(db, route, payload)
    _audit(db, request, current_user, "route.update", route, payload.model_dump(exclude_unset=True))
    return updated


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_route_endpoint(
    id: int,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Soft delete: the route is archived (history, payments and audit stay intact)."""
    route = _load_managed_route(db, id, current_user)
    archive_route(db, route)
    _audit(db, request, current_user, "route.archive", route)


@router.post("/{id}/publish", response_model=RouteRead)
def publish_route_endpoint(
    id: int,
    payload: RoutePublishRequest,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Publish/unpublish. Publishing requires both directions with saved geometry."""
    route = _load_managed_route(db, id, current_user)
    if payload.is_published:
        validate_publishable(route)
    route.is_published = payload.is_published
    db.commit()
    db.refresh(route)
    _audit(db, request, current_user, "route.publish" if payload.is_published else "route.unpublish", route)
    return route


# ------------------------------------------------------------------------------
# Directions & waypoints (visual route editor)
# ------------------------------------------------------------------------------


@router.put("/{id}/directions/{direction_type}", response_model=RouteDirectionRead)
def save_direction_endpoint(
    id: int,
    direction_type: str,
    payload: DirectionSaveRequest,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Atomically save A, ordered waypoints, B and the previewed road geometry of one direction."""
    route = _load_managed_route(db, id, current_user)
    direction = save_direction(db, route, direction_type, payload)
    _audit(
        db,
        request,
        current_user,
        "direction.save",
        route,
        {"direction": direction_type, "waypoints": len(payload.waypoints), "distance_m": payload.distance_meters},
    )
    return direction


@router.post("/{id}/directions", response_model=RouteDirectionRead, status_code=status.HTTP_200_OK)
def upsert_direction_endpoint(
    id: int,
    payload: RouteDirectionCreate,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    route = _load_managed_route(db, id, current_user)
    direction = upsert_route_direction(db, id, payload)
    _audit(db, request, current_user, "direction.upsert", route, {"direction": direction.direction_type})
    return direction


@router.post("/{id}/directions/{direction_type}/waypoints", response_model=List[WaypointRead])
def set_waypoints_endpoint(
    id: int,
    direction_type: str,
    waypoints: List[WaypointCreate],
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    _load_managed_route(db, id, current_user)
    direction = get_direction_or_404(db, id, direction_type)
    return set_direction_waypoints(db, direction, waypoints)


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
    _load_managed_route(db, id, current_user)
    direction = get_direction_or_404(db, id, direction_type)
    return add_direction_waypoint(db, direction, waypoint)


@router.delete("/{id}/directions/{direction_type}/waypoints/{waypoint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_waypoint_endpoint(
    id: int,
    direction_type: str,
    waypoint_id: int,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    _load_managed_route(db, id, current_user)
    direction = get_direction_or_404(db, id, direction_type)
    delete_direction_waypoint(db, direction, waypoint_id)


# ------------------------------------------------------------------------------
# Road routing provider (auto path)
# ------------------------------------------------------------------------------


@router.post("/editor/auto-path", response_model=AutoPathResponse)
async def auto_path_preview(
    payload: AutoPathRequest,
    current_user: User = Depends(require_uyushma_admin),
):
    """Preview a road path A -> waypoints -> B through the routing provider (not saved)."""
    coords = [(payload.origin.lat, payload.origin.lng)]
    coords.extend((wp.lat, wp.lng) for wp in payload.waypoints)
    coords.append((payload.destination.lat, payload.destination.lng))
    try:
        res = await get_routing_provider().calculate_route(coords, profile=payload.profile)
    except InvalidCoordinateError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RoutingProviderError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Yo'l chizish xizmati xatosi: {exc}") from exc

    return AutoPathResponse(
        distance_meters=res.distance_meters,
        duration_seconds=res.duration_seconds,
        geojson=res.geojson,
        polyline=res.polyline,
        provider=res.provider,
        warning=provider_warning(res.provider),
    )


@router.post("/{id}/directions/{direction_type}/generate-path", response_model=RouteDirectionRead)
async def generate_and_save_path_endpoint(
    id: int,
    direction_type: str,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Route the saved A, waypoints and B through the provider and persist the geometry."""
    _load_managed_route(db, id, current_user)
    direction = get_direction_or_404(db, id, direction_type)
    return await generate_and_save_direction_path(db, direction)
