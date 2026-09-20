"""
Bootstrap and demo data.

- `seed_bootstrap_admin`: guarantees one Super Admin exists. Credentials come from
  BOOTSTRAP_ADMIN_PHONE / BOOTSTRAP_ADMIN_PASSWORD; development falls back to documented
  defaults, production refuses to invent a password.
- `seed_demo_data`: Andijon-style demo tenant (routes, stops, vehicles, drivers, stoyankas,
  tariff, a demo client). Enabled with SEED_DEMO_DATA=true; idempotent.
"""
import logging
import os
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.roles import UserRole
from app.core.security import get_password_hash
from app.models.finance import FareRule, Wallet
from app.models.transport import Parking, Route, RouteDirection, RouteWaypoint, Vehicle
from app.models.user import ClientProfile, DriverProfile, User
from app.models.uyushma import Uyushma
from app.services import ledger_service
from app.services.routing.base import BaseRoutingProvider, RoutingProviderError
from app.services.routing.providers import build_geodesic_route

logger = logging.getLogger(__name__)

DEV_ADMIN_PHONE = "+998901234567"
DEV_ADMIN_PASSWORD = "admin123"


def seed_bootstrap_admin(db: Session) -> Optional[User]:
    if db.query(User).filter(User.role == UserRole.SUPER_ADMIN.value).first():
        return None
    phone = os.getenv("BOOTSTRAP_ADMIN_PHONE") or (None if settings.is_production else DEV_ADMIN_PHONE)
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD") or (None if settings.is_production else DEV_ADMIN_PASSWORD)
    if not phone or not password:
        logger.error("No Super Admin exists. Set BOOTSTRAP_ADMIN_PHONE and BOOTSTRAP_ADMIN_PASSWORD to create one.")
        return None
    admin = User(phone=phone, hashed_password=get_password_hash(password), full_name="Super Administrator",
                 role=UserRole.SUPER_ADMIN.value, is_active=True)
    db.add(admin)
    db.commit()
    if password == DEV_ADMIN_PASSWORD:
        logger.warning("Development Super Admin created (%s / %s). Change it before any real deployment.", phone, password)
    return admin


# ------------------------------------------------------------------------------
# Demo tenant
# ------------------------------------------------------------------------------

Stop = Tuple[str, float, float]  # (name, lat, lng)


@dataclass
class DemoRoute:
    number: str
    name: str
    stops: Sequence[Stop]


# Approximate Andijon city points (demo data — operators refine them in the visual Route Editor)
DEMO_ROUTES: List[DemoRoute] = [
    DemoRoute("15", "Eski shahar — Yangi bozor", [
        ("Eski shahar", 40.7836, 72.3337),
        ("Bobur maydoni", 40.7829, 72.3442),
        ("Navoiy shoh ko'chasi", 40.7812, 72.3505),
        ("Andijon davlat universiteti", 40.7795, 72.3561),
        ("Yangi bozor", 40.7760, 72.3640),
    ]),
    DemoRoute("22", "Temir yo'l vokzali — Bog'ishamol", [
        ("Temir yo'l vokzali", 40.7702, 72.3469),
        ("Viloyat hokimligi", 40.7768, 72.3478),
        ("Bobur maydoni", 40.7829, 72.3442),
        ("Cho'lpon ko'chasi", 40.7890, 72.3415),
        ("Bog'ishamol", 40.7955, 72.3398),
    ]),
    DemoRoute("7", "Viloyat shifoxonasi — Avtovokzal", [
        ("Viloyat ko'p tarmoqli shifoxonasi", 40.7688, 72.3322),
        ("G'o'rxona", 40.7741, 72.3368),
        ("Eski shahar", 40.7836, 72.3337),
        ("Andijon avtovokzali", 40.7924, 72.3281),
    ]),
    DemoRoute("33", "Avtovokzal — Yangi bozor", [
        ("Andijon avtovokzali", 40.7924, 72.3281),
        ("Furqat ko'chasi", 40.7870, 72.3376),
        ("Bobur maydoni", 40.7829, 72.3442),
        ("Navro'z savdo majmuasi", 40.7788, 72.3529),
        ("Yangi bozor", 40.7760, 72.3640),
    ]),
]

DEMO_PARKINGS = [
    ("Yangi bozor stoyankasi", 40.7760, 72.3640, 150, 20),
    ("Andijon avtovokzali stoyankasi", 40.7924, 72.3281, 150, 25),
    ("Eski shahar stoyankasi", 40.7836, 72.3337, 120, 15),
]


async def _geometry(stops: Sequence[Stop], provider: Optional[BaseRoutingProvider]):
    coords = [(lat, lng) for _, lat, lng in stops]
    if provider is not None:
        try:
            return await provider.calculate_route(coords, profile="driving")
        except (RoutingProviderError, ValueError) as exc:
            logger.info("Demo seed: routing provider unavailable (%s); using geodesic geometry", exc)
    return build_geodesic_route(coords)


async def _add_direction(db: Session, route: Route, direction_type: str, stops: Sequence[Stop], provider) -> None:
    geo = await _geometry(stops, provider)
    direction = RouteDirection(
        route_id=route.id, direction_type=direction_type,
        origin_name=stops[0][0], origin_lat=stops[0][1], origin_lng=stops[0][2],
        destination_name=stops[-1][0], destination_lat=stops[-1][1], destination_lng=stops[-1][2],
        polyline=geo.polyline, distance_meters=geo.distance_meters, duration_seconds=geo.duration_seconds,
    )
    db.add(direction)
    db.flush()
    for order, (name, lat, lng) in enumerate(stops[1:-1], start=1):
        db.add(RouteWaypoint(route_direction_id=direction.id, order=order, name=name, lat=lat, lng=lng, is_stop=True))


