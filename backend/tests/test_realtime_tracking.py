import pytest
import uuid
from datetime import datetime, timedelta, timezone
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.db.session import SessionLocal
from app.core.roles import UserRole
from app.models.user import User, DriverProfile
from app.models.transport import Route, Vehicle, Parking
from app.models.uyushma import Uyushma
from app.services.realtime.tracking_service import tracking_service


@pytest.fixture
def driver_test_setup():
    """Seed test Uyushma, Route, Vehicle, Driver, and Parking."""
    db = SessionLocal()
    uid = uuid.uuid4().hex[:6]
    ts = int(datetime.now(timezone.utc).timestamp())
    try:
        # Uyushma
        uyushma = db.query(Uyushma).first()
        if not uyushma:
            uyushma = Uyushma(name="Shahar Avtotrans", code=f"UY-SH-{uid}", phone="+998741113344")
            db.add(uyushma)
            db.commit()
            db.refresh(uyushma)

        # Route
        route = Route(
            uyushma_id=uyushma.id,
            route_number=f"TR-{uid}",
            name="Vokzal — O'sh Ko'chasi",
            is_published=True,
        )
        db.add(route)
        db.commit()
        db.refresh(route)

        # Driver User & Profile
        import random
        rand_digits = random.randint(1000000, 9999999)
        phone = f"+99898{rand_digits}"
        driver_user = User(
            phone=phone,
            hashed_password="hash",
            full_name="Umid Haydovchi",
            role=UserRole.DRIVER.value,
            uyushma_id=uyushma.id,
        )
        db.add(driver_user)
        db.commit()
        db.refresh(driver_user)

        driver_profile = DriverProfile(
            user_id=driver_user.id,
            uyushma_id=uyushma.id,
            license_number="AA998877",
        )
        db.add(driver_profile)
        db.commit()
        db.refresh(driver_profile)

        # Vehicle assigned to this driver and route
        vehicle = Vehicle(
            internal_id=f"VEH-{uid}",
            uyushma_id=uyushma.id,
            driver_id=driver_profile.id,
            route_id=route.id,
            plate_number="60 123 BBB",
            model="Damas",
        )
        db.add(vehicle)
        db.commit()
        db.refresh(vehicle)

        # Parking lot at isolated coordinates radius 150m (unique coordinates per test run to avoid collision)
        p_lat = 41.2000 + (ts % 1000) * 0.005
        p_lng = 71.5000 + (ts % 1000) * 0.005
        parking = Parking(
            name=f"Vokzal Stayanka {uid}",
            lat=p_lat,
            lng=p_lng,
            radius_meters=150,
            uyushma_id=uyushma.id,
            is_active=True,
        )
        db.add(parking)
        db.commit()
        db.refresh(parking)

        # Generate Driver access token
        from app.core.security import create_access_token
        driver_token = create_access_token(
            subject=driver_user.id,
            role=driver_user.role,
            uyushma_id=uyushma.id,
        )

        return {
            "driver_user_id": driver_user.id,
            "driver_profile_id": driver_profile.id,
            "vehicle_id": vehicle.id,
            "internal_id": vehicle.internal_id,
            "route_id": route.id,
            "route_number": route.route_number,
            "parking_id": parking.id,
            "parking_lat": p_lat,
            "parking_lng": p_lng,
            "driver_token": driver_token,
            "headers": {"Authorization": f"Bearer {driver_token}"},
        }
    finally:
        db.close()


@pytest.mark.asyncio
async def test_driver_shift_lifecycle_and_gps_ingest(driver_test_setup):
    """
    Test shift start, single GPS ingest, live map verification,
    parking geofence detection, and shift end.
    """
    setup = driver_test_setup
    headers = setup["headers"]
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Start Shift
        start_res = await client.post(
            "/api/v1/driver/shift/start",
            json={"direction": "outbound"},
            headers=headers,
        )
        assert start_res.status_code == 201, start_res.text
        shift_data = start_res.json()
        assert shift_data["status"] == "active"
        assert shift_data["direction"] == "outbound"

        # Duplicate start must fail
        dup_start = await client.post(
            "/api/v1/driver/shift/start",
            json={"direction": "outbound"},
            headers=headers,
        )
        assert dup_start.status_code == 400

        # Get Current Shift
        curr_res = await client.get("/api/v1/driver/shift/current", headers=headers)
        assert curr_res.status_code == 200
        assert curr_res.json()["id"] == shift_data["id"]

        # 2. Single GPS fix INSIDE parking
        now_iso = datetime.now(timezone.utc).isoformat()
        gps_inside = {
            "lat": setup["parking_lat"],
            "lng": setup["parking_lng"],
            "speed_kmh": 0.0,
            "heading": 90.0,
            "accuracy_meters": 3.5,
            "captured_at": now_iso,
            "idempotency_key": f"gps_key_{uuid.uuid4().hex[:8]}",
        }
        gps_res = await client.post(
            "/api/v1/driver/gps/single",
            json=gps_inside,
            headers=headers,
        )
        assert gps_res.status_code == 200
        assert "snapshot_id" in gps_res.json()

        # Verify live vehicle query
        live_res = await client.get(f"/api/v1/driver/vehicles/live?route_id={setup['route_id']}")
        assert live_res.status_code == 200
        live_list = live_res.json()
        assert len(live_list) == 1
        live_veh = live_list[0]
        assert live_veh["vehicle_id"] == setup["internal_id"]
        assert live_veh["parking_id"] == setup["parking_id"]  # Parking geofence detected!

        # Verify parking vehicle count
        parkings_res = await client.get("/api/v1/parkings")
        assert parkings_res.status_code == 200
        p_match = next((p for p in parkings_res.json() if p["id"] == setup["parking_id"]), None)
        assert p_match is not None
        assert p_match["vehicle_count"] == 1

        # 3. GPS fix OUTSIDE parking (40.7600, 72.3600 ~ 3 km away)
        gps_outside = {
            "lat": 40.7600,
            "lng": 72.3600,
            "speed_kmh": 35.0,
            "heading": 180.0,
            "accuracy_meters": 4.0,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "idempotency_key": f"gps_key_{uuid.uuid4().hex[:8]}",
        }
        await client.post("/api/v1/driver/gps/single", json=gps_outside, headers=headers)

        # Parking count should drop to 0
        p_res2 = await client.get("/api/v1/parkings")
        p_match2 = next((p for p in p_res2.json() if p["id"] == setup["parking_id"]), None)
        assert p_match2["vehicle_count"] == 0

        # 4. End Shift
        end_res = await client.post("/api/v1/driver/shift/end", headers=headers)
        assert end_res.status_code == 200
        assert end_res.json()["status"] == "completed"

        # Live vehicles list should now be empty for this route
        live_after_end = await client.get(f"/api/v1/driver/vehicles/live?route_id={setup['route_id']}")
        assert len(live_after_end.json()) == 0


