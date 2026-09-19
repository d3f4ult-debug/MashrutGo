import uuid
from datetime import datetime, timezone
import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import SessionLocal
from app.main import app
from app.models.shift import DriverShift, LocationSnapshot
from app.models.transport import Parking, Route, RouteDirection, RouteWaypoint, Vehicle
from app.models.user import DriverProfile, User, UserRole
from app.models.uyushma import Uyushma
from app.services.realtime.tracking_service import LiveVehicleState, tracking_service
from app.services.routing.eta_service import (
    eta_service,
    project_point_onto_polyline,
)


def test_map_matching_projection_geometry():
    """Verify that points project orthogonally onto polyline segments."""
    # Polyline from (40.7800, 72.3400) to (40.7800, 72.3500) - straight east ~840m
    polyline = [
        (40.7800, 72.3400),
        (40.7800, 72.3500),
    ]

    # Point mid-way, 50m north: (40.78045, 72.3450)
    along_dist, perp_dist, proj_lat, proj_lng = project_point_onto_polyline(
        40.78045, 72.3450, polyline
    )
    assert along_dist > 400.0 and along_dist < 450.0
    assert perp_dist > 40.0 and perp_dist < 60.0
    assert abs(proj_lat - 40.7800) < 0.0001
    assert abs(proj_lng - 72.3450) < 0.0001

    # Point before origin
    along_before, _, _, _ = project_point_onto_polyline(40.7800, 72.3390, polyline)
    assert along_before == 0.0


@pytest.fixture
def eta_test_setup():
    """Seed test route with waypoints, driver, vehicle, and direction."""
    db = SessionLocal()
    uid = uuid.uuid4().hex[:6]
    ts = int(datetime.now(timezone.utc).timestamp())
    try:
        uyushma = db.query(Uyushma).first()
        if not uyushma:
            uyushma = Uyushma(name="Andijon ETA Trans", code=f"UY-ETA-{uid}", phone="+998741117766")
            db.add(uyushma)
            db.commit()
            db.refresh(uyushma)

        route = Route(
            uyushma_id=uyushma.id,
            route_number=f"ETA-{uid}",
            name="Vokzal - Aeroport ETA Line",
            is_published=True,
        )
        db.add(route)
        db.commit()
        db.refresh(route)

        direction = RouteDirection(
            route_id=route.id,
            direction_type="outbound",
            origin_name="Vokzal",
            destination_name="Aeroport",
            origin_lat=40.7800,
            origin_lng=72.3400,
            destination_lat=40.7400,
            destination_lng=72.3000,
        )
        db.add(direction)
        db.commit()
        db.refresh(direction)

        # 3 sequential stops along route:
        # 1. Yangi Bozor (at ~1.5km)
        # 2. Kasalxona (at ~3.0km)
        # 3. Mashina Bozor (at ~4.5km)
        wp1 = RouteWaypoint(route_direction_id=direction.id, order=1, name="Yangi Bozor", lat=40.7700, lng=72.3300, is_stop=True)
        wp2 = RouteWaypoint(route_direction_id=direction.id, order=2, name="Kasalxona", lat=40.7600, lng=72.3200, is_stop=True)
        wp3 = RouteWaypoint(route_direction_id=direction.id, order=3, name="Mashina Bozor", lat=40.7500, lng=72.3100, is_stop=True)
        db.add_all([wp1, wp2, wp3])
        db.commit()

        # Driver & Vehicle
        driver_user = User(
            phone=f"+99894{uuid.uuid4().int % 10000000:07d}",
            hashed_password="hash",
            full_name="Haydovchi Jamshid",
            role=UserRole.DRIVER.value,
            uyushma_id=uyushma.id,
        )
        db.add(driver_user)
        db.commit()
        db.refresh(driver_user)

        driver_profile = DriverProfile(
            user_id=driver_user.id,
            uyushma_id=uyushma.id,
            license_number=f"ETA-DRV-{uid}",
        )
        db.add(driver_profile)
        db.commit()
        db.refresh(driver_profile)

        vehicle = Vehicle(
            internal_id=f"VEH-ETA-{uid}",
            uyushma_id=uyushma.id,
            driver_id=driver_profile.id,
            route_id=route.id,
            plate_number="60 777 CCC",
        )
        db.add(vehicle)
        db.commit()
        db.refresh(vehicle)

        # Parking
        parking = Parking(
            name=f"Vokzal Bosh Bekat {uid}",
            lat=40.7805,
            lng=72.3405,
            radius_meters=150,
            uyushma_id=uyushma.id,
        )
        db.add(parking)
        db.commit()
        db.refresh(parking)

        return {
            "route_id": route.id,
            "direction_id": direction.id,
            "vehicle_id": vehicle.id,
            "internal_id": vehicle.internal_id,
            "driver_id": driver_profile.id,
            "parking_id": parking.id,
            "wp1": {"lat": 40.7700, "lng": 72.3300, "name": "Yangi Bozor"},
            "wp2": {"lat": 40.7600, "lng": 72.3200, "name": "Kasalxona"},
            "wp3": {"lat": 40.7500, "lng": 72.3100, "name": "Mashina Bozor"},
        }
    finally:
        db.close()


