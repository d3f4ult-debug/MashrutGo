from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep, get_driver_profile
from app.core.config import settings
from app.models.finance import CashoutRequest, FareRule, Payment, WalletTransaction
from app.models.shift import DriverShift
from app.models.transport import Parking
from app.models.user import DriverProfile
from app.schemas.client_watch import WaitingPassengerResponse, WaitingPassengersListResponse
from app.schemas.driver import (
    DriverMeResponse,
    DriverParkingStatus,
    DriverUyushmaBrief,
    DriverVehicleBrief,
    GPSBatchSyncRequest,
    GPSBatchSyncResponse,
    GPSIngestResponse,
    GPSPointInput,
    LiveVehicleStateResponse,
    ShiftDirectionRequest,
    ShiftEndRequest,
    ShiftResponse,
    ShiftStartRequest,
)
from app.schemas.finance import (
    CashoutCreateRequest,
    CashoutRead,
    DriverBalanceRead,
    DriverPaymentRead,
    LedgerEntryRead,
    RefundRequest,
)
from app.schemas.route import RouteRead
from app.services import events, ledger_service, payment_service
from app.services.audit_service import client_ip, record_audit_event
from app.services.fare_engine import quote_fare
from app.services.realtime.client_watch_service import client_watch_service
from app.services.realtime.connection_manager import realtime_manager
from app.services.realtime.tracking_service import tracking_service
from app.services.settings_service import get_setting

router = APIRouter(prefix="/driver", tags=["driver"])


def _active_shift(db: Session, driver: DriverProfile) -> Optional[DriverShift]:
    return db.query(DriverShift).filter(DriverShift.driver_id == driver.id, DriverShift.status == "active").first()


def _require_active_shift(db: Session, driver: DriverProfile) -> DriverShift:
    shift = _active_shift(db, driver)
    if not shift:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Faol smena yo'q. Avval smenani boshlang.")
    return shift


# A driver who finishes a shift while offline still holds the last stretch of the route in the
# device queue. Accepting it as history (never as live position) keeps the trip record complete.
HISTORY_UPLOAD_WINDOW = timedelta(hours=12)


def _shift_for_history(db: Session, driver: DriverProfile, shift_id: Optional[int] = None) -> DriverShift:
    if shift_id is not None:
        shift = db.query(DriverShift).filter(DriverShift.id == shift_id, DriverShift.driver_id == driver.id).first()
        if not shift:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Smena topilmadi")
        if shift.status != "active" and (not shift.ended_at or datetime.now(timezone.utc) - shift.ended_at > HISTORY_UPLOAD_WINDOW):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Smena yopilgan, tarix qabul qilinmaydi")
        return shift
    active = _active_shift(db, driver)
    if active:
        return active
    recent = (
        db.query(DriverShift)
        .filter(DriverShift.driver_id == driver.id, DriverShift.ended_at.isnot(None))
        .order_by(DriverShift.ended_at.desc())
        .first()
    )
    if recent and recent.ended_at and datetime.now(timezone.utc) - recent.ended_at <= HISTORY_UPLOAD_WINDOW:
        return recent
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Faol smena yo'q. Avval smenani boshlang.")


# ------------------------------------------------------------------------------
# Profile
# ------------------------------------------------------------------------------


@router.get("/me", response_model=DriverMeResponse)
def driver_me(driver: DriverProfile = Depends(get_driver_profile), db: Session = Depends(get_db_dep)):
    """Everything the driver app needs: vehicle, route geometry, fare, current shift, GPS cadence."""
    vehicle = driver.vehicle
    route = vehicle.route if vehicle and vehicle.route and not vehicle.route.is_archived else None
    quote = quote_fare(db, driver.uyushma_id, route.id) if route else None
    shift = _active_shift(db, driver)
    return DriverMeResponse(
        driver_id=driver.id,
        user_id=driver.user_id,
        full_name=driver.user.full_name,
        phone=driver.user.phone,
        license_number=driver.license_number,
        uyushma=DriverUyushmaBrief(id=driver.uyushma.id, name=driver.uyushma.name, phone=driver.uyushma.phone),
        vehicle=DriverVehicleBrief(
            id=vehicle.id, internal_id=vehicle.internal_id, plate_number=vehicle.plate_number,
            model=vehicle.model, color=vehicle.color, vehicle_type=vehicle.vehicle_type,
        ) if vehicle else None,
        route=RouteRead.model_validate(route) if route else None,
        fare_uzs=quote.amount_uzs if quote else None,
        active_shift=ShiftResponse.model_validate(shift) if shift else None,
        gps_interval_seconds=int(get_setting(db, "gps_interval_seconds")),
        stale_threshold_seconds=settings.gps_stale_threshold_seconds,
    )