@pytest.mark.asyncio
async def test_offline_queued_gps_batch_sync(driver_test_setup):
    """Offline queued batch sync handles idempotency and chronological processing."""
    setup = driver_test_setup
    headers = setup["headers"]
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Start shift
        await client.post("/api/v1/driver/shift/start", json={"direction": "outbound"}, headers=headers)

        # Batch with 3 points
        now = datetime.now(timezone.utc)
        k1 = f"idem_{uuid.uuid4().hex[:8]}"
        k2 = f"idem_{uuid.uuid4().hex[:8]}"
        k3 = f"idem_{uuid.uuid4().hex[:8]}"

        batch_payload = {
            "batch_id": f"batch_{uuid.uuid4().hex[:6]}",
            "points": [
                {
                    "lat": 40.7800,
                    "lng": 72.3400,
                    "speed_kmh": 20.0,
                    "heading": 90.0,
                    "accuracy_meters": 5.0,
                    "captured_at": (now - timedelta(seconds=30)).isoformat(),
                    "idempotency_key": k1,
                },
                {
                    "lat": 40.7810,
                    "lng": 72.3410,
                    "speed_kmh": 25.0,
                    "heading": 90.0,
                    "accuracy_meters": 5.0,
                    "captured_at": (now - timedelta(seconds=20)).isoformat(),
                    "idempotency_key": k2,
                },
                {
                    "lat": 40.7820,
                    "lng": 72.3420,
                    "speed_kmh": 28.0,
                    "heading": 90.0,
                    "accuracy_meters": 4.0,
                    "captured_at": (now - timedelta(seconds=10)).isoformat(),
                    "idempotency_key": k3,
                },
            ],
        }

        res = await client.post("/api/v1/driver/gps/batch", json=batch_payload, headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["processed_count"] == 3
        assert data["duplicate_count"] == 0

        # Resend the same batch -> must be recognized as duplicate (idempotent)
        res_dup = await client.post("/api/v1/driver/gps/batch", json=batch_payload, headers=headers)
        assert res_dup.status_code == 200
        data_dup = res_dup.json()
        assert data_dup["processed_count"] == 0
        assert data_dup["duplicate_count"] == 3

        # Clean up shift
        await client.post("/api/v1/driver/shift/end", headers=headers)


@pytest.mark.asyncio
async def test_stale_vehicle_timeout(driver_test_setup):
    """Vehicles inactive beyond stale threshold are marked stale and excluded from active map."""
    setup = driver_test_setup
    headers = setup["headers"]
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Start shift
        await client.post("/api/v1/driver/shift/start", json={"direction": "outbound"}, headers=headers)

        # Ingest fresh GPS
        now_iso = datetime.now(timezone.utc).isoformat()
        await client.post(
            "/api/v1/driver/gps/single",
            json={
                "lat": 40.7821,
                "lng": 72.3442,
                "speed_kmh": 20.0,
                "heading": 100.0,
                "accuracy_meters": 4.0,
                "captured_at": now_iso,
            },
            headers=headers,
        )

        # Confirm vehicle is online
        live1 = await client.get(f"/api/v1/driver/vehicles/live?route_id={setup['route_id']}")
        assert len(live1.json()) == 1

        # Simulate time passing by manually aging captured_at by 60 seconds
        state = tracking_service._live_vehicles.get(setup["vehicle_id"])
        assert state is not None
        state.captured_at = datetime.now(timezone.utc) - timedelta(seconds=60)

        # Run stale detection sweeper
        stale_ids = await tracking_service.check_and_flag_stale_vehicles()
        assert setup["vehicle_id"] in stale_ids

        # Live vehicles query should now filter out the stale vehicle
        live2 = await client.get(f"/api/v1/driver/vehicles/live?route_id={setup['route_id']}")
        assert len(live2.json()) == 0

        # End shift
        await client.post("/api/v1/driver/shift/end", headers=headers)
