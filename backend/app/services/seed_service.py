import logging
from sqlalchemy.orm import Session

from app.core.roles import UserRole
from app.core.security import get_password_hash
from app.models.user import User, DriverProfile, ClientProfile
from app.models.uyushma import Uyushma
from app.models.transport import Route, RouteDirection, RouteWaypoint, Vehicle, Parking
from app.models.finance import FareRule, Wallet, WalletTransaction

logger = logging.getLogger(__name__)


def seed_initial_data(db: Session) -> None:
    """Seed base administrative data and demo Andijon-style routes if not present."""
    # 1. Super Admin
    super_admin = db.query(User).filter(User.phone == "+998901234567").first()
    if not super_admin:
        super_admin = User(
            phone="+998901234567",
            hashed_password=get_password_hash("Adminkeldi1"),
            full_name="Super Administrator",
            role=UserRole.SUPER_ADMIN.value,
            is_active=True,
        )
        db.add(super_admin)
        db.commit()
        db.refresh(super_admin)
    else:
        super_admin.hashed_password = get_password_hash("Adminkeldi1")
        db.commit()

    # 2. Default Uyushma
    default_uyushma = db.query(Uyushma).filter(Uyushma.code == "AND-01").first()
    if not default_uyushma:
        default_uyushma = Uyushma(
            name="Andijon Shahar Yo'lovchi Tashish Uyushmasi",
            code="AND-01",
            phone="+998742230001",
            address="Andijon shahar, Navoiy shoh ko'chasi, 1",
            is_active=True,
        )
        db.add(default_uyushma)
        db.commit()
        db.refresh(default_uyushma)

        # Base Fare Rule for this Uyushma (2,500 UZS)
        base_fare = FareRule(
            uyushma_id=default_uyushma.id,
            rule_type="fixed",
            base_fare_uzs=2500,
            is_active=True,
        )
        db.add(base_fare)
        db.commit()

    # 3. Uyushma Admin User
    uyushma_admin = db.query(User).filter(User.phone == "+998901234568").first()
    if not uyushma_admin:
        uyushma_admin = User(
            phone="+998901234568",
            hashed_password=get_password_hash("uyushma123"),
            full_name="Andijon Avtotrans Dispetcher",
            role=UserRole.UYUSHMA_ADMIN.value,
            uyushma_id=default_uyushma.id,
            is_active=True,
        )
        db.add(uyushma_admin)
        db.commit()

    # 4. Demo Stayankas (Parkings in Andijon)
    parking1 = db.query(Parking).filter(Parking.name == "Yangi Bozor Stayanka").first()
    if not parking1:
        parking1 = Parking(
            uyushma_id=default_uyushma.id,
            name="Yangi Bozor Stayanka",
            lat=40.7821,
            lng=72.3442,
            radius_meters=120,
            capacity=15,
            is_active=True,
        )
        db.add(parking1)

    parking2 = db.query(Parking).filter(Parking.name == "Vokzal Stayanka").first()
    if not parking2:
        parking2 = Parking(
            uyushma_id=default_uyushma.id,
            name="Vokzal Stayanka",
            lat=40.7890,
            lng=72.3550,
            radius_meters=100,
            capacity=20,
            is_active=True,
        )
        db.add(parking2)
    db.commit()

    # 5. Demo Route 10: "Yangi Bozor - Eski Shahar"
    route_10 = (
        db.query(Route)
        .filter(Route.uyushma_id == default_uyushma.id, Route.route_number == "10")
        .first()
    )
    if not route_10:
        route_10 = Route(
            uyushma_id=default_uyushma.id,
            route_number="10",
            name="Yangi Bozor - Eski Shahar",
            description="Andijon markaziy 10-marshrut",
            is_published=True,
        )
        db.add(route_10)
        db.commit()
        db.refresh(route_10)

        # Fare rule for Route 10
        fare_10 = FareRule(
            uyushma_id=default_uyushma.id,
            route_id=route_10.id,
            rule_type="fixed",
            base_fare_uzs=2500,
            is_active=True,
        )
        db.add(fare_10)

        # Outbound direction
        dir_out = RouteDirection(
            route_id=route_10.id,
            direction_type="outbound",
            origin_name="Yangi Bozor",
            destination_name="Eski Shahar",
            origin_lat=40.7821,
            origin_lng=72.3442,
            destination_lat=40.7980,
            destination_lng=72.3680,
            distance_meters=3500,
            duration_seconds=720,
        )
        db.add(dir_out)
        db.commit()
        db.refresh(dir_out)

        # Waypoints for Outbound
        waypoints = [
            (1, "Yangi Bozor", 40.7821, 72.3442),
            (2, "Navoiy Shoh ko'chasi", 40.7850, 72.3490),
            (3, "Vokzal Maydoni", 40.7890, 72.3550),
            (4, "Bobur Bog'i", 40.7930, 72.3610),
            (5, "Eski Shahar", 40.7980, 72.3680),
        ]
        for order, name, lat, lng in waypoints:
            wp = RouteWaypoint(
                route_direction_id=dir_out.id,
                order=order,
                name=name,
                lat=lat,
                lng=lng,
                is_stop=True,
            )
            db.add(wp)
        db.commit()

    # 6. Demo Route 15: "Avtovokzal - Bog'ishamol"
    route_15 = (
        db.query(Route)
        .filter(Route.uyushma_id == default_uyushma.id, Route.route_number == "15")
        .first()
    )
    if not route_15:
        route_15 = Route(
            uyushma_id=default_uyushma.id,
            route_number="15",
            name="Avtovokzal - Bog'ishamol",
            description="Andijon 15-marshrut damas yo'nalishi",
            is_published=True,
        )
        db.add(route_15)
        db.commit()
        db.refresh(route_15)

        dir_15_out = RouteDirection(
            route_id=route_15.id,
            direction_type="outbound",
            origin_name="Avtovokzal",
            destination_name="Bog'ishamol",
            origin_lat=40.7750,
            origin_lng=72.3350,
            destination_lat=40.8120,
            destination_lng=72.3750,
            distance_meters=5200,
            duration_seconds=980,
        )
        db.add(dir_15_out)
        db.commit()
        db.refresh(dir_15_out)

        waypoints_15 = [
            (1, "Avtovokzal", 40.7750, 72.3350),
            (2, "Universitet", 40.7820, 72.3450),
            (3, "Viloyat Hokimiyati", 40.7890, 72.3560),
            (4, "Bog'ishamol dam olish maskani", 40.8120, 72.3750),
        ]
        for order, name, lat, lng in waypoints_15:
            db.add(RouteWaypoint(
                route_direction_id=dir_15_out.id,
                order=order,
                name=name,
                lat=lat,
                lng=lng,
                is_stop=True,
            ))
        db.commit()

    # 7. Demo Driver & Assigned Vehicle AND-101
    driver_user = db.query(User).filter(User.phone == "+998901234569").first()
    if not driver_user:
        driver_user = User(
            phone="+998901234569",
            hashed_password=get_password_hash("driver123"),
            full_name="Otabek Karimov",
            role=UserRole.DRIVER.value,
            uyushma_id=default_uyushma.id,
            is_active=True,
        )
        db.add(driver_user)
        db.commit()
        db.refresh(driver_user)

        driver_profile = DriverProfile(
            user_id=driver_user.id,
            uyushma_id=default_uyushma.id,
            license_number="AA-100293",
            is_active=True,
        )
        db.add(driver_profile)
        db.commit()
        db.refresh(driver_profile)

        # Driver Wallet
        db.add(Wallet(user_id=driver_user.id, balance_uzs=0))
        db.commit()

        # Vehicle AND-101 assigned to driver
        veh_101 = Vehicle(
            internal_id="AND-101",
            uyushma_id=default_uyushma.id,
            driver_id=driver_profile.id,
            route_id=route_10.id if route_10 else None,
            plate_number="60 101 AAA",
            model="Damas",
            capacity=7,
            is_active=True,
        )
        db.add(veh_101)
        db.commit()

    # Vehicle AND-102 (standby)
    veh_102 = db.query(Vehicle).filter(Vehicle.internal_id == "AND-102").first()
    if not veh_102:
        veh_102 = Vehicle(
            internal_id="AND-102",
            uyushma_id=default_uyushma.id,
            route_id=route_10.id if route_10 else None,
            plate_number="60 102 AAA",
            model="Damas",
            capacity=7,
            is_active=True,
        )
        db.add(veh_102)
        db.commit()

    # 8. Demo Client with starting balance (50,000 UZS) for testing
    client_user = db.query(User).filter(User.phone == "+998901234570").first()
    if not client_user:
        client_user = User(
            phone="+998901234570",
            hashed_password=get_password_hash("client123"),
            full_name="Dilnoza Rahimova",
            role=UserRole.CLIENT.value,
            is_active=True,
        )
        db.add(client_user)
        db.commit()
        db.refresh(client_user)

        db.add(ClientProfile(user_id=client_user.id, preferred_language="uz"))
        client_wallet = Wallet(user_id=client_user.id, balance_uzs=50000)
        db.add(client_wallet)
        db.commit()
        db.refresh(client_wallet)

        # Initial topup transaction in ledger
        db.add(WalletTransaction(
            wallet_id=client_wallet.id,
            entry_type="topup",
            amount_uzs=50000,
            balance_after_uzs=50000,
            reference_id="demo_seed_topup",
            description="Boshlang'ich test balansi",
            idempotency_key="demo_seed_topup_50k",
        ))
        db.commit()

    logger.info("Database initial demo seed data verified.")
