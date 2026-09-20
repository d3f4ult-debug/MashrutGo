"""Small data builders shared by the test-suite (each call creates unique, isolated records)."""
import itertools
import json
import uuid
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from app.core.security import create_access_token, get_password_hash
from app.models.finance import FareRule
from app.models.transport import Parking, Route, RouteDirection, RouteWaypoint, Vehicle
from app.models.user import ClientProfile, DriverProfile, User
from app.models.uyushma import Uyushma
from app.services import ledger_service
from app.services.realtime.tracking_service import tracking_service

_phone_counter = itertools.count(uuid.uuid4().int % 8_000_000)
PASSWORD = "secret-pass-1"

# A straight west->east line through Andijon with 3 intermediate stops
LINE_STOPS: List[Tuple[str, float, float]] = [
    ("A bekat", 40.7800, 72.3300),
    ("B bekat", 40.7800, 72.3400),
    ("C bekat", 40.7800, 72.3500),
    ("D bekat", 40.7800, 72.3600),
    ("E bekat", 40.7800, 72.3700),
]


def unique_phone() -> str:
    return f"+99897{next(_phone_counter) % 10_000_000:07d}"


def auth(user: User) -> Dict[str, str]:
    token = create_access_token(subject=user.id, role=user.role, uyushma_id=user.uyushma_id)
    return {"Authorization": f"Bearer {token}"}


def make_uyushma(db: Session, name: str = "Test Uyushma") -> Uyushma:
    u = Uyushma(name=name, code=f"T-{uuid.uuid4().hex[:8].upper()}", phone="+998742000000")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def make_user(db: Session, role: str, uyushma_id: Optional[int] = None, password: str = PASSWORD, name: str = "Test User") -> User:
    user = User(phone=unique_phone(), hashed_password=get_password_hash(password), full_name=name, role=role,
                uyushma_id=uyushma_id, is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    if role == "client":
        db.add(ClientProfile(user_id=user.id))
        ledger_service.get_or_create_wallet(db, user)
        db.commit()
    return user


def super_admin(db: Session) -> User:
    return db.query(User).filter(User.role == "super_admin").first()


def make_route(
    db: Session,
    uyushma: Uyushma,
    stops: Sequence[Tuple[str, float, float]] = LINE_STOPS,
    published: bool = True,
    number: Optional[str] = None,
) -> Route:
    route = Route(uyushma_id=uyushma.id, route_number=number or uuid.uuid4().hex[:5].upper(), name="Test yo'nalish",
                  is_published=published)
    db.add(route)
    db.flush()
    for direction_type, seq in (("outbound", list(stops)), ("inbound", list(reversed(stops)))):
        geo = {"type": "LineString", "coordinates": [[lng, lat] for _, lat, lng in seq]}
        d = RouteDirection(route_id=route.id, direction_type=direction_type,
                           origin_name=seq[0][0], origin_lat=seq[0][1], origin_lng=seq[0][2],
                           destination_name=seq[-1][0], destination_lat=seq[-1][1], destination_lng=seq[-1][2],
                           polyline=json.dumps(geo), distance_meters=3400, duration_seconds=600)
        db.add(d)
        db.flush()
        for order, (name, lat, lng) in enumerate(seq[1:-1], start=1):
            db.add(RouteWaypoint(route_direction_id=d.id, order=order, name=name, lat=lat, lng=lng))
    db.commit()
    db.refresh(route)
    return route


def make_fare(db: Session, uyushma: Uyushma, amount: int = 2500, route_id: Optional[int] = None, **kw) -> FareRule:
    rule = FareRule(uyushma_id=uyushma.id, route_id=route_id, name=kw.pop("name", "Standart"), base_fare_uzs=amount, **kw)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def make_driver(db: Session, uyushma: Uyushma, route: Optional[Route] = None, with_vehicle: bool = True) -> Tuple[User, DriverProfile, Optional[Vehicle]]:
    user = make_user(db, "driver", uyushma.id, name="Haydovchi Test")
    profile = DriverProfile(user_id=user.id, uyushma_id=uyushma.id)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    vehicle = None
    if with_vehicle:
        vehicle = Vehicle(internal_id=f"TV-{uuid.uuid4().hex[:8].upper()}", uyushma_id=uyushma.id, driver_id=profile.id,
                          route_id=route.id if route else None, plate_number=f"60 T {uuid.uuid4().int % 900 + 100} TA")
        db.add(vehicle)
        db.commit()
        db.refresh(vehicle)
    ledger_service.get_or_create_wallet(db, user)
    db.commit()
    return user, profile, vehicle


def fund_client(db: Session, client: User, amount: int) -> None:
    wallet = ledger_service.get_or_create_wallet(db, client)
    ledger_service.post_entry(db, wallet, "adjustment", amount, "test funding", f"test-fund:{uuid.uuid4().hex}")
    db.commit()


def make_parking(db: Session, uyushma: Uyushma, lat: float, lng: float, radius: int = 150) -> Parking:
    p = Parking(uyushma_id=uyushma.id, name=f"Stoyanka {uuid.uuid4().hex[:4]}", lat=lat, lng=lng, radius_meters=radius)
    db.add(p)
    db.commit()
    db.refresh(p)
    # The geofence list is cached in the tracking service; API routes invalidate it, direct
    # inserts (like this factory) must do it themselves.
    tracking_service.invalidate_parking_cache()
    return p
