import uuid
from datetime import datetime, timedelta, timezone
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.core.roles import UserRole
from app.models.shift import ClientRideState, ClientRouteWatch, DriverShift
from app.models.transport import Route, Vehicle
from app.models.user import DriverProfile, User
from app.models.uyushma import Uyushma
from app.services.realtime.client_watch_service import client_watch_service


@pytest.fixture
def watch_test_setup():
    """Seed test data for Route, Driver, and Uyushma."""
    db = SessionLocal()
    ts = int(datetime.now(timezone.utc).timestamp())
    uid = uuid.uuid4().hex[:6]
    try:
        # Uyushma
        uyushma = db.query(Uyushma).first()
        if not uyushma:
            uyushma = Uyushma(name="Andijon Yo'lovchi Trans", code=f"UY-CW-{uid}", phone="+998741118899")
            db.add(uyushma)
            db.commit()
            db.refresh(uyushma)

        # Route
        route = Route(
            uyushma_id=uyushma.id,
            route_number=f"CW-{uid}",
            name="Vokzal - Yangi Bozor",
            is_published=True,
        )
        db.add(route)
        db.commit()
        db.refresh(route)

        # Driver
        driver_user = User(
            phone=f"+99893{uuid.uuid4().int % 10000000:07d}",
            hashed_password="hash",
            full_name="Haydovchi Akmal",
            role=UserRole.DRIVER.value,
            uyushma_id=uyushma.id,
        )
        db.add(driver_user)
        db.commit()
        db.refresh(driver_user)

        driver_profile = DriverProfile(
            user_id=driver_user.id,
            uyushma_id=uyushma.id,
            license_number=f"DRV-{uid}",
        )
        db.add(driver_profile)
        db.commit()
        db.refresh(driver_profile)

        # Vehicle
        vehicle = Vehicle(
            internal_id=f"VEH-CW-{uid}",
            uyushma_id=uyushma.id,
            driver_id=driver_profile.id,
            route_id=route.id,
            plate_number="60 555 AAA",
        )
        db.add(vehicle)
        db.commit()
        db.refresh(vehicle)

        # Active Shift
        shift = DriverShift(
            driver_id=driver_profile.id,
            vehicle_id=vehicle.id,
            route_id=route.id,
            direction="outbound",
            status="active",
        )
        db.add(shift)
        db.commit()

        # Driver Token
        driver_token = create_access_token(
            subject=driver_user.id,
            role=driver_user.role,
            uyushma_id=uyushma.id,
        )

        return {
            "route_id": route.id,
            "driver_token": driver_token,
            "driver_headers": {"Authorization": f"Bearer {driver_token}"},
            "driver_id": driver_user.id,
        }
    finally:
        db.close()


@pytest.mark.asyncio
async def test_client_watch_start_and_heartbeat(watch_test_setup):
    """
    Test anonymous client starts watching a route direction,
    receives valid session & expiration, and sends heartbeat.
    """
    route_id = watch_test_setup["route_id"]
    client_session = f"client_sess_{uuid.uuid4().hex[:8]}"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Start Watch
        start_payload = {
            "route_id": route_id,
            "direction": "outbound",
            "lat": 40.7821,
            "lng": 72.3442,
            "accuracy_meters": 4.5,
            "session_id": client_session,
        }
        res = await client.post("/api/v1/client/watch/start", json=start_payload)
        assert res.status_code == 201, res.text
        data = res.json()
        watch_id = data["watch_id"]
        assert data["route_id"] == route_id
        assert data["status"] == "active"
        assert data["client_session_id"] == client_session

        # 2. Verify in DB
        db = SessionLocal()
        watch_db = db.query(ClientRouteWatch).filter(ClientRouteWatch.id == watch_id).first()
        assert watch_db is not None
        assert watch_db.status == "active"
        # Ride state initialized as waiting
        ride_db = (
            db.query(ClientRideState)
            .filter(ClientRideState.client_session_id == client_session)
            .first()
        )
        assert ride_db is not None
        assert ride_db.state == "waiting"
        first_expiry = watch_db.expires_at
        db.close()

        # 3. Send Heartbeat
        hb_payload = {
            "watch_id": watch_id,
            "lat": 40.7825,
            "lng": 72.3448,
        }
        hb_res = await client.post("/api/v1/client/watch/heartbeat", json=hb_payload)
        assert hb_res.status_code == 200
        hb_data = hb_res.json()
        assert hb_data["lat"] == 40.7825

        # Verify expiration extended in DB
        db2 = SessionLocal()
        watch_db2 = db2.query(ClientRouteWatch).filter(ClientRouteWatch.id == watch_id).first()
        assert watch_db2.expires_at >= first_expiry
        assert watch_db2.lat == 40.7825
        db2.close()


