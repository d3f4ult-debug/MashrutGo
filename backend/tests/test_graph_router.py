import pytest
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.db.session import SessionLocal
from app.core.roles import UserRole
from app.models.user import User, DriverProfile
from app.models.transport import Route, RouteDirection, RouteWaypoint, Vehicle
from app.models.shift import DriverShift
from app.models.finance import FareRule
from app.models.uyushma import Uyushma


@pytest.fixture
def setup_routing_data():
    """Seed test routes in Andijon for routing engine verification."""
    db = SessionLocal()
    import uuid
    uid = uuid.uuid4().hex[:6]
    ts = int(datetime.now(timezone.utc).timestamp())
    try:
        # 1. Uyushma
        uyushma = db.query(Uyushma).first()
        if not uyushma:
            uyushma = Uyushma(name="Andijon Trans", code=f"UY-ROUT-{uid}", phone="+998741112233")
            db.add(uyushma)
            db.commit()
            db.refresh(uyushma)

        # 2. Route 1: Vokzal -> Yangi Bozor -> Eski Shahar
        r1 = Route(
            uyushma_id=uyushma.id,
            route_number=f"R1-{uid}",
            name="Vokzal — Eski Shahar",
            is_published=True,
        )
        db.add(r1)
        db.commit()
        db.refresh(r1)

        d1 = RouteDirection(
            route_id=r1.id,
            direction_type="outbound",
            origin_name="Andijon Vokzali",
            destination_name="Eski Shahar Markazi",
            origin_lat=40.7821,
            origin_lng=72.3442,
            destination_lat=40.7554,
            destination_lng=72.3610,
            distance_meters=4500,
            duration_seconds=600,
        )
        db.add(d1)
        db.commit()
        db.refresh(d1)

        wp1 = RouteWaypoint(
            route_direction_id=d1.id,
            order=1,
            name="Yangi Bozor",
            lat=40.7712,
            lng=72.3501,
            is_stop=True,
        )
        db.add(wp1)

        f1 = FareRule(uyushma_id=uyushma.id, route_id=r1.id, base_fare_uzs=2500)
        db.add(f1)

        # 3. Route 2: Eski Shahar -> Bog'ishamol -> Asaka
        r2 = Route(
            uyushma_id=uyushma.id,
            route_number=f"R2-{uid}",
            name="Eski Shahar — Asaka",
            is_published=True,
        )
        db.add(r2)
        db.commit()
        db.refresh(r2)

        d2 = RouteDirection(
            route_id=r2.id,
            direction_type="outbound",
            origin_name="Eski Shahar Markazi",
            destination_name="Asaka Avtovokzal",
            origin_lat=40.7554,
            origin_lng=72.3610,
            destination_lat=40.6415,
            destination_lng=72.2389,
            distance_meters=16000,
            duration_seconds=1800,
        )
        db.add(d2)
        db.commit()
        db.refresh(d2)

        wp2 = RouteWaypoint(
            route_direction_id=d2.id,
            order=1,
            name="Bog'ishamol bog'i",
            lat=40.7200,
            lng=72.3200,
            is_stop=True,
        )
        db.add(wp2)

        f2 = FareRule(uyushma_id=uyushma.id, route_id=r2.id, base_fare_uzs=3000)
        db.add(f2)
        db.commit()

        r1_id = r1.id
        r2_id = r2.id
        uyushma_id = uyushma.id

        return {
            "r1_id": r1_id,
            "r2_id": r2_id,
            "uyushma_id": uyushma_id,
        }
    finally:
        db.close()