def _user(db: Session, phone: str, password: str, full_name: str, role: str, uyushma_id: Optional[int] = None) -> User:
    user = db.query(User).filter(User.phone == phone).first()
    if user:
        return user
    user = User(phone=phone, hashed_password=get_password_hash(password), full_name=full_name, role=role,
                uyushma_id=uyushma_id, is_active=True)
    db.add(user)
    db.flush()
    return user


async def seed_demo_data(db: Session, provider: Optional[BaseRoutingProvider] = None) -> None:
    uyushma = db.query(Uyushma).filter(Uyushma.code == "AND-01").first()
    if uyushma is None:
        uyushma = Uyushma(
            name="Andijon Shahar Yo'lovchi Tashish Uyushmasi", code="AND-01", phone="+998742230001",
            address="Andijon shahri, Navoiy shoh ko'chasi, 1", region="Andijon viloyati, Andijon shahri",
            contact_person="Dispetcherlik markazi", is_active=True,
        )
        db.add(uyushma)
        db.flush()
        db.add(FareRule(uyushma_id=uyushma.id, name="Standart shahar tarifi", rule_type="fixed",
                        base_fare_uzs=2500, is_active=True, description="Shahar ichidagi barcha yo'nalishlar"))

    _user(db, "+998901234568", "uyushma123", "Andijon Avtotrans Dispetcher", UserRole.UYUSHMA_ADMIN.value, uyushma.id)

    for demo in DEMO_ROUTES:
        route = db.query(Route).filter(Route.uyushma_id == uyushma.id, Route.route_number == demo.number).first()
        if route is not None:
            continue
        route = Route(uyushma_id=uyushma.id, route_number=demo.number, name=demo.name, is_published=True,
                      description="Demo yo'nalish (Route Editor orqali aniqlashtiring)")
        db.add(route)
        db.flush()
        await _add_direction(db, route, "outbound", demo.stops, provider)
        await _add_direction(db, route, "inbound", list(reversed(demo.stops)), provider)

    for name, lat, lng, radius, capacity in DEMO_PARKINGS:
        if not db.query(Parking.id).filter(Parking.name == name).first():
            db.add(Parking(uyushma_id=uyushma.id, name=name, lat=lat, lng=lng, radius_meters=radius, capacity=capacity))
    db.flush()

    drivers = [
        ("+998901110001", "Otabek Karimov", "15", "60 A 101 AA", "Damas"),
        ("+998901110002", "Dilshod Tursunov", "15", "60 A 102 AA", "Damas"),
        ("+998901110003", "Bobur Mirzayev", "22", "60 B 201 BA", "Gazel"),
        ("+998901110004", "Sherzod Aliyev", "33", "60 C 301 CA", "Isuzu"),
    ]
    for idx, (phone, name, route_number, plate, model) in enumerate(drivers, start=1):
        user = _user(db, phone, "driver123", name, UserRole.DRIVER.value, uyushma.id)
        profile = db.query(DriverProfile).filter(DriverProfile.user_id == user.id).first()
        if profile is None:
            profile = DriverProfile(user_id=user.id, uyushma_id=uyushma.id, license_number=f"AF{1000000 + idx}")
            db.add(profile)
            db.flush()
        internal_id = f"AND01-V{idx:04d}"
        if not db.query(Vehicle.id).filter(Vehicle.internal_id == internal_id).first():
            route = db.query(Route).filter(Route.uyushma_id == uyushma.id, Route.route_number == route_number).first()
            db.add(Vehicle(internal_id=internal_id, uyushma_id=uyushma.id, driver_id=profile.id,
                           route_id=route.id if route else None, plate_number=plate, model=model,
                           vehicle_type=model.lower() if model.lower() in ("damas", "gazel", "isuzu") else "other",
                           color="Oq", capacity=7 if model == "Damas" else 15))
        ledger_service.get_or_create_wallet(db, user)

    client = _user(db, "+998901112233", "client123", "Demo Yo'lovchi", UserRole.CLIENT.value)
    if not db.query(ClientProfile.id).filter(ClientProfile.user_id == client.id).first():
        db.add(ClientProfile(user_id=client.id, preferred_language="uz"))
    wallet = ledger_service.get_or_create_wallet(db, client)
    ledger_service.post_entry(db, wallet, entry_type="adjustment", amount_uzs=50_000,
                              description="Demo boshlang'ich balans", idempotency_key="seed:demo-client:initial-balance",
                              reference_type="admin", reference_id="seed")
    db.commit()
    logger.info("Demo data ready: uyushma=%s routes=%s", uyushma.code, len(DEMO_ROUTES))


def ensure_wallets(db: Session) -> None:
    """Every client/driver has a wallet (older rows created before wallets were introduced)."""
    users = (
        db.query(User)
        .outerjoin(Wallet, Wallet.user_id == User.id)
        .filter(Wallet.id.is_(None), User.role.in_((UserRole.CLIENT.value, UserRole.DRIVER.value)))
        .all()
    )
    for user in users:
        db.add(Wallet(user_id=user.id, balance_uzs=0, currency="UZS", is_active=True))
    if users:
        db.commit()
