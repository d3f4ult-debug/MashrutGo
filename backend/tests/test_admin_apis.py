import uuid
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.roles import UserRole
from app.core.security import create_access_token, get_password_hash
from app.db.session import SessionLocal
from app.main import app
from app.models.finance import FareRule, Payment, Refund, CashoutRequest, Wallet, WalletTransaction
from app.models.shift import DriverShift
from app.models.transport import Route, Vehicle, Parking
from app.models.user import DriverProfile, User, ClientProfile
from app.models.uyushma import Uyushma
from app.services.realtime.tracking_service import tracking_service


@pytest.fixture
def admin_test_setup():
    """Setup multi-tenant test environment: Super Admin, 2 Uyushmas, Drivers, Vehicles, Clients."""
    db = SessionLocal()
    uid = uuid.uuid4().hex[:6]

    # 1. Super Admin User
    super_admin = User(
        phone=f"+99899{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Super Admin Boss",
        role=UserRole.SUPER_ADMIN.value,
    )
    db.add(super_admin)
    db.commit()
    db.refresh(super_admin)
    super_token = create_access_token(
        subject=super_admin.id,
        role=super_admin.role,
        uyushma_id=None,
    )

    # 2. Uyushma A
    uyushma_a = Uyushma(
        name=f"Andijon Trans A {uid}",
        code=f"UYA-{uid}",
        phone=f"+99890{uid[:7]}",
        is_active=True,
    )
    db.add(uyushma_a)
    db.commit()
    db.refresh(uyushma_a)

    admin_a = User(
        phone=f"+99891{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Admin Uyushma A",
        role=UserRole.UYUSHMA_ADMIN.value,
        uyushma_id=uyushma_a.id,
    )
    db.add(admin_a)
    db.commit()
    db.refresh(admin_a)
    admin_a_token = create_access_token(
        subject=admin_a.id,
        role=admin_a.role,
        uyushma_id=uyushma_a.id,
    )

    # 3. Uyushma B (for tenant isolation tests)
    uyushma_b = Uyushma(
        name=f"Andijon Trans B {uid}",
        code=f"UYB-{uid}",
        phone=f"+99892{uid[:7]}",
        is_active=True,
    )
    db.add(uyushma_b)
    db.commit()
    db.refresh(uyushma_b)

    admin_b = User(
        phone=f"+99893{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Admin Uyushma B",
        role=UserRole.UYUSHMA_ADMIN.value,
        uyushma_id=uyushma_b.id,
    )
    db.add(admin_b)
    db.commit()
    db.refresh(admin_b)
    admin_b_token = create_access_token(
        subject=admin_b.id,
        role=admin_b.role,
        uyushma_id=uyushma_b.id,
    )

    # 4. Route for Uyushma A
    route_a = Route(
        uyushma_id=uyushma_a.id,
        route_number=f"10{uid[:2]}",
        name="Navoiy - Eski Shahar",
        is_published=True,
    )
    db.add(route_a)
    db.commit()
    db.refresh(route_a)

    # 5. Route for Uyushma B
    route_b = Route(
        uyushma_id=uyushma_b.id,
        route_number=f"20{uid[:2]}",
        name="Aeroport - Universitet",
        is_published=True,
    )
    db.add(route_b)
    db.commit()
    db.refresh(route_b)

    # 6. Driver in Uyushma A
    drv_user_a = User(
        phone=f"+99894{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Haydovchi Otabek",
        role=UserRole.DRIVER.value,
        uyushma_id=uyushma_a.id,
    )
    db.add(drv_user_a)
    db.commit()
    db.refresh(drv_user_a)

    drv_profile_a = DriverProfile(
        user_id=drv_user_a.id,
        uyushma_id=uyushma_a.id,
        license_number=f"DRV-A-{uid}",
        is_active=True,
    )
    db.add(drv_profile_a)
    db.commit()
    db.refresh(drv_profile_a)

    # 7. Driver in Uyushma B
    drv_user_b = User(
        phone=f"+99895{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Haydovchi Bobur",
        role=UserRole.DRIVER.value,
        uyushma_id=uyushma_b.id,
    )
    db.add(drv_user_b)
    db.commit()
    db.refresh(drv_user_b)

    drv_profile_b = DriverProfile(
        user_id=drv_user_b.id,
        uyushma_id=uyushma_b.id,
        license_number=f"DRV-B-{uid}",
        is_active=True,
    )
    db.add(drv_profile_b)
    db.commit()
    db.refresh(drv_profile_b)

    # 8. Vehicle in Uyushma A
    veh_a = Vehicle(
        internal_id=f"VEH-A-{uid}",
        uyushma_id=uyushma_a.id,
        driver_id=drv_profile_a.id,
        route_id=route_a.id,
        plate_number="60 111 AAA",
        model="Damas",
        is_active=True,
    )
    db.add(veh_a)
    db.commit()
    db.refresh(veh_a)

    # 9. Client User
    client_user = User(
        phone=f"+99897{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Mijoz Malika",
        role=UserRole.CLIENT.value,
        is_active=True,
    )
    db.add(client_user)
    db.commit()
    db.refresh(client_user)

    client_profile = ClientProfile(
        user_id=client_user.id,
        preferred_language="uz",
    )
    db.add(client_profile)
    db.commit()

    # Read necessary IDs before closing session
    setup_data = {
        "super_admin_id": super_admin.id,
        "super_token": super_token,
        "uyushma_a_id": uyushma_a.id,
        "admin_a_token": admin_a_token,
        "uyushma_b_id": uyushma_b.id,
        "admin_b_token": admin_b_token,
        "route_a_id": route_a.id,
        "route_b_id": route_b.id,
        "driver_a_id": drv_profile_a.id,
        "driver_b_id": drv_profile_b.id,
        "vehicle_a_id": veh_a.id,
        "vehicle_a_internal_id": veh_a.internal_id,
        "client_user_id": client_user.id,
        "uid": uid,
    }
    db.close()
    return setup_data


