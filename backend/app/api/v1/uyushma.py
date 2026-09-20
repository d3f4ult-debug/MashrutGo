"""Uyushma (tenant) operations: fleet, drivers, parkings, tariffs, finance. Tenant-isolated."""
import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import (
    get_db_dep,
    get_tenant_uyushma,
    require_super_admin,
    require_uyushma_admin,
)
from app.core.security import get_password_hash
from app.models.finance import CashoutRequest, FareRule, Payment
from app.models.shift import DriverShift
from app.models.transport import Parking, Route, Vehicle
from app.models.user import DriverProfile, User
from app.models.uyushma import Uyushma
from app.schemas.common import PaginatedResponse, ReasonRequest
from app.schemas.driver import ParkingCreateRequest, ParkingResponse, ParkingUpdateRequest
from app.schemas.fare import FareRuleCreate, FareRuleRead, FareRuleTypesResponse, FareRuleUpdate
from app.schemas.finance import CashoutPaidRequest, CashoutRead, FinanceSummaryRead, UyushmaPaymentRead
from app.schemas.route import UyushmaRouteSummary
from app.schemas.user import DriverCreateRequest, DriverRead, DriverUpdateRequest
from app.schemas.uyushma import UyushmaCreate, UyushmaKPIs, UyushmaRead
from app.schemas.vehicle import VehicleCreate, VehicleRead, VehicleUpdate
from app.services import events, payment_service
from app.services.audit_service import client_ip, record_audit_event
from app.services.fare_engine import SUPPORTED_RULE_TYPES
from app.services.fleet_service import (
    FleetError,
    active_shift_for_driver,
    active_shifts_for_drivers,
    active_shift_for_vehicle,
    apply_vehicle_assignment,
    assign_driver_vehicle,
    create_driver_account,
    driver_to_read,
    generate_internal_id,
    vehicle_to_read,
)
from app.services.realtime.tracking_service import tracking_service
from app.services.route_service import summarize_route
from app.services.settings_service import get_setting

router = APIRouter(prefix="/uyushma", tags=["uyushma"])


