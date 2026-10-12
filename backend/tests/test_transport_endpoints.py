import uuid
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.roles import UserRole
from app.core.security import create_access_token, get_password_hash
from app.db.session import SessionLocal
from app.main import app
from app.models.finance import FareRule, Wallet
from app.models.transport import Route, Vehicle
from app.models.user import DriverProfile, User, ClientProfile
from app.models.uyushma import Uyushma


@pytest.fixture
def transport_api_setup():
    db = SessionLocal()
    uid = uuid.uuid4().hex[:6]

    # 1. Uyushma
    uyushma = Uyushma(
        name=f"Uyushma {uid}",
        code=f"U-{uid}",
        phone=f"+99890{uid[:7]}",
        is_active=True,
    )
    db.add(uyushma)
    db.commit()
    db.refresh(uyushma)

    # 2. Route
    route = Route(
        uyushma_id=uyushma.id,
        route_number=f"7{uid[:2]}",
        name="Vokzal - Bozor",
        is_published=True,
    )
    db.add(route)
    db.commit()
    db.refresh(route)

    # Fare rule
    db.add(FareRule(
        uyushma_id=uyushma.id,
        route_id=route.id,
        rule_type="fixed",
        base_fare_uzs=2000,
        is_active=True,
    ))
    db.commit()

    # 3. Driver
    drv_user = User(
        phone=f"+99891{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Haydovchi Shuxrat",
        role=UserRole.DRIVER.value,
        uyushma_id=uyushma.id,
        is_active=True,
    )
    db.add(drv_user)
    db.commit()
    db.refresh(drv_user)

    drv_prof = DriverProfile(
        user_id=drv_user.id,
        uyushma_id=uyushma.id,
        license_number=f"LIC-{uid}",
        is_active=True,
    )
    db.add(drv_prof)
    db.commit()
    db.refresh(drv_prof)

    db.add(Wallet(user_id=drv_user.id, balance_uzs=0))
    db.commit()

    # 4. Vehicle
    internal_id = f"VEH-T-{uid}"
    veh = Vehicle(
        internal_id=internal_id,
        uyushma_id=uyushma.id,
        driver_id=drv_prof.id,
        route_id=route.id,
        plate_number=f"60 {uid[:3].upper()} BBB",
        model="Damas",
        is_active=True,
    )
    db.add(veh)
    db.commit()
    db.refresh(veh)

    # 5. Client
    client_user = User(
        phone=f"+99897{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Mijoz Madina",
        role=UserRole.CLIENT.value,
        is_active=True,
    )
    db.add(client_user)
    db.commit()
    db.refresh(client_user)

    db.add(ClientProfile(user_id=client_user.id, preferred_language="uz"))
    client_wallet = Wallet(user_id=client_user.id, balance_uzs=20000)
    db.add(client_wallet)
    db.commit()

    client_token = create_access_token(subject=client_user.id, role=client_user.role)

    data = {
        "client_id": client_user.id,
        "client_token": client_token,
        "internal_id": internal_id,
        "plate_number": veh.plate_number,
        "route_id": route.id,
        "uid": uid,
    }
    db.close()
    return data


@pytest.mark.asyncio
async def test_resolve_vehicle_endpoint(transport_api_setup):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Resolve by internal_id
        res = await client.post(
            "/api/v1/transport/resolve-vehicle",
            json={"identifier": transport_api_setup["internal_id"]},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["vehicleId"] == transport_api_setup["internal_id"]
        assert data["licensePlate"] == transport_api_setup["plate_number"]
        assert data["fareSoM"] == 2000
        assert data["driverName"] == "Haydovchi Shuxrat"

        # Resolve by license plate
        res_plate = await client.post(
            "/api/v1/transport/resolve-vehicle",
            json={"identifier": transport_api_setup["plate_number"]},
        )
        assert res_plate.status_code == 200
        assert res_plate.json()["vehicleId"] == transport_api_setup["internal_id"]


@pytest.mark.asyncio
async def test_transport_pay_endpoint(transport_api_setup):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            "/api/v1/transport/pay",
            headers={
                "Authorization": f"Bearer {transport_api_setup['client_token']}",
                "Idempotency-Key": f"test_idem_{uuid.uuid4().hex}",
            },
            json={
                "vehicleId": transport_api_setup["internal_id"],
                "method": "wallet",
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "completed"
        assert data["paidAmountSoM"] == 2000
        assert "paymentId" in data


@pytest.mark.asyncio
async def test_routing_search_get_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(
            "/api/v1/routing/search?origin_lat=40.7821&origin_lng=72.3442&dest_lat=40.7980&dest_lng=72.3680&mode=fastest"
        )
        assert res.status_code == 200
        data = res.json()
        assert "itineraries" in data
        assert len(data["itineraries"]) >= 1


@pytest.mark.asyncio
async def test_watch_board_and_alight_endpoints(transport_api_setup):
    # Create watch session first
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        start_res = await client.post(
            "/api/v1/client/watch/start",
            headers={"Authorization": f"Bearer {transport_api_setup['client_token']}"},
            json={
                "route_id": transport_api_setup["route_id"],
                "direction": "outbound",
                "lat": 40.7821,
                "lng": 72.3442,
            },
        )
        assert start_res.status_code == 201
        watch_id = start_res.json()["id"]

        # Board vehicle
        board_res = await client.post(
            "/api/v1/client/watch/board",
            json={"watchSessionId": watch_id},
        )
        assert board_res.status_code == 200
        assert board_res.json()["status"] == "ON_VEHICLE"

        # Alight vehicle
        alight_res = await client.post(
            "/api/v1/client/watch/alight",
            json={"watchSessionId": watch_id},
        )
        assert alight_res.status_code == 200
        assert alight_res.json()["status"] == "COMPLETED"
