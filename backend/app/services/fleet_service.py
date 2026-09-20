"""
Fleet management: vehicles, drivers and the "1 Driver = 1 Vehicle = 1 Route" rule.

The rule is enforced here (server-side, authoritative); the UI mirrors it for UX only.
- A vehicle has at most one driver (DB unique constraint on vehicles.driver_id).
- A driver drives at most one vehicle (checked here, clear error instead of silent reassignment).
- A vehicle serves exactly one route; the driver's route is the vehicle's route.
- Assignments cannot change while the vehicle/driver is on an active shift.
"""
import re
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.shift import DriverShift
from app.models.transport import Route, Vehicle
from app.models.user import DriverProfile, User
from app.models.uyushma import Uyushma
from app.schemas.user import ActiveShiftBrief, DriverRead
from app.schemas.vehicle import VehicleRead
from app.services.realtime.tracking_service import tracking_service


class FleetError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def active_shift_for_vehicle(db: Session, vehicle_id: int) -> Optional[DriverShift]:
    return db.query(DriverShift).filter(DriverShift.vehicle_id == vehicle_id, DriverShift.status == "active").first()


def active_shift_for_driver(db: Session, driver_id: int) -> Optional[DriverShift]:
    return db.query(DriverShift).filter(DriverShift.driver_id == driver_id, DriverShift.status == "active").first()


def qr_payload(vehicle: Vehicle) -> str:
    return f"mashrutgo://v/{vehicle.internal_id}"


def generate_internal_id(db: Session, uyushma: Uyushma) -> str:
    prefix = re.sub(r"[^A-Z0-9]", "", uyushma.code.upper())[:8] or f"U{uyushma.id}"
    n = db.query(Vehicle).filter(Vehicle.uyushma_id == uyushma.id).count() + 1
    while True:
        candidate = f"{prefix}-V{n:04d}"
        if not db.query(Vehicle.id).filter(Vehicle.internal_id == candidate).first():
            return candidate
        n += 1


def _route_in_uyushma(db: Session, uyushma_id: int, route_id: int) -> Route:
    route = db.query(Route).filter(Route.id == route_id, Route.uyushma_id == uyushma_id).first()
    if not route or route.is_archived:
        raise FleetError("Yo'nalish topilmadi yoki arxivlangan", 404)
    return route


def _driver_in_uyushma(db: Session, uyushma_id: int, driver_id: int) -> DriverProfile:
    driver = db.query(DriverProfile).filter(DriverProfile.id == driver_id, DriverProfile.uyushma_id == uyushma_id).first()
    if not driver:
        raise FleetError("Haydovchi topilmadi", 404)
    return driver


def apply_vehicle_assignment(
    db: Session,
    vehicle: Vehicle,
    *,
    set_driver: bool,
    driver_id: Optional[int],
    set_route: bool,
    route_id: Optional[int],
) -> None:
    """Change a vehicle's driver and/or route with full rule validation (no commit)."""
    changes_driver = set_driver and driver_id != vehicle.driver_id
    changes_route = set_route and route_id != vehicle.route_id
    if (changes_driver or changes_route) and vehicle.id is not None and active_shift_for_vehicle(db, vehicle.id):
        raise FleetError("Transport faol smenada: avval smenani yakunlang, keyin biriktirishni o'zgartiring", 409)

    if changes_route:
        if route_id is not None:
            _route_in_uyushma(db, vehicle.uyushma_id, route_id)
        vehicle.route_id = route_id

    if changes_driver:
        if driver_id is not None:
            driver = _driver_in_uyushma(db, vehicle.uyushma_id, driver_id)
            other = db.query(Vehicle).filter(Vehicle.driver_id == driver_id, Vehicle.id != vehicle.id).first()
            if other:
                raise FleetError(
                    f"Qoida (1 Driver = 1 Vehicle): haydovchi {driver.user.full_name} allaqachon "
                    f"{other.plate_number or other.internal_id} transportiga biriktirilgan",
                    409,
                )
            if active_shift_for_driver(db, driver_id):
                raise FleetError("Haydovchi faol smenada: avval smenani yakunlang", 409)
        vehicle.driver_id = driver_id