@pytest.mark.asyncio
async def test_graph_router_walking_only_baseline(setup_routing_data):
    """Direct walking-only itinerary is always generated as valid 0 UZS option."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        req = {
            "origin": {"lat": 40.7820, "lng": 72.3440, "name": "Vokzal yonida"},
            "destination": {"lat": 40.7850, "lng": 72.3480, "name": "Yaqin joy"},
            "preferences": {"mode": "fastest"},
        }
        res = await client.post("/api/v1/routing/search", json=req)
        assert res.status_code == 200, res.text
        data = res.json()

        assert "recommended" in data
        assert "itineraries" in data
        assert len(data["itineraries"]) >= 1

        # Check walking itinerary
        walking_itin = next((it for it in data["itineraries"] if it["transit_duration_minutes"] == 0), None)
        assert walking_itin is not None
        assert walking_itin["total_fare_uzs"] == 0
        assert walking_itin["transfers_count"] == 0
        assert len(walking_itin["legs"]) == 1
        assert walking_itin["legs"][0]["leg_type"] == "walking"


@pytest.mark.asyncio
async def test_graph_router_direct_transit_and_live_status(setup_routing_data):
    """
    Direct transit is found without suppression.
    When no car is online -> status is 'no_online_vehicle_visible'.
    When shift is active -> status changes to 'online_vehicles_visible'.
    """
    r1_id = setup_routing_data["r1_id"]
    uyushma_id = setup_routing_data["uyushma_id"]

    # Ensure no active shifts exist for r1_id before testing offline status
    db_clean = SessionLocal()
    db_clean.query(DriverShift).filter(DriverShift.route_id == r1_id).delete()
    db_clean.commit()
    db_clean.close()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Search from near Vokzal to near Eski Shahar
        req = {
            "origin": {"lat": 40.7821, "lng": 72.3442, "name": "Vokzal"},
            "destination": {"lat": 40.7554, "lng": 72.3610, "name": "Eski Shahar"},
            "preferences": {"mode": "fastest"},
        }
        res = await client.post("/api/v1/routing/search", json=req)
        assert res.status_code == 200
        data = res.json()

        # Find direct transit candidate for R1 specifically
        transit_itin = next(
            (it for it in data["itineraries"]
             if it["transfers_count"] == 0 and len(it["legs"]) >= 2 and it["legs"][1].get("route_id") == r1_id),
            None,
        )
        assert transit_itin is not None
        assert transit_itin["total_fare_uzs"] == 2500
        assert transit_itin["live_status"] == "no_online_vehicle_visible"  # Not hidden!
        assert len(transit_itin["legs"]) == 3  # Walk -> Transit -> Walk

        # Now start an active shift for R1
        db = SessionLocal()
        ts = int(datetime.now(timezone.utc).timestamp())
        driver_user = User(
            phone=f"+99897{ts % 10000000:07d}",
            hashed_password="hash",
            full_name="Haydovchi 1",
            role=UserRole.DRIVER.value,
            uyushma_id=uyushma_id,
        )
        db.add(driver_user)
        db.commit()

        d_prof = DriverProfile(user_id=driver_user.id, uyushma_id=uyushma_id)
        db.add(d_prof)
        db.commit()

        veh = Vehicle(internal_id=f"LIVE-VEH-{ts}", uyushma_id=uyushma_id)
        db.add(veh)
        db.commit()

        shift = DriverShift(
            driver_id=d_prof.id,
            vehicle_id=veh.id,
            route_id=r1_id,
            status="active",
        )
        db.add(shift)
        db.commit()
        db.close()

        # Search again -> should now reflect online vehicle!
        res2 = await client.post("/api/v1/routing/search", json=req)
        assert res2.status_code == 200
        data2 = res2.json()

        transit_itin2 = next(
            (it for it in data2["itineraries"]
             if it["transfers_count"] == 0 and len(it["legs"]) >= 2 and it["legs"][1].get("route_id") == r1_id),
            None,
        )
        assert transit_itin2 is not None
        assert transit_itin2["live_status"] == "online_vehicles_visible"
        assert transit_itin2["live_confidence"] >= 0.90


@pytest.mark.asyncio
async def test_graph_router_transfer_route_and_multi_criteria(setup_routing_data):
    """
    Search across entire city produces:
    - 1-transfer itinerary connecting R1 and R2
    - Multi-criteria recommendations for fastest, cheapest, least_walking, and least_transfers
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Search from Vokzal to Asaka
        req = {
            "origin": {"lat": 40.7821, "lng": 72.3442, "name": "Vokzal"},
            "destination": {"lat": 40.6415, "lng": 72.2389, "name": "Asaka"},
            "preferences": {"mode": "fastest"},
        }
        res = await client.post("/api/v1/routing/search", json=req)
        assert res.status_code == 200
        data = res.json()

        # Check recommended categories
        rec = data["recommended"]
        assert "fastest" in rec
        assert "cheapest" in rec
        assert "least_walking" in rec
        assert "least_transfers" in rec

        # Cheapest should be walking-only (0 UZS)
        assert rec["cheapest"]["total_fare_uzs"] == 0

        # Transfer itinerary should exist connecting R1 -> R2
        xfer_itin = next((it for it in data["itineraries"] if it["transfers_count"] == 1), None)
        assert xfer_itin is not None
        assert len(xfer_itin["legs"]) == 5  # Walk -> R1 -> Walk transfer -> R2 -> Walk
        assert xfer_itin["total_fare_uzs"] == 2500 + 3000  # R1 fare + R2 fare = 5500 UZS
