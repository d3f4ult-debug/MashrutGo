import pytest
from datetime import datetime, timezone
from sqlalchemy.exc import IntegrityError

from app.db.session import SessionLocal
from app.core.roles import UserRole
from app.core.security import get_password_hash
from app.models.user import User, ClientProfile, DriverProfile
from app.models.uyushma import Uyushma
from app.models.transport import Vehicle, Route, RouteDirection, RouteWaypoint, Parking
from app.models.shift import DriverShift, LocationSnapshot, ClientRouteWatch, ClientRideState
from app.models.finance import FareRule, Wallet, WalletTransaction, Payment, Refund, CashoutRequest
from app.models.system import Notification, SystemSetting, AuditLog


def test_domain_models_creation_and_relations():
    """Verify that all domain entities can be created, persisted, and queried."""
    db = SessionLocal()
    try:
        ts = int(datetime.now(timezone.utc).timestamp())
        # 1. Uyushma
        uyushma = Uyushma(
            name=f"Test Uyushma {ts}",
            code=f"UY-{ts}",
            phone="+998741112233",
            address="Test Address",
        )
        db.add(uyushma)
        db.commit()
        db.refresh(uyushma)
        assert uyushma.id is not None

        # 2. Users (Client, Driver, Super Admin)
        client_user = User(
            phone=f"+99890{ts % 10000000:07d}",
            hashed_password=get_password_hash("pass123"),
            full_name="Client Test",
            role=UserRole.CLIENT.value,
        )
        driver_user = User(
            phone=f"+99891{ts % 10000000:07d}",
            hashed_password=get_password_hash("pass123"),
            full_name="Driver Test",
            role=UserRole.DRIVER.value,
            uyushma_id=uyushma.id,
        )
        db.add_all([client_user, driver_user])
        db.commit()
        db.refresh(client_user)
        db.refresh(driver_user)

        # 3. ClientProfile & DriverProfile
        c_profile = ClientProfile(user_id=client_user.id, preferred_language="uz")
        d_profile = DriverProfile(user_id=driver_user.id, uyushma_id=uyushma.id, license_number="DRV-999")
        db.add_all([c_profile, d_profile])
        db.commit()

        # 4. Route
        route = Route(
            uyushma_id=uyushma.id,
            route_number=f"R-{ts % 1000}",
            name="Andijon - Asaka",
            is_published=True,
        )
        db.add(route)
        db.commit()
        db.refresh(route)

        # 5. Vehicle (1 driver -> 1 vehicle -> 1 route)
        vehicle = Vehicle(
            internal_id=f"INT-VEH-{ts}",
            uyushma_id=uyushma.id,
            driver_id=d_profile.id,
            route_id=route.id,
            plate_number="60 A 777 AA",
            model="Damas",
        )
        db.add(vehicle)
        db.commit()
        db.refresh(vehicle)
        assert vehicle.driver_id == d_profile.id

        # 6. RouteDirection & Waypoint
        direction = RouteDirection(
            route_id=route.id,
            direction_type="outbound",
            origin_name="A",
            destination_name="B",
            origin_lat=40.78,
            origin_lng=72.34,
            destination_lat=40.75,
            destination_lng=72.36,
        )
        db.add(direction)
        db.commit()
        db.refresh(direction)

        waypoint = RouteWaypoint(
            route_direction_id=direction.id,
            order=1,
            name="Stop 1",
            lat=40.77,
            lng=72.35,
        )
        db.add(waypoint)

        # 7. Parking
        parking = Parking(
            uyushma_id=uyushma.id,
            name="Markaziy Stayanka",
            lat=40.78,
            lng=72.34,
            radius_meters=100,
        )
        db.add(parking)

        # 8. Shift & LocationSnapshot
        shift = DriverShift(
            driver_id=d_profile.id,
            vehicle_id=vehicle.id,
            route_id=route.id,
            status="active",
        )
        db.add(shift)
        db.commit()
        db.refresh(shift)

        snapshot = LocationSnapshot(
            vehicle_id=vehicle.id,
            shift_id=shift.id,
            lat=40.781,
            lng=72.342,
            captured_at=datetime.now(timezone.utc),
            idempotency_key=f"idemp-{ts}",
        )
        db.add(snapshot)

        # 9. Client Watch & Ride State
        watch = ClientRouteWatch(
            client_session_id=f"sess-{ts}",
            user_id=client_user.id,
            route_id=route.id,
            direction="outbound",
            lat=40.78,
            lng=72.34,
            expires_at=datetime.now(timezone.utc),
        )
        ride = ClientRideState(
            client_session_id=f"sess-{ts}",
            user_id=client_user.id,
            route_id=route.id,
            state="waiting",
        )
        db.add_all([watch, ride])

        # 10. Fare, Wallet & Ledger
        fare = FareRule(uyushma_id=uyushma.id, route_id=route.id, base_fare_uzs=2500)
        wallet = Wallet(user_id=client_user.id, balance_uzs=10000)
        db.add_all([fare, wallet])
        db.commit()
        db.refresh(wallet)

        tx = WalletTransaction(
            wallet_id=wallet.id,
            entry_type="topup",
            amount_uzs=10000,
            balance_after_uzs=10000,
            description="Initial topup",
            idempotency_key=f"tx-{ts}",
        )
        payment = Payment(
            wallet_id=wallet.id,
            client_user_id=client_user.id,
            vehicle_id=vehicle.id,
            driver_id=d_profile.id,
            route_id=route.id,
            amount_uzs=2500,
            idempotency_key=f"pay-{ts}",
        )
        db.add_all([tx, payment])
        db.commit()
        db.refresh(payment)

        refund = Refund(
            payment_id=payment.id,
            driver_id=d_profile.id,
            amount_uzs=2500,
            reason="Mistake",
        )
        cashout = CashoutRequest(
            driver_id=d_profile.id,
            uyushma_id=uyushma.id,
            amount_uzs=50000,
        )
        db.add_all([refund, cashout])

        # 11. System models: Notification, SystemSetting, AuditLog
        notif = Notification(
            user_id=client_user.id,
            title="Welcome",
            body="Welcome to MashrutGo",
            notification_type="general",
        )
        setting = SystemSetting(
            key=f"custom_setting_{ts}",
            value="enabled",
        )
        audit = AuditLog(
            actor_user_id=client_user.id,
            action="test.action",
            target_type="test",
        )
        db.add_all([notif, setting, audit])
        db.commit()

        # Query all back and assert
        assert db.query(Vehicle).filter(Vehicle.id == vehicle.id).first() is not None
        assert db.query(DriverShift).filter(DriverShift.id == shift.id).first() is not None
        assert db.query(Payment).filter(Payment.id == payment.id).first() is not None
        assert db.query(AuditLog).filter(AuditLog.id == audit.id).first() is not None

    finally:
        db.close()


def test_unique_vehicle_internal_id_constraint():
    """Vehicle internal_id must be unique."""
    db = SessionLocal()
    try:
        uyushma = db.query(Uyushma).first()
        assert uyushma is not None

        ts = int(datetime.now(timezone.utc).timestamp())
        dup_id = f"DUP-INT-{ts}"

        v1 = Vehicle(internal_id=dup_id, uyushma_id=uyushma.id)
        db.add(v1)
        db.commit()

        v2 = Vehicle(internal_id=dup_id, uyushma_id=uyushma.id)
        db.add(v2)
        with pytest.raises(IntegrityError):
            db.commit()
    finally:
        db.rollback()
        db.close()
