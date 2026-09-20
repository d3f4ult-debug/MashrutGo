"""Super Admin: global dashboard, tenants, clients, live shifts, settings, audit, ledger health."""
import json
import time
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep, require_super_admin
from app.core.roles import UserRole
from app.core.security import get_password_hash
from app.models.finance import CashoutRequest, Payment, Wallet, WalletTransaction
from app.models.shift import DriverShift
from app.models.system import AuditLog
from app.models.transport import Parking, Route, Vehicle
from app.models.user import DriverProfile, User
from app.models.uyushma import Uyushma
from app.schemas.admin import (
    AdminClientRead,
    AdminKPIs,
    AdminShiftRead,
    AuditLogRead,
    BlockRequest,
    LedgerHealthRead,
    SystemSettingsRead,
    SystemSettingsUpdate,
)
from app.schemas.common import PaginatedResponse, ReasonRequest
from app.schemas.finance import LedgerEntryRead, WalletAdjustRequest
from app.schemas.uyushma import UyushmaAdminAccountRequest, UyushmaAdminRead, UyushmaUpdate
from app.services import ledger_service, payment_service
from app.services.audit_service import client_ip, record_audit_event
from app.services.realtime.connection_manager import realtime_manager
from app.services.realtime.tracking_service import tracking_service
from app.services.settings_service import SettingValidationError, get_all_settings, get_setting, update_settings

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_super_admin)])


def _audit(db: Session, request: Request, actor: User, action: str, target_type: str, target_id, changes=None,
           reason: Optional[str] = None, uyushma_id: Optional[int] = None) -> None:
    record_audit_event(db, action=action, actor_user_id=actor.id, actor_role=actor.role, target_type=target_type,
                       target_id=target_id, changes=changes, reason=reason, uyushma_id=uyushma_id,
                       ip_address=client_ip(request))


# ------------------------------------------------------------------------------
# Dashboard
# ------------------------------------------------------------------------------


@router.get("/kpis", response_model=AdminKPIs)
def admin_kpis(db: Session = Depends(get_db_dep)):
    day_start = payment_service.local_day_start_utc()
    today = db.query(Payment).filter(Payment.created_at >= day_start, Payment.status == "completed")
    live_tenants = db.query(Uyushma.id).filter(Uyushma.archived_at.is_(None))
    live_routes = db.query(Route).filter(Route.is_archived.is_(False), Route.uyushma_id.in_(live_tenants))
    return AdminKPIs(
        total_uyushmalar=live_tenants.count(),
        total_routes=live_routes.count(),
        published_routes=live_routes.filter(Route.is_published.is_(True)).count(),
        total_drivers=db.query(DriverProfile)
        .filter(DriverProfile.is_active.is_(True), DriverProfile.uyushma_id.in_(live_tenants)).count(),
        total_vehicles=db.query(Vehicle).filter(Vehicle.is_active.is_(True), Vehicle.uyushma_id.in_(live_tenants)).count(),
        active_shifts=db.query(DriverShift).filter(DriverShift.status == "active").count(),
        visible_vehicles=len(tracking_service.get_live_vehicles()),
        total_clients=db.query(User).filter(User.role == UserRole.CLIENT.value).count(),
        total_parkings=db.query(Parking).filter(Parking.is_active.is_(True)).count(),
        today_gross_revenue=int(today.with_entities(func.coalesce(func.sum(Payment.amount_uzs), 0)).scalar() or 0),
        today_platform_commission=int(today.with_entities(func.coalesce(func.sum(Payment.commission_uzs), 0)).scalar() or 0),
        today_payments_count=today.count(),
        pending_cashouts_count=db.query(CashoutRequest).filter(CashoutRequest.status.in_(("pending", "approved"))).count(),
        system_status="maintenance" if get_setting(db, "maintenance_mode") else "healthy",
    )


# ------------------------------------------------------------------------------
# Uyushmalar
# ------------------------------------------------------------------------------