# --- 1. Dashboard Metrics & Tenant Isolation ---
@pytest.mark.asyncio
async def test_dashboard_metrics_and_tenant_isolation(admin_test_setup):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Super Admin sees global metrics
        res_super = await client.get(
            "/api/v1/admin/dashboard",
            headers={"Authorization": f"Bearer {admin_test_setup['super_token']}"},
        )
        assert res_super.status_code == 200
        data_super = res_super.json()
        assert data_super["total_uyushmas"] >= 2
        assert data_super["total_routes"] >= 2
        assert data_super["total_vehicles"] >= 1

        # Uyushma A admin sees tenant-isolated metrics
        res_a = await client.get(
            "/api/v1/admin/dashboard",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
        )
        assert res_a.status_code == 200
        data_a = res_a.json()
        assert data_a["total_uyushmas"] == 1
        assert data_a["total_routes"] >= 1


# --- 2. Vehicle CRUD, Filtering, 1 Driver 1 Vehicle rule, Soft Delete ---
@pytest.mark.asyncio
async def test_vehicle_crud_and_driver_uniqueness(admin_test_setup):
    uid = uuid.uuid4().hex[:6]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Register a new vehicle without driver
        create_payload = {
            "internal_id": f"VEH-NEW-{uid}",
            "uyushma_id": admin_test_setup["uyushma_a_id"],
            "route_id": admin_test_setup["route_a_id"],
            "plate_number": "60 222 BBB",
            "model": "Damas",
            "capacity": 7,
            "is_active": True,
        }
        res_create = await client.post(
            "/api/v1/admin/vehicles",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
            json=create_payload,
        )
        assert res_create.status_code == 201
        veh_data = res_create.json()
        veh_id = veh_data["id"]
        assert veh_data["internal_id"] == f"VEH-NEW-{uid}"
        assert veh_data["uyushma_id"] == admin_test_setup["uyushma_a_id"]

        # 2. Attempt to assign Driver A who is already assigned to Vehicle A -> should fail (HTTP 400)
        res_dup_driver = await client.put(
            f"/api/v1/admin/vehicles/{veh_id}",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
            json={"driver_id": admin_test_setup["driver_a_id"]},
        )
        assert res_dup_driver.status_code == 400
        assert "allaqachon boshqa transportga" in res_dup_driver.json()["detail"]

        # 3. Filter vehicles by uyushma and search query
        res_list = await client.get(
            f"/api/v1/admin/vehicles?search=VEH-NEW-{uid}",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
        )
        assert res_list.status_code == 200
        list_data = res_list.json()
        assert list_data["total"] == 1
        assert list_data["items"][0]["id"] == veh_id

        # 4. Update vehicle specs
        res_update = await client.put(
            f"/api/v1/admin/vehicles/{veh_id}",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
            json={"color": "Oq", "capacity": 8},
        )
        assert res_update.status_code == 200
        assert res_update.json()["color"] == "Oq"
        assert res_update.json()["capacity"] == 8

        # 5. Soft-delete / Archive vehicle
        res_del = await client.delete(
            f"/api/v1/admin/vehicles/{veh_id}",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
        )
        assert res_del.status_code == 200
        assert res_del.json()["is_active"] is False

        # Verify it still exists in DB but is inactive
        res_check = await client.get(
            f"/api/v1/admin/vehicles?is_active=false&search=VEH-NEW-{uid}",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
        )
        assert res_check.status_code == 200
        assert res_check.json()["total"] == 1


