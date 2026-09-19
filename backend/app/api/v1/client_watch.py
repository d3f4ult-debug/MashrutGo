import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.deps import get_optional_current_user, require_driver
from app.models.shift import ClientRideState, ClientRouteWatch
from app.models.user import User
from app.schemas.client_watch import (
    RideStateResponse,
    RideStateUpdateRequest,
    WaitingPassengersListResponse,
    WaitingPassengerResponse,
    WatchHeartbeatRequest,
    WatchResponse,
    WatchStartRequest,
)
from app.services.realtime.client_watch_service import client_watch_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/client", tags=["client-watch"])
driver_router = APIRouter(prefix="/driver", tags=["driver"])


@router.post("/watch/start", response_model=WatchResponse, status_code=status.HTTP_201_CREATED)
async def start_route_watch(
    req: WatchStartRequest,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    """
    Client starts watching a route direction with exact GPS location.
    Anonymous or authenticated. Broadcasts passenger coordinate to route drivers.
    """
    try:
        user_id = current_user.id if current_user else None
        watch = await client_watch_service.start_watch(
            route_id=req.route_id,
            direction=req.direction,
            lat=req.lat,
            lng=req.lng,
            accuracy_meters=req.accuracy_meters or 5.0,
            session_id=req.session_id,
            user_id=user_id,
            db=db,
        )
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
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(f"Error starting route watch: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to start watch session")


@router.post("/watch/heartbeat", response_model=WatchResponse)
async def route_watch_heartbeat(
    req: WatchHeartbeatRequest,
    db: Session = Depends(get_db),
):
    """
    Client sends heartbeat (every 30s) to keep watch alive and update GPS.
    """
    watch = await client_watch_service.heartbeat(
        watch_id=req.watch_id,
        lat=req.lat,
        lng=req.lng,
        db=db,
    )
    if not watch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Watch session not found or already inactive",
        )
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


@router.post("/watch/stop", status_code=status.HTTP_200_OK)
async def stop_route_watch(
    watch_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """
    Client manually cancels watch before boarding. Revokes driver broadcast.
    """
    result = await client_watch_service.update_ride_state(
        watch_id=watch_id,
        state="stopped",
        vehicle_id=None,
        db=db,
    )
    return {"detail": "Watch session stopped", "watch_id": watch_id}


@router.post("/ride/state", response_model=RideStateResponse)
async def update_ride_state(
    req: RideStateUpdateRequest,
    db: Session = Depends(get_db),
):
    """
    Update passenger ride state:
    - 'on_car' (Mashinadaman): IMMEDIATELY STOPS BROADCAST to drivers for privacy.
    - 'exited' (Tushdim): Completes the ride state.
    Concrete vehicle selection is NOT required.
    """
    try:
        res = await client_watch_service.update_ride_state(
            watch_id=req.watch_id,
            state=req.state,
            vehicle_id=req.vehicle_id,
            db=db,
        )

        watch = db.query(ClientRouteWatch).filter(ClientRouteWatch.id == req.watch_id).first()
        ride_state = (
            db.query(ClientRideState)
            .filter(ClientRideState.client_session_id == watch.client_session_id)
            .order_by(ClientRideState.id.desc())
            .first()
        )

        return RideStateResponse(
            id=ride_state.id,
            client_session_id=ride_state.client_session_id,
            route_id=ride_state.route_id,
            vehicle_id=ride_state.vehicle_id,
            state=ride_state.state,
            boarded_at=ride_state.boarded_at,
            exited_at=ride_state.exited_at,
            created_at=ride_state.created_at,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get("/ride/current")
async def get_current_ride(
    session_id: Optional[str] = Query(None),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    """
    Check current active watch session and ride state for client.
    """
    query = db.query(ClientRouteWatch)
    if current_user:
        query = query.filter(ClientRouteWatch.user_id == current_user.id)
    elif session_id:
        query = query.filter(ClientRouteWatch.client_session_id == session_id)
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Must provide session_id or auth token")

    watch = query.order_by(ClientRouteWatch.id.desc()).first()
    if not watch:
        return {"active": False, "watch": None, "ride_state": None}

    ride_state = (
        db.query(ClientRideState)
        .filter(ClientRideState.client_session_id == watch.client_session_id)
        .order_by(ClientRideState.id.desc())
        .first()
    )

    return {
        "active": watch.status in ("active", "on_car"),
        "watch": WatchResponse.model_validate(watch) if watch else None,
        "ride_state": RideStateResponse.model_validate(ride_state) if ride_state else None,
    }


# Driver endpoint to view waiting passengers
@driver_router.get("/passengers/waiting", response_model=WaitingPassengersListResponse)
async def list_waiting_passengers_for_driver(
    route_id: int = Query(..., description="Route ID to inspect"),
    direction: Optional[str] = Query(None, description="outbound or inbound"),
    driver: User = Depends(require_driver),
    db: Session = Depends(get_db),
):
    """
    Active driver queries waiting passengers on their route.
    """
    passengers_raw = client_watch_service.get_waiting_passengers(
        route_id=route_id,
        direction=direction,
        db=db,
    )
    passengers = [WaitingPassengerResponse(**p) for p in passengers_raw]
    return WaitingPassengersListResponse(
        route_id=route_id,
        direction=direction,
        total_waiting=len(passengers),
        passengers=passengers,
    )
