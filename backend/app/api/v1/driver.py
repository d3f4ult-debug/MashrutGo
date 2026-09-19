from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep, get_optional_current_user, require_driver
from app.models.shift import DriverShift
from app.models.user import User
from app.schemas.driver import (
    GPSBatchSyncRequest,
    GPSBatchSyncResponse,
    GPSPointInput,
    LiveVehicleStateResponse,
    ShiftEndRequest,
    ShiftResponse,
    ShiftStartRequest,
)
from app.services.audit_service import log_audit_event
from app.services.realtime.connection_manager import realtime_manager
from app.services.realtime.tracking_service import tracking_service

router = APIRouter(prefix="/driver", tags=["driver"])


@router.post("/shift/start", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED)
async def start_shift(
    payload: ShiftStartRequest,
    current_user: User = Depends(require_driver),
    db: Session = Depends(get_db_dep),
):
    """
    Driver begins active shift:
    - Verifies assigned vehicle and route (1 driver -> 1 vehicle -> 1 route rule)
    - Starts GPS transmission window and registers vehicle into live tracking
    - Broadcasts route.vehicle.status update
    """
    driver_profile = current_user.driver_profile
    if not driver_profile:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Driver profile not found for user",
        )

    vehicle = driver_profile.vehicle
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No vehicle assigned to driver. Contact Uyushma dispatcher.",
        )

    route = vehicle.route
    if not route:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assigned vehicle is not linked to an active route. Contact Uyushma dispatcher.",
        )

    # Check if driver already has an active shift
    existing_shift = (
        db.query(DriverShift)
        .filter(DriverShift.driver_id == driver_profile.id, DriverShift.status == "active")
        .first()
    )
    if existing_shift:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Driver already has an active shift. End current shift before starting a new one.",
        )

    now = datetime.now(timezone.utc)
    shift = DriverShift(
        driver_id=driver_profile.id,
        vehicle_id=vehicle.id,
        route_id=route.id,
        direction=payload.direction,
        status="active",
        started_at=now,
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)

    # Register in live tracking
    tracking_service.register_shift_start(shift, vehicle, route)

    # Broadcast updated route vehicles count
    live_count = len(tracking_service.get_live_vehicles(route_id=route.id))
    await realtime_manager.broadcast_route_status({
        "route_id": route.id,
        "route_number": route.route_number,
        "online_vehicles_count": live_count,
        "status": "online",
        "has_live_vehicles": True,
    })

    log_audit_event(
        db=db,
        action="shift.start",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="shift",
        target_id=str(shift.id),
        changes={"vehicle_id": vehicle.internal_id, "route_number": route.route_number},
    )

    return shift


@router.post("/shift/end", response_model=ShiftResponse)
async def end_shift(
    payload: Optional[ShiftEndRequest] = None,
    current_user: User = Depends(require_driver),
    db: Session = Depends(get_db_dep),
):
    """
    Driver ends shift:
    - Closes active shift record
    - Removes vehicle from live map broadcast
    """
    driver_profile = current_user.driver_profile
    if not driver_profile:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Driver profile missing")

    shift = (
        db.query(DriverShift)
        .filter(DriverShift.driver_id == driver_profile.id, DriverShift.status == "active")
        .first()
    )
    if not shift:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active shift found to end",
        )

    now = datetime.now(timezone.utc)
    shift.status = "completed"
    shift.ended_at = now
    db.commit()
    db.refresh(shift)

    # Remove from live tracking
    tracking_service.register_shift_end(shift.vehicle_id)

    # Broadcast updated route vehicles count
    live_count = len(tracking_service.get_live_vehicles(route_id=shift.route_id))
    await realtime_manager.broadcast_route_status({
        "route_id": shift.route_id,
        "route_number": shift.route.route_number if shift.route else "",
        "online_vehicles_count": live_count,
        "status": "online" if live_count > 0 else "no_online_vehicle_visible",
        "has_live_vehicles": live_count > 0,
    })

    log_audit_event(
        db=db,
        action="shift.end",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="shift",
        target_id=str(shift.id),
    )

    return shift


@router.get("/shift/current", response_model=ShiftResponse)
def get_current_shift(
    current_user: User = Depends(require_driver),
    db: Session = Depends(get_db_dep),
):
    """Retrieve driver's current active shift."""
    driver_profile = current_user.driver_profile
    if not driver_profile:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Driver profile missing")

    shift = (
        db.query(DriverShift)
        .filter(DriverShift.driver_id == driver_profile.id, DriverShift.status == "active")
        .first()
    )
    if not shift:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active shift found",
        )
    return shift


@router.post("/gps/single", status_code=status.HTTP_200_OK)
async def ingest_single_gps(
    point: GPSPointInput,
    current_user: User = Depends(require_driver),
    db: Session = Depends(get_db_dep),
):
    """
    Ingest a single live GPS fix from driver:
    - Validates bounds and accuracy
    - Updates in-memory live tracking
    - Performs Stayanka geofence detection
    - Broadcasts vehicle.location.updated
    """
    driver_profile = current_user.driver_profile
    shift = (
        db.query(DriverShift)
        .filter(DriverShift.driver_id == driver_profile.id, DriverShift.status == "active")
        .first()
    )
    if not shift:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot ingest GPS without an active shift. Start shift first.",
        )

    snapshot = await tracking_service.ingest_single_gps(db, shift, point)
    if not snapshot:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid GPS coordinates out of geographic bounds",
        )

    return {"status": "ok", "snapshot_id": snapshot.id}


@router.post("/gps/batch", response_model=GPSBatchSyncResponse)
async def sync_gps_batch(
    payload: GPSBatchSyncRequest,
    current_user: User = Depends(require_driver),
    db: Session = Depends(get_db_dep),
):
    """
    Sync offline queued GPS fixes:
    - Protects against duplicate submissions via client-generated idempotency_key
    - Persists historical trace
    - Updates latest live position
    """
    driver_profile = current_user.driver_profile
    shift = (
        db.query(DriverShift)
        .filter(DriverShift.driver_id == driver_profile.id, DriverShift.status == "active")
        .first()
    )
    if not shift:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Active shift required to sync GPS batch",
        )

    res = await tracking_service.sync_gps_batch(db, shift, payload)
    return res


@router.get("/vehicles/live", response_model=List[LiveVehicleStateResponse])
def get_live_vehicles_endpoint(
    route_id: Optional[int] = Query(None, description="Filter by Route ID"),
    direction: Optional[str] = Query(None, pattern="^(outbound|inbound)$"),
):
    """
    Public query returning active live vehicles on routes:
    - Displays current position, speed, heading, captured_at, and parking status
    - Excludes stale/offline vehicles
    """
    return tracking_service.get_live_vehicles(route_id=route_id, direction=direction, include_stale=False)