# --- 3. Tenant Isolation in Vehicles ---
@pytest.mark.asyncio
async def test_vehicle_tenant_isolation(admin_test_setup):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Uyushma B admin attempts to archive Uyushma A's vehicle -> should fail (HTTP 403)
        res = await client.delete(
            f"/api/v1/admin/vehicles/{admin_test_setup['vehicle_a_id']}",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_b_token']}"},
        )
        assert res.status_code == 403


# --- 4. Driver Management & Soft-Delete ---
@pytest.mark.asyncio
async def test_driver_crud_and_archive(admin_test_setup):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. List drivers for Uyushma A
        res_list = await client.get(
            "/api/v1/admin/drivers?search=Otabek",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
        )
        assert res_list.status_code == 200
        assert res_list.json()["total"] >= 1
        driver_entry = res_list.json()["items"][0]
        assert driver_entry["id"] == admin_test_setup["driver_a_id"]
        assert driver_entry["assigned_vehicle_internal_id"] == admin_test_setup["vehicle_a_internal_id"]

        # 2. Update driver profile
        res_update = await client.put(
            f"/api/v1/admin/drivers/{admin_test_setup['driver_a_id']}",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
            json={"license_number": "DRV-UPDATED-001"},
        )
        assert res_update.status_code == 200
        assert res_update.json()["license_number"] == "DRV-UPDATED-001"

        # 3. Soft-delete / Archive driver
        res_archive = await client.delete(
            f"/api/v1/admin/drivers/{admin_test_setup['driver_a_id']}",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
        )
        assert res_archive.status_code == 200
        assert res_archive.json()["is_active"] is False


# --- 5. Tariff / Fare Rules CRUD & Archive ---
@pytest.mark.asyncio
async def test_tariff_crud_and_archive(admin_test_setup):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Create a distance tariff rule
        payload = {
            "uyushma_id": admin_test_setup["uyushma_a_id"],
            "route_id": admin_test_setup["route_a_id"],
            "rule_type": "distance",
            "base_fare_uzs": 2000,
            "extra_fare_per_km_uzs": 800,
            "is_active": True,
        }
        res_create = await client.post(
            "/api/v1/admin/tariffs",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
            json=payload,
        )
        assert res_create.status_code == 201
        tariff_id = res_create.json()["id"]
        assert res_create.json()["base_fare_uzs"] == 2000
        assert res_create.json()["extra_fare_per_km_uzs"] == 800

        # 2. List tariffs with filter
        res_list = await client.get(
            f"/api/v1/admin/tariffs?route_id={admin_test_setup['route_a_id']}&rule_type=distance",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
        )
        assert res_list.status_code == 200
        assert res_list.json()["total"] >= 1

        # 3. Update tariff
        res_upd = await client.put(
            f"/api/v1/admin/tariffs/{tariff_id}",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
            json={"base_fare_uzs": 2500},
        )
        assert res_upd.status_code == 200
        assert res_upd.json()["base_fare_uzs"] == 2500

        # 4. Soft-delete / Archive tariff
        res_del = await client.delete(
            f"/api/v1/admin/tariffs/{tariff_id}",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
        )
        assert res_del.status_code == 200
        assert res_del.json()["is_active"] is False


# --- 6. Client List & Super Admin Block/Unblock ---
@pytest.mark.asyncio
async def test_client_management_and_rbac(admin_test_setup):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. List clients
        res_list = await client.get(
            "/api/v1/admin/clients?search=Malika",
            headers={"Authorization": f"Bearer {admin_test_setup['super_token']}"},
        )
        assert res_list.status_code == 200
        assert res_list.json()["total"] >= 1

        client_id = admin_test_setup["client_user_id"]

        # 2. Uyushma admin tries to block client -> Forbidden (HTTP 403)
        res_forbidden = await client.put(
            f"/api/v1/admin/clients/{client_id}",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
            json={"is_active": False},
        )
        assert res_forbidden.status_code == 403

        # 3. Super Admin blocks client -> Success
        res_block = await client.put(
            f"/api/v1/admin/clients/{client_id}",
            headers={"Authorization": f"Bearer {admin_test_setup['super_token']}"},
            json={"is_active": False},
        )
        assert res_block.status_code == 200
        assert res_block.json()["is_active"] is False

        # 4. Super Admin unblocks client
        res_unblock = await client.put(
            f"/api/v1/admin/clients/{client_id}",
            headers={"Authorization": f"Bearer {admin_test_setup['super_token']}"},
            json={"is_active": True},
        )
        assert res_unblock.status_code == 200
        assert res_unblock.json()["is_active"] is True


