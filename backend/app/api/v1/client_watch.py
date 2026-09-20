"""Client route watch ("Kutayapman") and ride state. Anonymous-friendly, session-secret protected."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep, get_optional_current_user
from app.models.shift import ClientRideState, ClientRouteWatch
from app.models.user import User
from app.schemas.client_watch import (
    CurrentRideResponse,
    RideStateResponse,
    RideStateUpdateRequest,
    WatchHeartbeatRequest,
    WatchResponse,
    WatchStartRequest,
    WatchStopRequest,
)
from app.services.realtime.client_watch_service import WatchError, client_watch_service

router = APIRouter(prefix="/client", tags=["client-watch"])


def _watch_response(watch: ClientRouteWatch) -> WatchResponse:
    return WatchResponse(
        id=watch.id,
        watch_id=watch.id,
        client_session_id=watch.client_session_id,
        route_id=watch.route_id,
        direction=watch.direction,
        lat=watch.lat,
        lng=watch.lng,
        status=watch.status,
        started_at=watch.started_at,
        expires_at=watch.expires_at,
    )


def _error(exc: WatchError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


@router.post("/watch/start", response_model=WatchResponse, status_code=status.HTTP_201_CREATED)
async def start_route_watch(
    req: WatchStartRequest,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db_dep),
):
    """
    Start "Kutayapman": the exact GPS point is shared with drivers currently serving this route.
    Returns `client_session_id` — a secret the client must send with every later watch call.
    """
    try:
        watch = await client_watch_service.start_watch(
            route_id=req.route_id,
            direction=req.direction,
            lat=req.lat,
            lng=req.lng,
            accuracy_meters=req.accuracy_meters,
            session_id=req.session_id,
            user_id=current_user.id if current_user else None,
            db=db,
        )
    except WatchError as exc:
        raise _error(exc) from exc
    return _watch_response(watch)


@router.post("/watch/heartbeat", response_model=WatchResponse)
async def route_watch_heartbeat(req: WatchHeartbeatRequest, db: Session = Depends(get_db_dep)):
    """Keep the watch alive (send at least every 30 s) and optionally update the waiting position."""
    try:
        watch = await client_watch_service.heartbeat(req.watch_id, req.session_id, req.lat, req.lng, db)
    except WatchError as exc:
        raise _error(exc) from exc
    return _watch_response(watch)


@router.post("/watch/stop")
async def stop_route_watch(req: WatchStopRequest, db: Session = Depends(get_db_dep)):
    """Cancel waiting before boarding; drivers stop seeing the point immediately."""
    try:
        result = await client_watch_service.update_ride_state(req.watch_id, req.session_id, "stopped", db)
    except WatchError as exc:
        raise _error(exc) from exc
    return {"detail": "Watch session stopped", **result}


@router.post("/ride/state", response_model=RideStateResponse)
async def update_ride_state(req: RideStateUpdateRequest, db: Session = Depends(get_db_dep)):
    """
    - `on_car` (Mashinadaman): broadcast to drivers stops IMMEDIATELY.
    - `exited` (Tushdim): ride finished.
    No concrete vehicle selection is required.
    """
    try:
        await client_watch_service.update_ride_state(req.watch_id, req.session_id, req.state, db, vehicle_id=req.vehicle_id)
    except WatchError as exc:
        raise _error(exc) from exc
    watch = client_watch_service.get_owned_watch(db, req.watch_id, req.session_id)
    ride = (
        db.query(ClientRideState)
        .filter(ClientRideState.client_session_id == watch.client_session_id)
        .order_by(ClientRideState.id.desc())
        .first()
    )
    return RideStateResponse.model_validate(ride)


@router.get("/ride/current", response_model=CurrentRideResponse)
def get_current_ride(
    session_id: Optional[str] = Query(None, min_length=16, max_length=64),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db_dep),
):
    """Restore watch/ride state after a reload (by session secret, or by account when signed in)."""
    query = db.query(ClientRouteWatch)
    if session_id:
        query = query.filter(ClientRouteWatch.client_session_id == session_id)
    elif current_user:
        query = query.filter(ClientRouteWatch.user_id == current_user.id)
    else:
        raise HTTPException(status_code=400, detail="session_id or auth token required")

    watch = query.order_by(ClientRouteWatch.id.desc()).first()
    if not watch:
        return CurrentRideResponse(active=False)
    ride = (
        db.query(ClientRideState)
        .filter(ClientRideState.client_session_id == watch.client_session_id)
        .order_by(ClientRideState.id.desc())
        .first()
    )
    return CurrentRideResponse(
        active=watch.status in ("active", "on_car"),
        watch=_watch_response(watch),
        ride_state=RideStateResponse.model_validate(ride) if ride else None,
    )