def test_eta_approaching_vehicle(eta_test_setup):
    """
    When vehicle is upstream from stop (behind it),
    ETA is calculated with high confidence and valid minutes/seconds.
    """
    setup = eta_test_setup
    route_id = setup["route_id"]

    # Place live vehicle near origin (40.7750, 72.3350) approaching WP2 (Kasalxona at 40.7600, 72.3200)
    tracking_service._live_vehicles[setup["vehicle_id"]] = LiveVehicleStateResponse(
        vehicle_id=str(setup["vehicle_id"]),
        internal_id=setup["internal_id"],
        route_id=route_id,
        route_number="ETA-1",
        direction="outbound",
        lat=40.7750,
        lng=72.3350,
        speed_kmh=28.0,
        heading=220.0,
        accuracy_meters=4.0,
        captured_at=datetime.now(timezone.utc),
        is_stale=False,
        parking_id=None,
    )

    db = SessionLocal()
    res = eta_service.calculate_eta(
        route_id=route_id,
        direction_type="outbound",
        stop_lat=setup["wp2"]["lat"],
        stop_lng=setup["wp2"]["lng"],
        db=db,
        stop_name=setup["wp2"]["name"],
    )
    db.close()

    assert res.has_approaching_vehicle is True
    assert res.approaching_vehicle_id == setup["internal_id"]
    assert res.status == "approaching"
    assert res.eta_seconds > 0
    assert res.eta_minutes >= 1
    assert res.distance_meters > 1000
    assert res.confidence >= 0.90


def test_eta_vehicle_past_stop_returns_null_no_fake_eta(eta_test_setup):
    """
    When vehicle has ALREADY passed the stop, it must NOT return a fake ETA.
    Must return has_approaching_vehicle=False, eta=None, status='no_approaching_vehicle'.
    """
    setup = eta_test_setup
    route_id = setup["route_id"]

    # Place live vehicle downstream at WP3 (40.7500, 72.3100), past WP1 (40.7700, 72.3300)
    tracking_service._live_vehicles[setup["vehicle_id"]] = LiveVehicleStateResponse(
        vehicle_id=str(setup["vehicle_id"]),
        internal_id=setup["internal_id"],
        route_id=route_id,
        route_number="ETA-1",
        direction="outbound",
        lat=40.7480,
        lng=72.3080,
        speed_kmh=30.0,
        heading=220.0,
        accuracy_meters=3.0,
        captured_at=datetime.now(timezone.utc),
        is_stale=False,
        parking_id=None,
    )

    db = SessionLocal()
    # Check ETA to WP1 (which vehicle already passed)
    res = eta_service.calculate_eta(
        route_id=route_id,
        direction_type="outbound",
        stop_lat=setup["wp1"]["lat"],
        stop_lng=setup["wp1"]["lng"],
        db=db,
        stop_name=setup["wp1"]["name"],
    )
    db.close()

    # STRICT DATA INTEGRITY: NO FAKE ETA
    assert res.has_approaching_vehicle is False
    assert res.eta_seconds is None
    assert res.eta_minutes is None
    assert res.confidence == 0.0
    assert res.status == "no_approaching_vehicle"


def test_eta_vehicle_in_parking_includes_dwell(eta_test_setup):
    """
    When vehicle is in terminal parking, status is 'in_parking'
    and includes departure dwell time (~180s).
    """
    setup = eta_test_setup
    route_id = setup["route_id"]

    # Place vehicle in parking near origin
    tracking_service._live_vehicles[setup["vehicle_id"]] = LiveVehicleStateResponse(
        vehicle_id=str(setup["vehicle_id"]),
        internal_id=setup["internal_id"],
        route_id=route_id,
        route_number="ETA-1",
        direction="outbound",
        lat=40.7805,
        lng=72.3405,
        speed_kmh=0.0,
        heading=0.0,
        accuracy_meters=3.0,
        captured_at=datetime.now(timezone.utc),
        is_stale=False,
        parking_id=setup["parking_id"],
    )

    db = SessionLocal()
    res = eta_service.calculate_eta(
        route_id=route_id,
        direction_type="outbound",
        stop_lat=setup["wp1"]["lat"],
        stop_lng=setup["wp1"]["lng"],
        db=db,
    )
    db.close()

    assert res.has_approaching_vehicle is True
    assert res.status == "in_parking"
    assert res.eta_seconds >= 180  # Dwell time included
    assert res.confidence == 0.80


@pytest.mark.asyncio
async def test_public_eta_api_endpoint(eta_test_setup):
    """
    Verify GET /api/v1/routing/eta returns proper schema and HTTP 200.
    """
    setup = eta_test_setup
    route_id = setup["route_id"]

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        url = (
            f"/api/v1/routing/eta?route_id={route_id}&direction=outbound"
            f"&stop_lat={setup['wp1']['lat']}&stop_lng={setup['wp1']['lng']}"
        )
        res = await client.get(url)
        assert res.status_code == 200
        data = res.json()
        assert "has_approaching_vehicle" in data
        assert "confidence" in data
        assert "status" in data