@pytest.mark.asyncio
async def test_ride_state_transitions_and_broadcast_revocation(watch_test_setup):
    """
    Test transitions:
    - 'waiting' -> 'on_car' ("Mashinadaman"): GPS broadcast immediately stops, active watch removed.
    - 'on_car' -> 'exited' ("Tushdim"): Ride completes.
    """
    route_id = watch_test_setup["route_id"]
    driver_headers = watch_test_setup["driver_headers"]
    client_session = f"client_sess_{uuid.uuid4().hex[:8]}"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Start Watch
        start_payload = {
            "route_id": route_id,
            "direction": "outbound",
            "lat": 40.7821,
            "lng": 72.3442,
            "session_id": client_session,
        }
        start_res = await client.post("/api/v1/client/watch/start", json=start_payload)
        assert start_res.status_code == 201
        watch_id = start_res.json()["watch_id"]

        # 2. Driver sees 1 waiting passenger
        drv_res = await client.get(
            f"/api/v1/driver/passengers/waiting?route_id={route_id}&direction=outbound",
            headers=driver_headers,
        )
        assert drv_res.status_code == 200
        passengers = drv_res.json()["passengers"]
        assert any(p["watch_id"] == watch_id for p in passengers)

        # 3. Passenger taps "Mashinadaman" (on_car)
        on_car_res = await client.post(
            "/api/v1/client/ride/state",
            json={"watch_id": watch_id, "state": "on_car"},
        )
        assert on_car_res.status_code == 200
        ride_data = on_car_res.json()
        assert ride_data["state"] == "on_car"
        assert ride_data["boarded_at"] is not None

        # 4. Driver queries waiting passengers again -> passenger is GONE (broadcast revoked!)
        drv_res2 = await client.get(
            f"/api/v1/driver/passengers/waiting?route_id={route_id}&direction=outbound",
            headers=driver_headers,
        )
        assert drv_res2.status_code == 200
        passengers2 = drv_res2.json()["passengers"]
        assert not any(p["watch_id"] == watch_id for p in passengers2)

        # 5. Check Current Ride
        curr_res = await client.get(f"/api/v1/client/ride/current?session_id={client_session}")
        assert curr_res.status_code == 200
        curr_data = curr_res.json()
        assert curr_data["active"] is True
        assert curr_data["ride_state"]["state"] == "on_car"

        # 6. Passenger taps "Tushdim" (exited)
        exited_res = await client.post(
            "/api/v1/client/ride/state",
            json={"watch_id": watch_id, "state": "exited"},
        )
        assert exited_res.status_code == 200
        exited_data = exited_res.json()
        assert exited_data["state"] == "exited"
        assert exited_data["exited_at"] is not None

        # Current ride is now finished
        curr_res2 = await client.get(f"/api/v1/client/ride/current?session_id={client_session}")
        assert curr_res2.status_code == 200
        assert curr_res2.json()["active"] is False


@pytest.mark.asyncio
async def test_watch_expiration_sweep(watch_test_setup):
    """
    Test that abandoned watch sessions without heartbeat
    are automatically marked expired and removed from driver visibility.
    """
    route_id = watch_test_setup["route_id"]
    driver_headers = watch_test_setup["driver_headers"]
    client_session = f"abandoned_{uuid.uuid4().hex[:8]}"

    db = SessionLocal()
    now = datetime.now(timezone.utc)
    # Create an abandoned watch whose expires_at is already in the past
    past_watch = ClientRouteWatch(
        client_session_id=client_session,
        route_id=route_id,
        direction="outbound",
        lat=40.7810,
        lng=72.3450,
        status="active",
        started_at=now - timedelta(seconds=120),
        last_heartbeat_at=now - timedelta(seconds=120),
        expires_at=now - timedelta(seconds=60),  # expired!
    )
    db.add(past_watch)
    db.commit()
    db.refresh(past_watch)
    watch_id = past_watch.id

    # Register in memory active watches
    client_watch_service._active_watches[watch_id] = {
        "watch_id": watch_id,
        "expires_at": past_watch.expires_at,
    }

    # Run sweeper
    expired_ids = await client_watch_service.sweep_expired_watches(db)
    assert watch_id in expired_ids

    # Verify status in DB
    db.refresh(past_watch)
    assert past_watch.status == "expired"
    assert watch_id not in client_watch_service._active_watches
    db.close()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        drv_res = await client.get(
            f"/api/v1/driver/passengers/waiting?route_id={route_id}",
            headers=driver_headers,
        )
        assert drv_res.status_code == 200
        assert not any(p["watch_id"] == watch_id for p in drv_res.json()["passengers"])