def _fleet_error(exc: FleetError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


def _payment_error(exc: payment_service.PaymentError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


def _audit(db: Session, request: Request, user: User, action: str, target_type: str, target_id, uyushma_id: int, changes=None, reason=None):
    record_audit_event(
        db,
        action=action,
        actor_user_id=user.id,
        actor_role=user.role,
        target_type=target_type,
        target_id=target_id,
        uyushma_id=uyushma_id,
        changes=changes,
        reason=reason,
        ip_address=client_ip(request),
    )


# ------------------------------------------------------------------------------
# Uyushma records
# ------------------------------------------------------------------------------


@router.post("", response_model=UyushmaRead, status_code=status.HTTP_201_CREATED)
def create_uyushma(
    payload: UyushmaCreate,
    request: Request,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """Super Admin creates an Uyushma (optionally with its admin account in the same transaction)."""
    if db.query(Uyushma.id).filter(Uyushma.code == payload.code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Uyushma with code '{payload.code}' already exists")
    wants_admin = any([payload.admin_phone, payload.admin_password, payload.admin_full_name])
    if wants_admin and not all([payload.admin_phone, payload.admin_password, payload.admin_full_name]):
        raise HTTPException(status_code=422, detail="admin_full_name, admin_phone va admin_password birgalikda berilishi kerak")
    if payload.admin_phone and db.query(User.id).filter(User.phone == payload.admin_phone).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Admin telefon raqami band")

    uyushma = Uyushma(**payload.model_dump(exclude={"admin_full_name", "admin_phone", "admin_password"}))
    db.add(uyushma)
    db.flush()
    if wants_admin:
        db.add(
            User(
                phone=payload.admin_phone,
                hashed_password=get_password_hash(payload.admin_password),
                full_name=payload.admin_full_name,
                role="uyushma_admin",
                uyushma_id=uyushma.id,
                is_active=True,
            )
        )
    _audit(db, request, current_user, "uyushma.create", "uyushma", uyushma.id, uyushma.id,
           {"name": uyushma.name, "code": uyushma.code, "admin_phone": payload.admin_phone})
    db.commit()
    db.refresh(uyushma)
    return uyushma


@router.get("", response_model=List[UyushmaRead])
def list_uyushmas(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    return db.query(Uyushma).order_by(Uyushma.id).offset(skip).limit(limit).all()


@router.get("/{id}", response_model=UyushmaRead)
def get_uyushma(id: int, current_user: User = Depends(require_uyushma_admin), db: Session = Depends(get_db_dep)):
    return get_tenant_uyushma(db, current_user, id)


@router.get("/{id}/kpis", response_model=UyushmaKPIs)
def get_kpis(id: int, current_user: User = Depends(require_uyushma_admin), db: Session = Depends(get_db_dep)):
    get_tenant_uyushma(db, current_user, id)
    routes = db.query(Route).filter(Route.uyushma_id == id, Route.is_archived.is_(False)).all()
    day_start = payment_service.local_day_start_utc()
    today = db.query(Payment).filter(Payment.uyushma_id == id, Payment.created_at >= day_start, Payment.status == "completed")
    pending = db.query(CashoutRequest).filter(CashoutRequest.uyushma_id == id, CashoutRequest.status.in_(("pending", "approved")))
    parking_ids = [p.id for p in db.query(Parking).filter(Parking.uyushma_id == id, Parking.is_active.is_(True)).all()]
    return UyushmaKPIs(
        uyushma_id=id,
        owned_routes_count=len(routes),
        published_routes_count=sum(1 for r in routes if r.is_published),
        drivers_count=db.query(DriverProfile).filter(DriverProfile.uyushma_id == id, DriverProfile.is_active.is_(True)).count(),
        vehicles_count=db.query(Vehicle).filter(Vehicle.uyushma_id == id, Vehicle.is_active.is_(True)).count(),
        active_shifts_count=db.query(DriverShift).join(Vehicle, Vehicle.id == DriverShift.vehicle_id)
        .filter(Vehicle.uyushma_id == id, DriverShift.status == "active").count(),
        visible_vehicles_count=len(tracking_service.get_live_vehicles(uyushma_id=id)),
        parkings_count=len(parking_ids),
        parked_vehicles_count=sum(tracking_service.get_parking_vehicle_count(pid) for pid in parking_ids),
        today_payments_total=int(today.with_entities(func.coalesce(func.sum(Payment.amount_uzs), 0)).scalar() or 0),
        today_payments_count=today.count(),
        pending_cashouts_count=pending.count(),
        pending_cashouts_total=int(pending.with_entities(func.coalesce(func.sum(CashoutRequest.amount_uzs), 0)).scalar() or 0),
    )


@router.get("/{id}/routes", response_model=List[UyushmaRouteSummary])
def list_uyushma_routes(id: int, current_user: User = Depends(require_uyushma_admin), db: Session = Depends(get_db_dep)):
    get_tenant_uyushma(db, current_user, id)
    routes = db.query(Route).filter(Route.uyushma_id == id, Route.is_archived.is_(False)).order_by(Route.route_number).all()
    return [summarize_route(db, r) for r in routes]


# ------------------------------------------------------------------------------
# Drivers
# ------------------------------------------------------------------------------


def _load_driver(db: Session, uyushma_id: int, driver_id: int) -> DriverProfile:
    driver = db.query(DriverProfile).filter(DriverProfile.id == driver_id, DriverProfile.uyushma_id == uyushma_id).first()
    if not driver:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found")
    return driver


@router.get("/{id}/drivers", response_model=List[DriverRead])
def list_uyushma_drivers(
    id: int,
    include_inactive: bool = False,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    get_tenant_uyushma(db, current_user, id)
    q = db.query(DriverProfile).filter(DriverProfile.uyushma_id == id)
    if not include_inactive:
        q = q.filter(DriverProfile.is_active.is_(True))
    drivers = q.order_by(DriverProfile.id.desc()).all()
    shifts = active_shifts_for_drivers(db, [dp.id for dp in drivers])
    return [driver_to_read(db, dp, shifts) for dp in drivers]


@router.post("/{id}/drivers", response_model=DriverRead, status_code=status.HTTP_201_CREATED)
def create_driver_for_uyushma(
    id: int,
    payload: DriverCreateRequest,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Uyushma creates the driver account (drivers never self-register) and optionally assigns a vehicle."""
    uyushma = get_tenant_uyushma(db, current_user, id)
    try:
        profile = create_driver_account(db, uyushma, payload.phone, payload.password, payload.full_name.strip(),
                                        payload.email, payload.license_number)
        if payload.vehicle_id is not None or payload.route_id is not None:
            assign_driver_vehicle(db, profile, set_vehicle=payload.vehicle_id is not None, vehicle_id=payload.vehicle_id,
                                  set_route=payload.route_id is not None, route_id=payload.route_id)
        _audit(db, request, current_user, "driver.create", "driver", profile.id, id,
               {"phone": payload.phone, "name": payload.full_name, "vehicle_id": payload.vehicle_id})
        db.commit()
    except FleetError as exc:
        db.rollback()
        raise _fleet_error(exc) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Ma'lumotlar ziddiyati (telefon yoki transport band)") from exc
    db.refresh(profile)
    return driver_to_read(db, profile)


@router.put("/{id}/drivers/{driver_id}", response_model=DriverRead)
def update_driver(
    id: int,
    driver_id: int,
    payload: DriverUpdateRequest,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    get_tenant_uyushma(db, current_user, id)
    driver = _load_driver(db, id, driver_id)
    user = driver.user
    fields = payload.model_fields_set
    try:
        if "phone" in fields and payload.phone and payload.phone != user.phone:
            if db.query(User.id).filter(User.phone == payload.phone).first():
                raise FleetError("Bu telefon raqami band", 409)
            user.phone = payload.phone
        if "full_name" in fields and payload.full_name:
            user.full_name = payload.full_name.strip()
        if "email" in fields:
            user.email = payload.email
        if "license_number" in fields:
            driver.license_number = payload.license_number
        if "password" in fields and payload.password:
            user.hashed_password = get_password_hash(payload.password)
        if "is_active" in fields and payload.is_active is not None:
            if not payload.is_active and active_shift_for_driver(db, driver.id):
                raise FleetError("Haydovchi faol smenada: avval smenani yakunlang", 409)
            driver.is_active = payload.is_active
            user.is_active = payload.is_active
        if "vehicle_id" in fields or "route_id" in fields:
            assign_driver_vehicle(db, driver, set_vehicle="vehicle_id" in fields, vehicle_id=payload.vehicle_id,
                                  set_route="route_id" in fields, route_id=payload.route_id)
        changes = payload.model_dump(exclude_unset=True, exclude={"password"})
        if "password" in fields:
            changes["password"] = "changed"
        _audit(db, request, current_user, "driver.update", "driver", driver.id, id, changes)
        db.commit()
    except FleetError as exc:
        db.rollback()
        raise _fleet_error(exc) from exc
    db.refresh(driver)
    return driver_to_read(db, driver)


@router.delete("/{id}/drivers/{driver_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_driver(
    id: int,
    driver_id: int,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Soft delete: the account is deactivated and the vehicle released; payment history remains."""
    get_tenant_uyushma(db, current_user, id)
    driver = _load_driver(db, id, driver_id)
    if active_shift_for_driver(db, driver.id):
        raise HTTPException(status_code=409, detail="Haydovchi faol smenada: avval smenani yakunlang")
    driver.is_active = False
    driver.user.is_active = False
    if driver.vehicle:
        driver.vehicle.driver_id = None
    _audit(db, request, current_user, "driver.deactivate", "driver", driver.id, id)
    db.commit()


# ------------------------------------------------------------------------------
# Vehicles
# ------------------------------------------------------------------------------


def _load_vehicle(db: Session, uyushma_id: int, vehicle_id: int) -> Vehicle:
    vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id, Vehicle.uyushma_id == uyushma_id).first()
    if not vehicle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
    return vehicle


@router.get("/{id}/vehicles", response_model=List[VehicleRead])
def list_vehicles(
    id: int,
    include_inactive: bool = True,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    get_tenant_uyushma(db, current_user, id)
    q = db.query(Vehicle).filter(Vehicle.uyushma_id == id)
    if not include_inactive:
        q = q.filter(Vehicle.is_active.is_(True))
    return [vehicle_to_read(db, v) for v in q.order_by(Vehicle.id.desc()).all()]


@router.post("/{id}/vehicles", response_model=VehicleRead, status_code=status.HTTP_201_CREATED)
def create_vehicle(
    id: int,
    payload: VehicleCreate,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Register a vehicle. Plate/model/color are optional; the internal id is mandatory and unique."""
    uyushma = get_tenant_uyushma(db, current_user, id)
    internal_id = (payload.internal_id or "").strip().upper() or generate_internal_id(db, uyushma)
    if db.query(Vehicle.id).filter(func.upper(Vehicle.internal_id) == internal_id).first():
        raise HTTPException(status_code=409, detail=f"Ichki ID '{internal_id}' band")
    if payload.nfc_tag_id and db.query(Vehicle.id).filter(Vehicle.nfc_tag_id == payload.nfc_tag_id).first():
        raise HTTPException(status_code=409, detail="NFC tegi boshqa transportga biriktirilgan")
    if payload.driver_id is None and payload.is_active:
        limit = int(get_setting(db, "max_unassigned_vehicles"))
        unassigned = (
            db.query(Vehicle.id)
            .filter(Vehicle.uyushma_id == id, Vehicle.is_active.is_(True), Vehicle.driver_id.is_(None))
            .count()
        )
        if unassigned >= limit:
            raise HTTPException(
                status_code=409,
                detail=f"Haydovchisiz transportlar limiti ({limit}) to'ldi: avval mavjud transportlarga haydovchi biriktiring",
            )
    vehicle = Vehicle(
        internal_id=internal_id,
        uyushma_id=id,
        plate_number=payload.plate_number.upper() if payload.plate_number else None,
        model=payload.model,
        color=payload.color,
        vehicle_type=payload.vehicle_type,
        nfc_tag_id=payload.nfc_tag_id,
        capacity=payload.capacity,
        is_active=payload.is_active,
    )
    db.add(vehicle)
    try:
        db.flush()
        apply_vehicle_assignment(db, vehicle, set_driver=payload.driver_id is not None, driver_id=payload.driver_id,
                                 set_route=payload.route_id is not None, route_id=payload.route_id)
        _audit(db, request, current_user, "vehicle.create", "vehicle", vehicle.internal_id, id,
               payload.model_dump(exclude_unset=True))
        db.commit()
    except FleetError as exc:
        db.rollback()
        raise _fleet_error(exc) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Ma'lumotlar ziddiyati (ID, NFC yoki haydovchi band)") from exc
    db.refresh(vehicle)
    return vehicle_to_read(db, vehicle)


@router.put("/{id}/vehicles/{vehicle_id}", response_model=VehicleRead)
def update_vehicle(
    id: int,
    vehicle_id: int,
    payload: VehicleUpdate,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    get_tenant_uyushma(db, current_user, id)
    vehicle = _load_vehicle(db, id, vehicle_id)
    fields = payload.model_fields_set
    try:
        for attr in ("model", "color", "vehicle_type", "capacity"):
            if attr in fields and (getattr(payload, attr) is not None or attr != "capacity"):
                setattr(vehicle, attr, getattr(payload, attr))
        if "plate_number" in fields:
            vehicle.plate_number = payload.plate_number.upper().strip() if payload.plate_number else None
        if "nfc_tag_id" in fields:
            tag = (payload.nfc_tag_id or "").strip() or None
            if tag and db.query(Vehicle.id).filter(Vehicle.nfc_tag_id == tag, Vehicle.id != vehicle.id).first():
                raise FleetError("NFC tegi boshqa transportga biriktirilgan", 409)
            vehicle.nfc_tag_id = tag
        if "is_active" in fields and payload.is_active is not None:
            if not payload.is_active and active_shift_for_vehicle(db, vehicle.id):
                raise FleetError("Transport faol smenada: avval smenani yakunlang", 409)
            vehicle.is_active = payload.is_active
        apply_vehicle_assignment(db, vehicle, set_driver="driver_id" in fields, driver_id=payload.driver_id,
                                 set_route="route_id" in fields, route_id=payload.route_id)
        _audit(db, request, current_user, "vehicle.update", "vehicle", vehicle.internal_id, id,
               payload.model_dump(exclude_unset=True))
        db.commit()
    except FleetError as exc:
        db.rollback()
        raise _fleet_error(exc) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Ma'lumotlar ziddiyati (NFC yoki haydovchi band)") from exc
    db.refresh(vehicle)
    return vehicle_to_read(db, vehicle)


@router.delete("/{id}/vehicles/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_vehicle(
    id: int,
    vehicle_id: int,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Soft delete: vehicle is deactivated and detached from driver/route (payments keep their history)."""
    get_tenant_uyushma(db, current_user, id)
    vehicle = _load_vehicle(db, id, vehicle_id)
    if active_shift_for_vehicle(db, vehicle.id):
        raise HTTPException(status_code=409, detail="Transport faol smenada: avval smenani yakunlang")
    vehicle.is_active = False
    vehicle.driver_id = None
    vehicle.route_id = None
    _audit(db, request, current_user, "vehicle.deactivate", "vehicle", vehicle.internal_id, id)
    db.commit()


# ------------------------------------------------------------------------------
# Parkings (stoyankalar)
# ------------------------------------------------------------------------------


def _parking_read(p: Parking) -> ParkingResponse:
    return ParkingResponse(
        id=p.id, uyushma_id=p.uyushma_id, name=p.name, lat=p.lat, lng=p.lng, radius_meters=p.radius_meters,
        capacity=p.capacity, is_active=p.is_active,
        vehicle_count=tracking_service.get_parking_vehicle_count(p.id), created_at=p.created_at,
    )


def _load_parking(db: Session, uyushma_id: int, parking_id: int) -> Parking:
    parking = db.query(Parking).filter(Parking.id == parking_id, Parking.uyushma_id == uyushma_id).first()
    if not parking:
        raise HTTPException(status_code=404, detail="Parking not found")
    return parking


@router.get("/{id}/parkings", response_model=List[ParkingResponse])
def list_parkings(id: int, current_user: User = Depends(require_uyushma_admin), db: Session = Depends(get_db_dep)):
    get_tenant_uyushma(db, current_user, id)
    return [_parking_read(p) for p in db.query(Parking).filter(Parking.uyushma_id == id).order_by(Parking.id.desc()).all()]


@router.post("/{id}/parkings", response_model=ParkingResponse, status_code=status.HTTP_201_CREATED)
def create_parking(
    id: int,
    payload: ParkingCreateRequest,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    get_tenant_uyushma(db, current_user, id)
    parking = Parking(uyushma_id=id, **payload.model_dump(exclude={"uyushma_id"}))
    db.add(parking)
    db.flush()
    tracking_service.invalidate_parking_cache()
    _audit(db, request, current_user, "parking.create", "parking", parking.id, id, payload.model_dump())
    db.commit()
    db.refresh(parking)
    return _parking_read(parking)


@router.put("/{id}/parkings/{parking_id}", response_model=ParkingResponse)
def update_parking(
    id: int,
    parking_id: int,
    payload: ParkingUpdateRequest,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    get_tenant_uyushma(db, current_user, id)
    parking = _load_parking(db, id, parking_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(parking, key, value)
    tracking_service.invalidate_parking_cache()
    _audit(db, request, current_user, "parking.update", "parking", parking.id, id, payload.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(parking)
    return _parking_read(parking)


@router.delete("/{id}/parkings/{parking_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_parking(
    id: int,
    parking_id: int,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    get_tenant_uyushma(db, current_user, id)
    parking = _load_parking(db, id, parking_id)
    parking.is_active = False
    tracking_service.invalidate_parking_cache()
    _audit(db, request, current_user, "parking.deactivate", "parking", parking.id, id)
    db.commit()


# ------------------------------------------------------------------------------
# Fare rules
# ------------------------------------------------------------------------------


def _fare_read(rule: FareRule) -> FareRuleRead:
    config = json.loads(rule.config_json) if rule.config_json else {}
    return FareRuleRead(
        id=rule.id, uyushma_id=rule.uyushma_id, route_id=rule.route_id,
        route_number=rule.route.route_number if rule.route else None, name=rule.name, description=rule.description,
        rule_type=rule.rule_type, base_fare_uzs=rule.base_fare_uzs, extra_fare_per_km_uzs=rule.extra_fare_per_km_uzs,
        config=config, is_active=rule.is_active, created_at=rule.created_at, updated_at=rule.updated_at,
    )


def _check_fare_route(db: Session, uyushma_id: int, route_id: Optional[int]) -> None:
    if route_id is None:
        return
    if not db.query(Route.id).filter(Route.id == route_id, Route.uyushma_id == uyushma_id, Route.is_archived.is_(False)).first():
        raise HTTPException(status_code=404, detail="Route not found in this Uyushma")


@router.get("/{id}/fares/types", response_model=FareRuleTypesResponse)
def fare_rule_types(id: int, current_user: User = Depends(require_uyushma_admin), db: Session = Depends(get_db_dep)):
    get_tenant_uyushma(db, current_user, id)
    return FareRuleTypesResponse(rule_types=list(SUPPORTED_RULE_TYPES))


@router.get("/{id}/fares", response_model=List[FareRuleRead])
def list_fares(id: int, current_user: User = Depends(require_uyushma_admin), db: Session = Depends(get_db_dep)):
    get_tenant_uyushma(db, current_user, id)
    return [_fare_read(r) for r in db.query(FareRule).filter(FareRule.uyushma_id == id).order_by(FareRule.id.desc()).all()]


@router.post("/{id}/fares", response_model=FareRuleRead, status_code=status.HTTP_201_CREATED)
def create_fare(
    id: int,
    payload: FareRuleCreate,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    get_tenant_uyushma(db, current_user, id)
    _check_fare_route(db, id, payload.route_id)
    rule = FareRule(
        uyushma_id=id, route_id=payload.route_id, name=payload.name, description=payload.description,
        rule_type=payload.rule_type, base_fare_uzs=payload.base_fare_uzs,
        extra_fare_per_km_uzs=payload.extra_fare_per_km_uzs,
        config_json=json.dumps(payload.config) if payload.config else None, is_active=payload.is_active,
    )
    db.add(rule)
    db.flush()
    _audit(db, request, current_user, "fare.create", "fare_rule", rule.id, id, payload.model_dump())
    db.commit()
    db.refresh(rule)
    return _fare_read(rule)


@router.put("/{id}/fares/{fare_id}", response_model=FareRuleRead)
def update_fare(
    id: int,
    fare_id: int,
    payload: FareRuleUpdate,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    get_tenant_uyushma(db, current_user, id)
    rule = db.query(FareRule).filter(FareRule.id == fare_id, FareRule.uyushma_id == id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Fare rule not found")
    data = payload.model_dump(exclude_unset=True)
    if "route_id" in data:
        _check_fare_route(db, id, data["route_id"])
        rule.route_id = data["route_id"]
    for key in ("name", "description", "rule_type", "base_fare_uzs", "extra_fare_per_km_uzs", "is_active"):
        if key in data and (data[key] is not None or key == "description"):
            setattr(rule, key, data[key])
    if "config" in data:
        rule.config_json = json.dumps(data["config"]) if data["config"] else None
    _audit(db, request, current_user, "fare.update", "fare_rule", rule.id, id, data)
    db.commit()
    db.refresh(rule)
    return _fare_read(rule)


@router.delete("/{id}/fares/{fare_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_fare(
    id: int,
    fare_id: int,
    request: Request,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Tariffs referenced by payments are never deleted, only deactivated."""
    get_tenant_uyushma(db, current_user, id)
    rule = db.query(FareRule).filter(FareRule.id == fare_id, FareRule.uyushma_id == id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Fare rule not found")
    rule.is_active = False
    _audit(db, request, current_user, "fare.deactivate", "fare_rule", rule.id, id)
    db.commit()


# ------------------------------------------------------------------------------
# Finance: payments, summary, cash-outs
# ------------------------------------------------------------------------------


def uyushma_payment_read(p: Payment) -> UyushmaPaymentRead:
    refund = payment_service.payment_refund(p)
    label, _ = payment_service.mask_client(p)
    return UyushmaPaymentRead(
        id=p.id, reference=p.reference, uyushma_id=p.uyushma_id, route_id=p.route_id,
        route_number=p.route.route_number if p.route else "", vehicle_id=p.vehicle_id,
        vehicle_internal_id=p.vehicle.internal_id if p.vehicle else "", vehicle_plate=p.vehicle.plate_number if p.vehicle else None,
        driver_id=p.driver_id, driver_name=p.driver.user.full_name if p.driver and p.driver.user else "",
        amount_uzs=p.amount_uzs, commission_uzs=p.commission_uzs or 0, net_amount_uzs=p.amount_uzs - (p.commission_uzs or 0),
        status=p.status, payment_method=p.payment_method, identification_method=p.identification_method,
        created_at=p.created_at, refund_reason=refund.reason if refund else None,
        refunded_at=refund.created_at if refund else None, passenger_label=label,
    )


def cashout_read(db: Session, c: CashoutRequest) -> CashoutRead:
    processed_by_id = c.paid_by_user_id or c.approved_by_user_id
    processed_by = db.query(User.full_name).filter(User.id == processed_by_id).scalar() if processed_by_id else None
    driver_user = c.driver.user if c.driver else None
    return CashoutRead(
        id=c.id, driver_id=c.driver_id, driver_name=driver_user.full_name if driver_user else "",
        driver_phone=driver_user.phone if driver_user else "", uyushma_id=c.uyushma_id, vehicle_id=c.vehicle_id,
        vehicle_internal_id=c.vehicle.internal_id if c.vehicle else None, vehicle_plate=c.vehicle.plate_number if c.vehicle else None,
        amount_uzs=c.amount_uzs, method=c.method, payout_details=c.payout_details, status=c.status,
        created_at=c.created_at, processed_at=c.processed_at, paid_at=c.paid_at, processed_by=processed_by,
        rejection_reason=c.rejection_reason, payment_reference=c.payment_reference,
    )


@router.get("/{id}/payments", response_model=PaginatedResponse[UyushmaPaymentRead])
def list_payments(
    id: int,
    route_id: Optional[int] = None,
    status_filter: Optional[str] = Query(None, alias="status", pattern="^(completed|refunded|failed)$"),
    method: Optional[str] = Query(None, pattern="^(wallet|click)$"),
    search: Optional[str] = Query(None, max_length=50),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    get_tenant_uyushma(db, current_user, id)
    q = db.query(Payment).filter(Payment.uyushma_id == id)
    if route_id is not None:
        q = q.filter(Payment.route_id == route_id)
    if status_filter:
        q = q.filter(Payment.status == status_filter)
    if method:
        q = q.filter(Payment.payment_method == method)
    if date_from:
        q = q.filter(Payment.created_at >= date_from)
    if date_to:
        q = q.filter(Payment.created_at <= date_to)
    if search:
        term = f"%{search.strip()}%"
        q = (
            q.join(Vehicle, Vehicle.id == Payment.vehicle_id)
            .join(DriverProfile, DriverProfile.id == Payment.driver_id)
            .join(User, User.id == DriverProfile.user_id)
            .filter(or_(Payment.reference.ilike(term), Vehicle.plate_number.ilike(term),
                        Vehicle.internal_id.ilike(term), User.full_name.ilike(term)))
        )
    total = q.count()
    items = q.order_by(Payment.created_at.desc()).offset((page - 1) * size).limit(size).all()
    return PaginatedResponse.build([uyushma_payment_read(p) for p in items], total, page, size)


@router.get("/{id}/finance/summary", response_model=FinanceSummaryRead)
def finance_summary(
    id: int,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Payment totals for the period; cash-out totals are current (pending/approved) and all-time (paid)."""
    get_tenant_uyushma(db, current_user, id)
    return FinanceSummaryRead(**payment_service.finance_summary(db, id, since=date_from, until=date_to))


@router.get("/{id}/cashouts", response_model=List[CashoutRead])
def list_cashouts(
    id: int,
    status_filter: Optional[str] = Query(None, alias="status", pattern="^(pending|approved|rejected|paid)$"),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    get_tenant_uyushma(db, current_user, id)
    q = db.query(CashoutRequest).filter(CashoutRequest.uyushma_id == id)
    if status_filter:
        q = q.filter(CashoutRequest.status == status_filter)
    return [cashout_read(db, c) for c in q.order_by(CashoutRequest.created_at.desc()).limit(500).all()]


@router.post("/{id}/cashouts/{cashout_id}/approve", response_model=CashoutRead)
def approve_cashout(
    id: int,
    cashout_id: int,
    background: BackgroundTasks,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    get_tenant_uyushma(db, current_user, id)
    try:
        req = payment_service.approve_cashout(db, id, cashout_id, current_user)
    except payment_service.PaymentError as exc:
        raise _payment_error(exc) from exc
    events.cashout_status_changed(background, db, req)
    return cashout_read(db, req)


@router.post("/{id}/cashouts/{cashout_id}/reject", response_model=CashoutRead)
def reject_cashout(
    id: int,
    cashout_id: int,
    payload: ReasonRequest,
    background: BackgroundTasks,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    get_tenant_uyushma(db, current_user, id)
    try:
        req = payment_service.reject_cashout(db, id, cashout_id, current_user, payload.reason)
    except payment_service.PaymentError as exc:
        raise _payment_error(exc) from exc
    events.cashout_status_changed(background, db, req)
    return cashout_read(db, req)


@router.post("/{id}/cashouts/{cashout_id}/mark-paid", response_model=CashoutRead)
def mark_cashout_paid(
    id: int,
    cashout_id: int,
    payload: CashoutPaidRequest,
    background: BackgroundTasks,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Records the cash/card payout and debits the driver's ledger exactly once."""
    get_tenant_uyushma(db, current_user, id)
    try:
        req = payment_service.mark_cashout_paid(db, id, cashout_id, current_user, payload.payment_reference.strip())
    except payment_service.PaymentError as exc:
        raise _payment_error(exc) from exc
    events.cashout_status_changed(background, db, req)
    return cashout_read(db, req)
