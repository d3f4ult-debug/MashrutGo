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
from app.schemas.finance import (
    PaymentListResponse,
    PaymentResponse,
    RefundRequest,
    RefundResponse,
    CashoutCreateRequest,
    CashoutResponse,
)
from app.services.payment.transport_payment_service import transport_payment_service
from app.services.payment.cashout_service import cashout_service

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


# --- Driver Payments & Refunds (Stage 7) ---
@router.get("/payments", response_model=PaymentListResponse)
def get_driver_payments_endpoint(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=100),
    status: Optional[str] = Query(None, description="Filter by status (completed, refunded)"),
    current_user: User = Depends(require_driver),
    db: Session = Depends(get_db_dep),
):
    """
    Fetch transit fare payments received strictly by the authenticated driver's vehicle.
    Tenant/Driver isolation enforced: driver can only see their own vehicle payments.
    """
    driver_profile = current_user.driver_profile
    if not driver_profile:
        raise HTTPException(status_code=400, detail="Haydovchi profili topilmadi")

    items, total, total_amount = transport_payment_service.get_driver_payments(
        driver_id=driver_profile.id,
        page=page,
        size=size,
        status_filter=status,
        db=db,
    )
    pages = (total + size - 1) // size if size > 0 else 0

    return PaymentListResponse(
        items=[
            PaymentResponse(
                id=p.id,
                wallet_id=p.wallet_id,
                client_user_id=p.client_user_id,
                vehicle_id=p.vehicle_id,
                vehicle_internal_id=p.vehicle.internal_id if p.vehicle else None,
                driver_id=p.driver_id,
                route_id=p.route_id,
                route_number=p.route.route_number if p.route else None,
                amount_uzs=p.amount_uzs,
                payment_method=p.payment_method,
                status=p.status,
                qr_or_nfc_code=p.qr_or_nfc_code,
                external_trans_id=p.external_trans_id,
                idempotency_key=p.idempotency_key,
                created_at=p.created_at,
                refunds=[
                    RefundResponse(
                        id=r.id,
                        payment_id=r.payment_id,
                        driver_id=r.driver_id,
                        amount_uzs=r.amount_uzs,
                        reason=r.reason,
                        status=r.status,
                        created_at=r.created_at,
                    )
                    for r in (p.refunds or [])
                ],
            )
            for p in items
        ],
        total=total,
        total_amount_uzs=total_amount,
        page=page,
        size=size,
        pages=pages,
    )


@router.post("/payments/{id}/refund", response_model=RefundResponse)
def refund_driver_payment_endpoint(
    id: str,
    payload: RefundRequest = RefundRequest(),
    current_user: User = Depends(require_driver),
    db: Session = Depends(get_db_dep),
):
    """
    Driver initiates refund for a passenger payment:
    - Authorization check: driver can ONLY refund payments made to their own vehicle
    - Duplicate protection: prevents multiple refunds for the same payment
    - Allowed window enforcement: cannot refund payments older than configured grace window (15 mins)
    - Double-entry reverse ledger transfer (driver debited, client credited)
    - Full audit log recording
    """
    driver_profile = current_user.driver_profile
    if not driver_profile:
        raise HTTPException(status_code=400, detail="Haydovchi profili topilmadi")

    refund = transport_payment_service.refund_payment(
        payment_id=id,
        driver=driver_profile,
        reason=payload.reason,
        is_admin=False,
        db=db,
    )
    return RefundResponse(
        id=refund.id,
        payment_id=refund.payment_id,
        driver_id=refund.driver_id,
        amount_uzs=refund.amount_uzs,
        reason=refund.reason,
        status=refund.status,
        created_at=refund.created_at,
    )


# --- Driver Cashout Request Endpoints (Stage 7) ---
@router.post("/cashout/request", response_model=CashoutResponse, status_code=status.HTTP_201_CREATED)
def request_driver_cashout_endpoint(
    payload: CashoutCreateRequest,
    current_user: User = Depends(require_driver),
    db: Session = Depends(get_db_dep),
):
    """
    Driver submits cashout request of accumulated earnings:
    - Verifies sufficient driver wallet balance
    - Creates pending cashout request for Uyushma admin review
    """
    driver_profile = current_user.driver_profile
    if not driver_profile:
        raise HTTPException(status_code=400, detail="Haydovchi profili topilmadi")

    req = cashout_service.create_cashout_request(
        driver=driver_profile,
        amount_uzs=payload.amount_uzs,
        notes=payload.notes,
        db=db,
    )
    return CashoutResponse(
        id=req.id,
        driver_id=req.driver_id,
        driver_name=current_user.full_name,
        uyushma_id=req.uyushma_id,
        amount_uzs=req.amount_uzs,
        status=req.status,
        approved_by_user_id=req.approved_by_user_id,
        processed_at=req.processed_at,
        notes=req.notes,
        created_at=req.created_at,
        updated_at=req.updated_at,
    )


@router.get("/cashouts", response_model=List[CashoutResponse])
def get_my_cashout_requests_endpoint(
    current_user: User = Depends(require_driver),
    db: Session = Depends(get_db_dep),
):
    """List cashout requests submitted by authenticated driver."""
    driver_profile = current_user.driver_profile
    if not driver_profile:
        raise HTTPException(status_code=400, detail="Haydovchi profili topilmadi")

    items = cashout_service.list_driver_cashouts(driver_profile.id, db)
    return [
        CashoutResponse(
            id=req.id,
            driver_id=req.driver_id,
            driver_name=current_user.full_name,
            uyushma_id=req.uyushma_id,
            amount_uzs=req.amount_uzs,
            status=req.status,
            approved_by_user_id=req.approved_by_user_id,
            processed_at=req.processed_at,
            notes=req.notes,
            created_at=req.created_at,
            updated_at=req.updated_at,
        )
        for req in items
    ]