# --- 7. Shifts Monitoring ---
@pytest.mark.asyncio
async def test_shifts_monitoring(admin_test_setup):
    # Create a test shift
    db = SessionLocal()
    shift = DriverShift(
        driver_id=admin_test_setup["driver_a_id"],
        vehicle_id=admin_test_setup["vehicle_a_id"],
        route_id=admin_test_setup["route_a_id"],
        direction="forward",
        status="active",
    )
    db.add(shift)
    db.commit()
    db.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(
            f"/api/v1/admin/shifts?route_id={admin_test_setup['route_a_id']}&status=active",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["total"] >= 1
        assert data["items"][0]["status"] == "active"


# --- 8. System Settings & Audit Logs ---
@pytest.mark.asyncio
async def test_settings_and_audit_logs(admin_test_setup):
    uid = uuid.uuid4().hex[:6]
    setting_key = f"TEST_SETTING_{uid}"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Super Admin creates/updates system setting
        res_set = await client.post(
            "/api/v1/admin/settings",
            headers={"Authorization": f"Bearer {admin_test_setup['super_token']}"},
            json={
                "key": setting_key,
                "value": "active_value_123",
                "description": "Integration test setting",
            },
        )
        assert res_set.status_code == 200
        assert res_set.json()["key"] == setting_key
        assert res_set.json()["value"] == "active_value_123"

        # 2. Super Admin lists settings
        res_list = await client.get(
            "/api/v1/admin/settings",
            headers={"Authorization": f"Bearer {admin_test_setup['super_token']}"},
        )
        assert res_list.status_code == 200
        keys = [s["key"] for s in res_list.json()]
        assert setting_key in keys

        # 3. Uyushma Admin cannot access settings (HTTP 403)
        res_denied = await client.get(
            "/api/v1/admin/settings",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
        )
        assert res_denied.status_code == 403

        # 4. Super Admin inspects audit logs
        res_audit = await client.get(
            "/api/v1/admin/audit-logs",
            headers={"Authorization": f"Bearer {admin_test_setup['super_token']}"},
        )
        assert res_audit.status_code == 200
        assert res_audit.json()["total"] >= 1


# --- 9. Uyushma Soft-Delete / Archive ---
@pytest.mark.asyncio
async def test_uyushma_archive(admin_test_setup):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Non-super admin cannot archive Uyushma (HTTP 403)
        res_denied = await client.delete(
            f"/api/v1/uyushma/{admin_test_setup['uyushma_b_id']}",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
        )
        assert res_denied.status_code == 403

        # 2. Super Admin archives Uyushma B
        res_archive = await client.delete(
            f"/api/v1/uyushma/{admin_test_setup['uyushma_b_id']}",
            headers={"Authorization": f"Bearer {admin_test_setup['super_token']}"},
        )
        assert res_archive.status_code == 200
        assert res_archive.json()["is_active"] is False

        # Verify Uyushma B is still accessible by Super Admin but marked inactive
        res_get = await client.get(
            f"/api/v1/uyushma/{admin_test_setup['uyushma_b_id']}",
            headers={"Authorization": f"Bearer {admin_test_setup['super_token']}"},
        )
        assert res_get.status_code == 200
        assert res_get.json()["is_active"] is False


# --- 10. Uyushma Nested Vehicles API ---
@pytest.mark.asyncio
async def test_uyushma_nested_vehicles_api(admin_test_setup):
    uid = uuid.uuid4().hex[:6]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. List vehicles for Uyushma A
        res_list = await client.get(
            f"/api/v1/uyushma/{admin_test_setup['uyushma_a_id']}/vehicles",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
        )
        assert res_list.status_code == 200
        assert len(res_list.json()) >= 1

        # 2. Register vehicle directly via /uyushma/{id}/vehicles
        res_post = await client.post(
            f"/api/v1/uyushma/{admin_test_setup['uyushma_a_id']}/vehicles",
            headers={"Authorization": f"Bearer {admin_test_setup['admin_a_token']}"},
            json={
                "internal_id": f"VEH-NESTED-{uid}",
                "plate_number": "60 999 ZZZ",
                "model": "Damas",
                "capacity": 7,
            },
        )
        assert res_post.status_code == 201
        assert res_post.json()["internal_id"] == f"VEH-NESTED-{uid}"
        assert res_post.json()["uyushma_id"] == admin_test_setup["uyushma_a_id"]
