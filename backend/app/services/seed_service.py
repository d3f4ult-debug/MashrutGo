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

    # 5. Seed Real Andijon Transit & Marshrutka Routes (SHI-1, SHI-4, SHI-75, SHI-222, 7, YT-40, 44, Asaka, etc.)
    import os
    import json

    json_path = os.path.join(os.path.dirname(__file__), "..", "data", "andijon_real_routes.json")
    first_route_id = None
    if os.path.exists(json_path):
        with open(json_path, "r", encoding="utf-8") as f:
            real_routes = json.load(f)

        for r_data in real_routes:
            existing = (
                db.query(Route)
                .filter(Route.uyushma_id == default_uyushma.id, Route.route_number == r_data["route_number"])
                .first()
            )
            if not existing:
                new_route = Route(
                    uyushma_id=default_uyushma.id,
                    route_number=r_data["route_number"],
                    name=r_data["route_name"],
                    description=r_data["description"],
                    is_published=True,
                )
                db.add(new_route)
                db.commit()
                db.refresh(new_route)

                if first_route_id is None:
                    first_route_id = new_route.id

                # Fare rule
                fare_rule = FareRule(
                    uyushma_id=default_uyushma.id,
                    route_id=new_route.id,
                    rule_type="fixed",
                    base_fare_uzs=3000 if r_data.get("type") == "suburban" else 2000,
                    is_active=True,
                )
                db.add(fare_rule)

                # Outbound direction
                outbound_data = r_data["outbound"]
                out_coords = outbound_data["geometry"]["coordinates"]
                dir_out = RouteDirection(
                    route_id=new_route.id,
                    direction_type="outbound",
                    origin_name=outbound_data["startPoint"]["name"],
                    destination_name=outbound_data["endPoint"]["name"],
                    origin_lat=out_coords[0][1],
                    origin_lng=out_coords[0][0],
                    destination_lat=out_coords[-1][1],
                    destination_lng=out_coords[-1][0],
                    polyline=json.dumps(outbound_data["geometry"]),
                    distance_meters=int(outbound_data["distanceKm"] * 1000),
                    duration_seconds=int(outbound_data["durationMin"] * 60),
                )
                db.add(dir_out)

                # Inbound direction
                inbound_data = r_data["inbound"]
                in_coords = inbound_data["geometry"]["coordinates"]
                dir_in = RouteDirection(
                    route_id=new_route.id,
                    direction_type="inbound",
                    origin_name=inbound_data["startPoint"]["name"],
                    destination_name=inbound_data["endPoint"]["name"],
                    origin_lat=in_coords[0][1],
                    origin_lng=in_coords[0][0],
                    destination_lat=in_coords[-1][1],
                    destination_lng=in_coords[-1][0],
                    polyline=json.dumps(inbound_data["geometry"]),
                    distance_meters=int(inbound_data["distanceKm"] * 1000),
                    duration_seconds=int(inbound_data["durationMin"] * 60),
                )
                db.add(dir_in)
                db.commit()
            elif first_route_id is None:
                first_route_id = existing.id

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
            route_id=first_route_id,
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
            route_id=first_route_id,
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