@router.get("/parkings", response_model=List[DriverParkingStatus])
def driver_parkings(driver: DriverProfile = Depends(get_driver_profile), db: Session = Depends(get_db_dep)):
    """Stoyankas with live counts and whether this driver's vehicle is inside (automatic geofence)."""
    state = tracking_service.get_state(driver.vehicle.id) if driver.vehicle else None
    inside_id = state.parking_id if state and state.has_fix and not state.is_stale else None
    parkings = (
        db.query(Parking)
        .filter(Parking.is_active.is_(True), (Parking.uyushma_id == driver.uyushma_id) | (Parking.uyushma_id.is_(None)))
        .all()
    )
    return [
        DriverParkingStatus(
            parking_id=p.id, name=p.name, lat=p.lat, lng=p.lng, radius_meters=p.radius_meters,
            vehicle_count=tracking_service.get_parking_vehicle_count(p.id), is_driver_inside=p.id == inside_id,
        )
        for p in parkings
    ]


# ------------------------------------------------------------------------------
# Shift lifecycle
# ------------------------------------------------------------------------------


@router.post("/shift/start", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED)
async def start_shift(
    payload: ShiftStartRequest,
    request: Request,
    driver: DriverProfile = Depends(get_driver_profile),
    db: Session = Depends(get_db_dep),
):
    """Start shift on the assigned vehicle/route (1 driver -> 1 vehicle -> 1 route)."""
    vehicle = driver.vehicle
    if not vehicle or not vehicle.is_active:
        raise HTTPException(status_code=409, detail="Sizga faol transport biriktirilmagan. Uyushma dispetcheriga murojaat qiling.")
    route = vehicle.route
    if not route or route.is_archived:
        raise HTTPException(status_code=409, detail="Transport yo'nalishga biriktirilmagan. Uyushma dispetcheriga murojaat qiling.")
    if _active_shift(db, driver):
        raise HTTPException(status_code=409, detail="Faol smena allaqachon mavjud")
    if db.query(DriverShift.id).filter(DriverShift.vehicle_id == vehicle.id, DriverShift.status == "active").first():
        raise HTTPException(status_code=409, detail="Bu transportda boshqa faol smena mavjud")

    shift = DriverShift(
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        route_id=route.id,
        direction=payload.direction,
        status="active",
        started_at=datetime.now(timezone.utc),
    )
    db.add(shift)
    db.flush()
    record_audit_event(db, action="shift.start", actor_user_id=driver.user_id, actor_role="driver",
                       target_type="shift", target_id=shift.id, uyushma_id=driver.uyushma_id,
                       changes={"vehicle": vehicle.internal_id, "route_number": route.route_number,
                                "direction": payload.direction},
                       ip_address=client_ip(request))
    db.commit()
    db.refresh(shift)

    tracking_service.register_shift_start(shift, vehicle, route)
    realtime_manager.set_driver_route(driver.user_id, route.id)
    # Operations maps re-read the fleet on this event (the vehicle appears as "awaiting GPS")
    await tracking_service.broadcast_route_status(route.id, route.route_number)
    return shift


@router.post("/shift/end", response_model=ShiftResponse)
async def end_shift(
    request: Request,
    payload: Optional[ShiftEndRequest] = None,
    driver: DriverProfile = Depends(get_driver_profile),
    db: Session = Depends(get_db_dep),
):
    shift = _active_shift(db, driver)
    if not shift:
        raise HTTPException(status_code=404, detail="Yakunlash uchun faol smena topilmadi")
    shift.status = "completed"
    shift.ended_at = datetime.now(timezone.utc)
    shift.end_reason = payload.notes if payload else None
    record_audit_event(db, action="shift.end", actor_user_id=driver.user_id, actor_role="driver",
                       target_type="shift", target_id=shift.id, uyushma_id=driver.uyushma_id,
                       ip_address=client_ip(request))
    db.commit()
    db.refresh(shift)

    state = tracking_service.register_shift_end(shift.vehicle_id)
    realtime_manager.set_driver_route(driver.user_id, None)
    if shift.route:
        await tracking_service.broadcast_route_status(shift.route_id, shift.route.route_number)
    if state and state.parking_id:
        await tracking_service.broadcast_parking_count(db, state.parking_id)
    return shift


@router.get("/shift/current", response_model=Optional[ShiftResponse])
def get_current_shift(driver: DriverProfile = Depends(get_driver_profile), db: Session = Depends(get_db_dep)):
    """Active shift or `null`."""
    return _active_shift(db, driver)