def _uyushma_admin_read(db: Session, u: Uyushma) -> UyushmaAdminRead:
    admin = db.query(User).filter(User.uyushma_id == u.id, User.role == UserRole.UYUSHMA_ADMIN.value).first()
    return UyushmaAdminRead.model_validate(
        {
            **{c.name: getattr(u, c.name) for c in Uyushma.__table__.columns},
            "status": "archived" if u.archived_at else "active",
            "routes_count": db.query(Route).filter(Route.uyushma_id == u.id, Route.is_archived.is_(False)).count(),
            "drivers_count": db.query(DriverProfile).filter(DriverProfile.uyushma_id == u.id, DriverProfile.is_active.is_(True)).count(),
            "vehicles_count": db.query(Vehicle).filter(Vehicle.uyushma_id == u.id, Vehicle.is_active.is_(True)).count(),
            "admin_phone": admin.phone if admin else None,
        }
    )


@router.get("/uyushmalar", response_model=List[UyushmaAdminRead])
def admin_list_uyushmalar(db: Session = Depends(get_db_dep)):
    return [_uyushma_admin_read(db, u) for u in db.query(Uyushma).order_by(Uyushma.id).all()]


@router.put("/uyushmalar/{uyushma_id}", response_model=UyushmaAdminRead)
def admin_update_uyushma(
    uyushma_id: int,
    payload: UyushmaUpdate,
    request: Request,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    uyushma = db.query(Uyushma).filter(Uyushma.id == uyushma_id).first()
    if not uyushma:
        raise HTTPException(status_code=404, detail="Uyushma not found")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        if value is not None or key in ("address", "region", "contact_person", "license_number"):
            setattr(uyushma, key, value)
    _audit(db, request, current_user, "uyushma.update", "uyushma", uyushma.id, data, uyushma_id=uyushma.id)
    db.commit()
    db.refresh(uyushma)
    return _uyushma_admin_read(db, uyushma)


@router.post("/uyushmalar/{uyushma_id}/archive", response_model=UyushmaAdminRead)
def admin_archive_uyushma(
    uyushma_id: int,
    payload: ReasonRequest,
    request: Request,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """Soft-archive a tenant: routes unpublished, accounts deactivated, finance history preserved."""
    uyushma = db.query(Uyushma).filter(Uyushma.id == uyushma_id).first()
    if not uyushma:
        raise HTTPException(status_code=404, detail="Uyushma not found")
    if uyushma.archived_at:
        raise HTTPException(status_code=409, detail="Uyushma allaqachon arxivlangan")
    active_shift = (
        db.query(DriverShift.id).join(Vehicle, Vehicle.id == DriverShift.vehicle_id)
        .filter(Vehicle.uyushma_id == uyushma_id, DriverShift.status == "active").first()
    )
    if active_shift:
        raise HTTPException(status_code=409, detail="Uyushmada faol smenalar bor: avval ularni yakunlang")
    uyushma.archived_at = datetime.now(timezone.utc)
    uyushma.archive_reason = payload.reason
    uyushma.is_active = False
    db.query(Route).filter(Route.uyushma_id == uyushma_id).update({"is_published": False})
    db.query(User).filter(User.uyushma_id == uyushma_id).update({"is_active": False})
    db.query(DriverProfile).filter(DriverProfile.uyushma_id == uyushma_id).update({"is_active": False})
    db.query(Vehicle).filter(Vehicle.uyushma_id == uyushma_id).update({"is_active": False})
    _audit(db, request, current_user, "uyushma.archive", "uyushma", uyushma.id, reason=payload.reason, uyushma_id=uyushma.id)
    db.commit()
    db.refresh(uyushma)
    return _uyushma_admin_read(db, uyushma)


@router.put("/uyushmalar/{uyushma_id}/admin", response_model=UyushmaAdminRead)
def admin_set_uyushma_admin(
    uyushma_id: int,
    payload: UyushmaAdminAccountRequest,
    request: Request,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """Create the Uyushma admin login, or reset the existing one's name, phone and password."""
    uyushma = db.query(Uyushma).filter(Uyushma.id == uyushma_id).first()
    if not uyushma:
        raise HTTPException(status_code=404, detail="Uyushma not found")
    if uyushma.archived_at:
        raise HTTPException(status_code=409, detail="Arxivlangan Uyushmaga admin biriktirib bo'lmaydi")
    admin = (
        db.query(User)
        .filter(User.uyushma_id == uyushma_id, User.role == UserRole.UYUSHMA_ADMIN.value)
        .order_by(User.id)
        .first()
    )
    phone_owner = db.query(User).filter(User.phone == payload.phone).first()
    if phone_owner and (admin is None or phone_owner.id != admin.id):
        raise HTTPException(status_code=409, detail="Bu telefon raqami boshqa foydalanuvchida band")
    created = admin is None
    if created:
        admin = User(phone=payload.phone, full_name=payload.full_name, role=UserRole.UYUSHMA_ADMIN.value,
                     uyushma_id=uyushma_id, hashed_password=get_password_hash(payload.password), is_active=True)
        db.add(admin)
        db.flush()
    else:
        admin.phone = payload.phone
        admin.full_name = payload.full_name
        admin.hashed_password = get_password_hash(payload.password)
        admin.is_active = True
        admin.block_reason = None
    _audit(db, request, current_user, "uyushma.admin_create" if created else "uyushma.admin_reset", "user", admin.id,
           {"phone": payload.phone, "full_name": payload.full_name}, uyushma_id=uyushma_id)
    db.commit()
    return _uyushma_admin_read(db, uyushma)


# ------------------------------------------------------------------------------
# Clients
# ------------------------------------------------------------------------------


def _client_read(db: Session, u: User, balances: Optional[dict] = None, rides: Optional[dict] = None) -> AdminClientRead:
    if balances is None or rides is None:
        balances, rides = _client_aggregates(db, [u.id])
    return AdminClientRead(
        id=u.id, phone=u.phone, full_name=u.full_name, wallet_balance=balances.get(u.id, 0),
        total_rides=rides.get(u.id, 0), is_blocked=not u.is_active, block_reason=u.block_reason,
        last_active_at=u.last_active_at, created_at=u.created_at,
    )


def _client_aggregates(db: Session, user_ids: List[int]) -> tuple:
    """Wallet balances and completed-ride counts for a page of clients in two queries."""
    if not user_ids:
        return {}, {}
    balances = dict(db.query(Wallet.user_id, Wallet.balance_uzs).filter(Wallet.user_id.in_(user_ids)).all())
    rides = dict(
        db.query(Payment.client_user_id, func.count(Payment.id))
        .filter(Payment.client_user_id.in_(user_ids), Payment.status == "completed")
        .group_by(Payment.client_user_id)
        .all()
    )
    return balances, rides


@router.get("/clients", response_model=PaginatedResponse[AdminClientRead])
def admin_list_clients(
    search: Optional[str] = Query(None, max_length=50),
    status_filter: Optional[str] = Query(None, alias="status", pattern="^(active|blocked)$"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db_dep),
):
    q = db.query(User).filter(User.role == UserRole.CLIENT.value)
    if status_filter:
        q = q.filter(User.is_active.is_(status_filter == "active"))
    if search:
        term = f"%{search.strip()}%"
        q = q.filter(or_(User.phone.ilike(term), User.full_name.ilike(term)))
    total = q.count()
    users = q.order_by(User.id.desc()).offset((page - 1) * size).limit(size).all()
    balances, rides = _client_aggregates(db, [u.id for u in users])
    return PaginatedResponse.build([_client_read(db, u, balances, rides) for u in users], total, page, size)


@router.post("/clients/{user_id}/toggle-block", response_model=AdminClientRead)
def admin_toggle_client_block(
    user_id: int,
    payload: BlockRequest,
    request: Request,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    user = db.query(User).filter(User.id == user_id, User.role == UserRole.CLIENT.value).first()
    if not user:
        raise HTTPException(status_code=404, detail="Client not found")
    reason = (payload.reason or "").strip()
    if payload.block and len(reason) < 3:
        raise HTTPException(status_code=422, detail="Bloklash sababi majburiy")
    user.is_active = not payload.block
    user.block_reason = reason if payload.block else None
    _audit(db, request, current_user, "client.block" if payload.block else "client.unblock", "user", user.id,
           reason=reason or None)
    db.commit()
    db.refresh(user)
    return _client_read(db, user)


@router.post("/wallets/{user_id}/adjust", response_model=LedgerEntryRead)
def admin_adjust_wallet(
    user_id: int,
    payload: WalletAdjustRequest,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key", min_length=8, max_length=80),
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """
    Manual correction as a new, audited `adjustment` ledger entry (balances are never edited).
    Send an `Idempotency-Key` header: a retried request returns the original entry instead of posting twice.
    """
    if payload.amount_uzs == 0:
        raise HTTPException(status_code=422, detail="amount_uzs must be non-zero")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role not in (UserRole.CLIENT.value, UserRole.DRIVER.value):
        raise HTTPException(status_code=422, detail="Faqat yo'lovchi yoki haydovchi hamyonini tuzatish mumkin")
    wallet = ledger_service.get_or_create_wallet(db, user)
    # Serialise on the wallet: the idempotency check and the insert must be one atomic step
    ledger_service.lock_wallet(db, wallet.id)
    ledger_key = f"adjust:{user.id}:{idempotency_key}" if idempotency_key else (
        f"adjust:{user.id}:{datetime.now(timezone.utc).timestamp()}"
    )
    existing = db.query(WalletTransaction).filter(WalletTransaction.idempotency_key == ledger_key).first()
    if existing is not None:
        if existing.wallet_id != wallet.id or existing.amount_uzs != payload.amount_uzs:
            raise HTTPException(status_code=409, detail="Idempotency-Key boshqa so'rov uchun ishlatilgan")
        return LedgerEntryRead.model_validate(existing, from_attributes=True)
    try:
        entry = ledger_service.post_entry(
            db, wallet, entry_type="adjustment", amount_uzs=payload.amount_uzs,
            description=f"Administrator tuzatishi: {payload.reason}",
            idempotency_key=ledger_key,
            reference_type="admin", reference_id=str(current_user.id), created_by_user_id=current_user.id,
        )
    except ledger_service.InsufficientFundsError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Balans manfiy bo'lib qoladi") from exc
    except ledger_service.WalletInactiveError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Hamyon faol emas") from exc
    except IntegrityError:
        # A concurrent retry with the same key won the race: return that entry instead of failing.
        # The winner may still be committing, so give it a moment before giving up.
        db.rollback()
        for attempt in range(6):
            duplicate = db.query(WalletTransaction).filter(WalletTransaction.idempotency_key == ledger_key).first()
            if duplicate is not None:
                return LedgerEntryRead.model_validate(duplicate, from_attributes=True)
            db.rollback()  # end the read transaction so the next query sees fresh data
            time.sleep(0.05 * (attempt + 1))
        raise HTTPException(status_code=409, detail="Tuzatishni saqlab bo'lmadi, qayta urinib ko'ring") from None
    except ledger_service.LedgerError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    _audit(db, request, current_user, "wallet.adjust", "wallet", wallet.id,
           {"amount_uzs": payload.amount_uzs, "user_id": user.id}, reason=payload.reason)
    db.commit()
    return LedgerEntryRead.model_validate(entry, from_attributes=True)


@router.get("/ledger/health", response_model=LedgerHealthRead)
def admin_ledger_health(db: Session = Depends(get_db_dep)):
    """
    Reconcile every wallet's cached balance against the sum of its immutable ledger.
    Done as a single grouped query so it stays usable with many wallets.
    """
    sums = (
        db.query(WalletTransaction.wallet_id, func.coalesce(func.sum(WalletTransaction.amount_uzs), 0))
        .group_by(WalletTransaction.wallet_id)
        .subquery()
    )
    rows = (
        db.query(Wallet.id, Wallet.balance_uzs, func.coalesce(sums.c[1], 0))
        .outerjoin(sums, sums.c[0] == Wallet.id)
        .all()
    )
    bad = [wallet_id for wallet_id, balance, ledger_sum in rows if int(balance) != int(ledger_sum)]
    return LedgerHealthRead(wallets_checked=len(rows), inconsistent_wallets=bad)


# ------------------------------------------------------------------------------
# Live shifts
# ------------------------------------------------------------------------------


@router.get("/shifts/live", response_model=List[AdminShiftRead])
def admin_live_shifts(db: Session = Depends(get_db_dep)):
    result = []
    for shift in db.query(DriverShift).filter(DriverShift.status == "active").order_by(DriverShift.started_at.desc()).all():
        vehicle, driver = shift.vehicle, shift.driver
        state = tracking_service.get_state(shift.vehicle_id)
        result.append(AdminShiftRead(
            id=shift.id, driver_id=shift.driver_id, driver_name=driver.user.full_name, driver_phone=driver.user.phone,
            uyushma_id=vehicle.uyushma_id, uyushma_name=vehicle.uyushma.name, vehicle_id=vehicle.id,
            vehicle_internal_id=vehicle.internal_id, vehicle_plate=vehicle.plate_number, route_id=shift.route_id,
            route_number=shift.route.route_number if shift.route else "", direction=shift.direction,
            started_at=shift.started_at, last_gps_at=shift.last_gps_at,
            is_online=bool(state and state.has_fix and not state.is_stale),
            current_lat=state.lat if state else None, current_lng=state.lng if state else None,
        ))
    return result


@router.post("/shifts/{shift_id}/force-end")
async def admin_force_end_shift(
    shift_id: int,
    payload: ReasonRequest,
    request: Request,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    shift = db.query(DriverShift).filter(DriverShift.id == shift_id, DriverShift.status == "active").first()
    if not shift:
        raise HTTPException(status_code=404, detail="Active shift not found")
    shift.status = "force_ended"
    shift.ended_at = datetime.now(timezone.utc)
    shift.end_reason = payload.reason
    _audit(db, request, current_user, "shift.force_end", "shift", shift.id, reason=payload.reason,
           uyushma_id=shift.vehicle.uyushma_id if shift.vehicle else None)
    db.commit()
    state = tracking_service.register_shift_end(shift.vehicle_id)
    driver_user_id = shift.driver.user_id
    realtime_manager.set_driver_route(driver_user_id, None)
    await realtime_manager.send_to_driver(driver_user_id, "shift.force_ended", {"shift_id": shift.id, "reason": payload.reason})
    if shift.route:
        await tracking_service.broadcast_route_status(shift.route_id, shift.route.route_number)
    if state and state.parking_id:
        await tracking_service.broadcast_parking_count(db, state.parking_id)
    return {"detail": "Shift force-ended", "shift_id": shift.id}


# ------------------------------------------------------------------------------
# Settings & audit
# ------------------------------------------------------------------------------


@router.get("/settings", response_model=SystemSettingsRead)
def admin_get_settings(db: Session = Depends(get_db_dep)):
    return SystemSettingsRead(**get_all_settings(db))


@router.put("/settings", response_model=SystemSettingsRead)
def admin_update_settings(
    payload: SystemSettingsUpdate,
    request: Request,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    try:
        diff = update_settings(db, updates, current_user)
    except SettingValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if diff:
        _audit(db, request, current_user, "settings.update", "settings", "global", diff)
    db.commit()
    return SystemSettingsRead(**get_all_settings(db))


@router.get("/audit-logs", response_model=PaginatedResponse[AuditLogRead])
def admin_audit_logs(
    action: Optional[str] = Query(None, max_length=100),
    actor_user_id: Optional[int] = None,
    uyushma_id: Optional[int] = None,
    target_type: Optional[str] = Query(None, max_length=50),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db_dep),
):
    q = db.query(AuditLog)
    if action:
        q = q.filter(AuditLog.action.ilike(f"%{action}%"))
    if actor_user_id is not None:
        q = q.filter(AuditLog.actor_user_id == actor_user_id)
    if uyushma_id is not None:
        q = q.filter(AuditLog.uyushma_id == uyushma_id)
    if target_type:
        q = q.filter(AuditLog.target_type == target_type)
    if date_from:
        q = q.filter(AuditLog.created_at >= date_from)
    if date_to:
        q = q.filter(AuditLog.created_at <= date_to)
    total = q.count()
    rows = q.order_by(AuditLog.id.desc()).offset((page - 1) * size).limit(size).all()
    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_({r.actor_user_id for r in rows if r.actor_user_id})).all()}
    items = []
    for r in rows:
        try:
            changes = json.loads(r.changes_json) if r.changes_json else None
        except ValueError:
            changes = r.changes_json
        items.append(AuditLogRead(
            id=r.id, created_at=r.created_at, actor_user_id=r.actor_user_id, actor_name=names.get(r.actor_user_id),
            actor_role=r.actor_role, action=r.action, target_type=r.target_type, target_id=r.target_id,
            uyushma_id=r.uyushma_id, reason=r.reason, changes=changes, ip_address=r.ip_address,
        ))
    return PaginatedResponse.build(items, total, page, size)