def assign_driver_vehicle(
    db: Session,
    driver: DriverProfile,
    *,
    set_vehicle: bool,
    vehicle_id: Optional[int],
    set_route: bool,
    route_id: Optional[int],
) -> None:
    """Driver-centric assignment used by the drivers screen (no commit)."""
    current = driver.vehicle
    if set_vehicle and (current is None or current.id != vehicle_id):
        if active_shift_for_driver(db, driver.id):
            raise FleetError("Haydovchi faol smenada: avval smenani yakunlang", 409)
        if vehicle_id is not None:
            vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id, Vehicle.uyushma_id == driver.uyushma_id).first()
            if not vehicle:
                raise FleetError("Transport topilmadi", 404)
            if vehicle.driver_id is not None and vehicle.driver_id != driver.id:
                taken_by = db.query(DriverProfile).filter(DriverProfile.id == vehicle.driver_id).first()
                name = taken_by.user.full_name if taken_by and taken_by.user else "boshqa haydovchi"
                raise FleetError(
                    f"Qoida (1 Driver = 1 Vehicle): {vehicle.plate_number or vehicle.internal_id} transporti "
                    f"allaqachon {name}ga biriktirilgan",
                    409,
                )
            if current is not None:
                current.driver_id = None
                db.flush()
            apply_vehicle_assignment(db, vehicle, set_driver=True, driver_id=driver.id, set_route=False, route_id=None)
            current = vehicle
        else:
            if current is not None:
                current.driver_id = None
            current = None
        db.flush()
        db.refresh(driver)

    if set_route:
        vehicle = driver.vehicle if not set_vehicle else current
        if vehicle is None:
            if route_id is not None:
                raise FleetError("Yo'nalish transport orqali biriktiriladi: avval transport tanlang", 422)
            return
        apply_vehicle_assignment(db, vehicle, set_driver=False, driver_id=None, set_route=True, route_id=route_id)


def create_driver_account(
    db: Session,
    uyushma: Uyushma,
    phone: str,
    password: str,
    full_name: str,
    email: Optional[str],
    license_number: Optional[str],
) -> DriverProfile:
    if db.query(User.id).filter(User.phone == phone).first():
        raise FleetError("Bu telefon raqami bilan akkaunt allaqachon mavjud", 409)
    user = User(
        phone=phone,
        email=email,
        hashed_password=get_password_hash(password),
        full_name=full_name,
        role="driver",
        uyushma_id=uyushma.id,
        is_active=True,
    )
    db.add(user)
    db.flush()
    profile = DriverProfile(user_id=user.id, uyushma_id=uyushma.id, license_number=license_number, is_active=True)
    db.add(profile)
    db.flush()
    return profile


def vehicle_to_read(db: Session, v: Vehicle) -> VehicleRead:
    driver_name = v.driver.user.full_name if v.driver and v.driver.user else None
    return VehicleRead(
        id=v.id,
        internal_id=v.internal_id,
        uyushma_id=v.uyushma_id,
        plate_number=v.plate_number,
        model=v.model,
        color=v.color,
        vehicle_type=v.vehicle_type,
        nfc_tag_id=v.nfc_tag_id,
        capacity=v.capacity,
        is_active=v.is_active,
        route_id=v.route_id,
        route_number=v.route.route_number if v.route else None,
        driver_id=v.driver_id,
        driver_name=driver_name,
        is_on_shift=active_shift_for_vehicle(db, v.id) is not None,
        qr_payload=qr_payload(v),
        created_at=v.created_at,
    )


def active_shifts_for_drivers(db: Session, driver_ids: List[int]) -> Dict[int, DriverShift]:
    """One query for a whole page of drivers (the per-driver lookup was an N+1)."""
    if not driver_ids:
        return {}
    rows = (
        db.query(DriverShift)
        .filter(DriverShift.driver_id.in_(driver_ids), DriverShift.status == "active")
        .all()
    )
    return {row.driver_id: row for row in rows}


def driver_to_read(db: Session, dp: DriverProfile, shifts: Optional[Dict[int, DriverShift]] = None) -> DriverRead:
    vehicle = dp.vehicle
    shift = shifts.get(dp.id) if shifts is not None else active_shift_for_driver(db, dp.id)
    shift_brief = None
    if shift:
        state = tracking_service.get_state(shift.vehicle_id)
        shift_brief = ActiveShiftBrief(
            id=shift.id,
            started_at=shift.started_at,
            direction=shift.direction,
            is_online=bool(state and state.has_fix and not state.is_stale),
        )
    return DriverRead(
        id=dp.id,
        user_id=dp.user_id,
        uyushma_id=dp.uyushma_id,
        license_number=dp.license_number,
        is_active=dp.is_active and bool(dp.user and dp.user.is_active),
        full_name=dp.user.full_name if dp.user else "",
        phone=dp.user.phone if dp.user else "",
        email=dp.user.email if dp.user else None,
        vehicle_id=vehicle.id if vehicle else None,
        vehicle_internal_id=vehicle.internal_id if vehicle else None,
        vehicle_plate=vehicle.plate_number if vehicle else None,
        route_id=vehicle.route_id if vehicle else None,
        route_number=vehicle.route.route_number if vehicle and vehicle.route else None,
        active_shift=shift_brief,
        created_at=dp.created_at,
    )