@router.post("/shift/direction", response_model=ShiftResponse)
async def switch_direction(
    payload: ShiftDirectionRequest,
    driver: DriverProfile = Depends(get_driver_profile),
    db: Session = Depends(get_db_dep),
):
    """Switch outbound/inbound at a terminal (affects ETA and which waiting passengers are relevant)."""
    shift = _require_active_shift(db, driver)
    shift.direction = payload.direction
    record_audit_event(db, action="shift.direction", actor_user_id=driver.user_id, actor_role="driver",
                       target_type="shift", target_id=shift.id, uyushma_id=driver.uyushma_id,
                       changes={"direction": payload.direction})
    db.commit()
    db.refresh(shift)
    tracking_service.set_direction(shift.vehicle_id, payload.direction)
    await tracking_service.broadcast_current_location(shift.vehicle_id)
    return shift


# ------------------------------------------------------------------------------
# GPS ingest
# ------------------------------------------------------------------------------


@router.post("/gps/single", response_model=GPSIngestResponse)
async def ingest_single_gps(
    point: GPSPointInput,
    driver: DriverProfile = Depends(get_driver_profile),
    db: Session = Depends(get_db_dep),
):
    shift = _require_active_shift(db, driver)
    outcome = await tracking_service.ingest_single_gps(db, shift, point)
    if outcome.rejected_reason:
        # `server_time` in the detail lets the app correct a wrong device clock instead of losing the shift
        raise HTTPException(
            status_code=422,
            detail={
                "message": f"GPS nuqtasi rad etildi: {outcome.rejected_reason}",
                "reason": outcome.rejected_reason,
                "server_time": datetime.now(timezone.utc).isoformat(),
            },
        )
    return GPSIngestResponse(
        status="duplicate" if outcome.duplicate else "ok",
        snapshot_id=outcome.snapshot.id if outcome.snapshot else None,
        applied_to_live=outcome.applied_to_live,
        duplicate=outcome.duplicate,
        server_time=datetime.now(timezone.utc),
    )


@router.post("/gps/batch", response_model=GPSBatchSyncResponse)
async def sync_gps_batch(
    payload: GPSBatchSyncRequest,
    driver: DriverProfile = Depends(get_driver_profile),
    db: Session = Depends(get_db_dep),
):
    """Offline queue sync: idempotent per point key; history is kept, live state only moves forward."""
    shift = _shift_for_history(db, driver, payload.shift_id)
    return await tracking_service.sync_gps_batch(db, shift, payload)


@router.get("/vehicles/live", response_model=List[LiveVehicleStateResponse])
def get_live_vehicles_endpoint(
    route_id: Optional[int] = Query(None, description="Filter by Route ID"),
    direction: Optional[str] = Query(None, pattern="^(outbound|inbound)$"),
):
    """Public: vehicles currently visible on the map (fresh GPS only; stale ones are excluded)."""
    return tracking_service.get_live_vehicles(route_id=route_id, direction=direction, include_stale=False)


@router.get("/passengers/waiting", response_model=WaitingPassengersListResponse)
def waiting_passengers(
    direction: Optional[str] = Query(None, pattern="^(outbound|inbound)$"),
    driver: DriverProfile = Depends(get_driver_profile),
    db: Session = Depends(get_db_dep),
):
    """Waiting passengers ("Kutayapman") on the driver's OWN route, only during an active shift."""
    shift = _require_active_shift(db, driver)
    raw = client_watch_service.get_waiting_passengers(route_id=shift.route_id, direction=direction, db=db)
    passengers = [WaitingPassengerResponse(**p) for p in raw]
    return WaitingPassengersListResponse(route_id=shift.route_id, direction=direction,
                                         total_waiting=len(passengers), passengers=passengers)


# ------------------------------------------------------------------------------
# Payments, refunds, balance, cash-out
# ------------------------------------------------------------------------------


def _driver_payment_read(p: Payment, window_min: int, fare_name: Optional[str] = None) -> DriverPaymentRead:
    refund = payment_service.payment_refund(p)
    label, _ = payment_service.mask_client(p)
    return DriverPaymentRead(
        id=p.id, reference=p.reference, vehicle_id=p.vehicle.internal_id if p.vehicle else "",
        route_id=p.route_id, amount_uzs=p.amount_uzs, commission_uzs=p.commission_uzs or 0,
        net_amount_uzs=p.amount_uzs - (p.commission_uzs or 0), fare_name=fare_name, status=p.status,
        payment_method=p.payment_method, identification_method=p.identification_method, created_at=p.created_at,
        refundable=payment_service.is_refundable(p), refundable_until=p.refundable_until,
        refund_window_minutes=window_min, refund_reason=refund.reason if refund else None,
        refunded_at=refund.created_at if refund else None, passenger_label=label,
    )


@router.get("/payments", response_model=List[DriverPaymentRead])
def driver_payments(
    period: str = Query("today", pattern="^(today|week|month|all)$"),
    status_filter: Optional[str] = Query(None, alias="status", pattern="^(completed|refunded)$"),
    limit: int = Query(200, ge=1, le=500),
    driver: DriverProfile = Depends(get_driver_profile),
    db: Session = Depends(get_db_dep),
):
    """Payments received by this driver's vehicle only (never other vehicles)."""
    if not driver.vehicle:
        return []
    q = db.query(Payment).filter(Payment.driver_id == driver.id, Payment.vehicle_id == driver.vehicle.id)
    if period != "all":
        start = payment_service.local_day_start_utc()
        if period == "week":
            start -= timedelta(days=6)
        elif period == "month":
            start -= timedelta(days=29)
        q = q.filter(Payment.created_at >= start)
    if status_filter:
        q = q.filter(Payment.status == status_filter)
    payments = q.order_by(Payment.created_at.desc()).limit(limit).all()
    rule_names = {r.id: r.name for r in db.query(FareRule).filter(FareRule.id.in_({p.fare_rule_id for p in payments if p.fare_rule_id})).all()}
    window = int(get_setting(db, "refund_window_minutes"))
    return [_driver_payment_read(p, window, rule_names.get(p.fare_rule_id)) for p in payments]


@router.post("/payments/{payment_id}/refund", response_model=DriverPaymentRead)
def refund_payment(
    payment_id: str,
    payload: RefundRequest,
    background: BackgroundTasks,
    driver: DriverProfile = Depends(get_driver_profile),
    db: Session = Depends(get_db_dep),
):
    """Undo a passenger payment within the configured window. Audited; duplicate-safe."""
    try:
        payment = payment_service.refund_payment(db, driver, driver.user, payment_id, payload.reason.strip())
    except payment_service.PaymentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    events.payment_refunded(background, db, payment, payload.reason.strip())
    return _driver_payment_read(payment, int(get_setting(db, "refund_window_minutes")))


@router.get("/balance", response_model=DriverBalanceRead)
def driver_balance(driver: DriverProfile = Depends(get_driver_profile), db: Session = Depends(get_db_dep)):
    return DriverBalanceRead(**payment_service.driver_balance_summary(db, driver))


@router.get("/ledger", response_model=List[LedgerEntryRead])
def driver_ledger(
    limit: int = Query(100, ge=1, le=500),
    driver: DriverProfile = Depends(get_driver_profile),
    db: Session = Depends(get_db_dep),
):
    wallet = ledger_service.get_or_create_wallet(db, driver.user)
    db.commit()
    rows = (
        db.query(WalletTransaction)
        .filter(WalletTransaction.wallet_id == wallet.id)
        .order_by(WalletTransaction.id.desc())
        .limit(limit)
        .all()
    )
    return [LedgerEntryRead.model_validate(r, from_attributes=True) for r in rows]


def _cashout_read(c: CashoutRequest, driver: DriverProfile) -> CashoutRead:
    return CashoutRead(
        id=c.id, driver_id=c.driver_id, driver_name=driver.user.full_name, driver_phone=driver.user.phone,
        uyushma_id=c.uyushma_id, vehicle_id=c.vehicle_id,
        vehicle_internal_id=c.vehicle.internal_id if c.vehicle else None,
        vehicle_plate=c.vehicle.plate_number if c.vehicle else None, amount_uzs=c.amount_uzs, method=c.method,
        payout_details=c.payout_details, status=c.status, created_at=c.created_at, processed_at=c.processed_at,
        paid_at=c.paid_at, rejection_reason=c.rejection_reason, payment_reference=c.payment_reference,
    )


@router.get("/cashouts", response_model=List[CashoutRead])
def driver_cashouts(driver: DriverProfile = Depends(get_driver_profile), db: Session = Depends(get_db_dep)):
    rows = (
        db.query(CashoutRequest)
        .filter(CashoutRequest.driver_id == driver.id)
        .order_by(CashoutRequest.created_at.desc())
        .limit(200)
        .all()
    )
    return [_cashout_read(c, driver) for c in rows]


@router.post("/cashouts", response_model=CashoutRead, status_code=status.HTTP_201_CREATED)
def request_cashout(
    payload: CashoutCreateRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key", max_length=100),
    driver: DriverProfile = Depends(get_driver_profile),
    db: Session = Depends(get_db_dep),
):
    """Ask the Uyushma to pay out earnings; the amount is reserved until paid or rejected."""
    try:
        req = payment_service.request_cashout(
            db, driver, payload.amount_uzs, payload.method, payload.payout_details,
            f"cashout:{driver.id}:{idempotency_key}" if idempotency_key else None,
        )
    except payment_service.PaymentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return _cashout_read(req, driver)
