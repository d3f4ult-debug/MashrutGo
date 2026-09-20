"""Super Admin governance rules: tenant archive, Uyushma admin accounts, wallet corrections, settings."""
import uuid

from app.models.finance import WalletTransaction
from app.models.transport import Vehicle
from app.models.user import DriverProfile
from tests.factories import auth, make_driver, make_route, make_uyushma, make_user, super_admin


def test_archive_stops_drivers_and_vehicles_and_leaves_platform_totals(client, db):
    headers = auth(super_admin(db))
    before = client.get("/api/v1/admin/kpis", headers=headers).json()
    u = make_uyushma(db)
    route = make_route(db, u)
    _, profile, vehicle = make_driver(db, u, route)
    during = client.get("/api/v1/admin/kpis", headers=headers).json()
    assert during["total_drivers"] == before["total_drivers"] + 1
    assert during["total_vehicles"] == before["total_vehicles"] + 1

    assert client.post(f"/api/v1/admin/uyushmalar/{u.id}/archive", headers=headers, json={"reason": "Faoliyat to'xtatildi"}).status_code == 200
    db.expire_all()
    assert db.get(DriverProfile, profile.id).is_active is False
    assert db.get(Vehicle, vehicle.id).is_active is False
    after = client.get("/api/v1/admin/kpis", headers=headers).json()
    for key in ("total_uyushmalar", "total_routes", "total_drivers", "total_vehicles"):
        assert after[key] == before[key], key


def test_super_admin_can_create_and_reset_the_uyushma_admin_login(client, db):
    headers = auth(super_admin(db))
    u = make_uyushma(db)
    phone = f"+99893{uuid.uuid4().int % 10_000_000:07d}"
    res = client.put(f"/api/v1/admin/uyushmalar/{u.id}/admin", headers=headers,
                     json={"full_name": "Dispetcher", "phone": phone[4:], "password": "boshlangich-1"})
    assert res.status_code == 200 and res.json()["admin_phone"] == phone
    login = client.post("/api/v1/auth/login", json={"phone": phone, "password": "boshlangich-1"})
    assert login.status_code == 200 and login.json()["user"]["role"] == "uyushma_admin"

    reset = client.put(f"/api/v1/admin/uyushmalar/{u.id}/admin", headers=headers,
                       json={"full_name": "Dispetcher", "phone": phone, "password": "yangi-parol-2"})
    assert reset.status_code == 200
    assert client.post("/api/v1/auth/login", json={"phone": phone, "password": "boshlangich-1"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"phone": phone, "password": "yangi-parol-2"}).status_code == 200

    other = make_user(db, "client")
    taken = client.put(f"/api/v1/admin/uyushmalar/{u.id}/admin", headers=headers,
                       json={"full_name": "Boshqa", "phone": other.phone, "password": "yangi-parol-2"})
    assert taken.status_code == 409


def test_uyushma_phone_is_validated_and_normalized(client, db):
    headers = auth(super_admin(db))
    code = f"PH-{uuid.uuid4().hex[:6].upper()}"
    bad = client.post("/api/v1/uyushma", headers=headers, json={"name": "Telefon test", "code": code, "phone": "12345"})
    assert bad.status_code == 422
    ok = client.post("/api/v1/uyushma", headers=headers, json={"name": "Telefon test", "code": code, "phone": "74 223 00 01"})
    assert ok.status_code == 201 and ok.json()["phone"] == "+998742230001"


def test_wallet_adjustment_is_idempotent_and_limited_to_wallet_owners(client, db):
    headers = auth(super_admin(db))
    user = make_user(db, "client")
    key = f"adj-{uuid.uuid4().hex}"
    body = {"amount_uzs": 3000, "reason": "Kompensatsiya"}
    first = client.post(f"/api/v1/admin/wallets/{user.id}/adjust", headers={**headers, "Idempotency-Key": key}, json=body)
    retry = client.post(f"/api/v1/admin/wallets/{user.id}/adjust", headers={**headers, "Idempotency-Key": key}, json=body)
    assert first.status_code == 200 and retry.status_code == 200
    assert first.json()["id"] == retry.json()["id"]
    assert db.query(WalletTransaction).filter(WalletTransaction.idempotency_key == f"adjust:{user.id}:{key}").count() == 1

    conflict = client.post(f"/api/v1/admin/wallets/{user.id}/adjust", headers={**headers, "Idempotency-Key": key},
                           json={"amount_uzs": 5000, "reason": "Boshqa summa"})
    assert conflict.status_code == 409

    tenant_admin = make_user(db, "uyushma_admin", make_uyushma(db).id)
    assert client.post(f"/api/v1/admin/wallets/{tenant_admin.id}/adjust", headers=headers, json=body).status_code == 422


def test_client_list_can_be_filtered_by_block_status(client, db):
    headers = auth(super_admin(db))
    user = make_user(db, "client")
    client.post(f"/api/v1/admin/clients/{user.id}/toggle-block", headers=headers, json={"block": True, "reason": "Tekshiruv"})
    blocked = client.get("/api/v1/admin/clients?status=blocked&size=200", headers=headers).json()
    active = client.get("/api/v1/admin/clients?status=active&size=200", headers=headers).json()
    assert any(c["id"] == user.id for c in blocked["items"])
    assert all(c["is_blocked"] for c in blocked["items"])
    assert not any(c["id"] == user.id for c in active["items"])


def test_topup_limits_must_stay_consistent(client, db):
    headers = auth(super_admin(db))
    current = client.get("/api/v1/admin/settings", headers=headers).json()
    res = client.put("/api/v1/admin/settings", headers=headers, json={"min_topup_uzs": current["max_topup_uzs"] + 1000})
    assert res.status_code == 422


def test_unassigned_vehicle_limit_is_enforced(client, db):
    headers = auth(super_admin(db))
    original = client.get("/api/v1/admin/settings", headers=headers).json()["max_unassigned_vehicles"]
    u = make_uyushma(db)
    tenant_admin = make_user(db, "uyushma_admin", u.id)
    try:
        assert client.put("/api/v1/admin/settings", headers=headers, json={"max_unassigned_vehicles": 1}).status_code == 200
        first = client.post(f"/api/v1/uyushma/{u.id}/vehicles", headers=auth(tenant_admin), json={"plate_number": "60 A 001 AA"})
        assert first.status_code == 201
        second = client.post(f"/api/v1/uyushma/{u.id}/vehicles", headers=auth(tenant_admin), json={"plate_number": "60 A 002 AA"})
        assert second.status_code == 409
        # a vehicle created together with its driver is not "unassigned"
        _, profile, _ = make_driver(db, u, with_vehicle=False)
        with_driver = client.post(f"/api/v1/uyushma/{u.id}/vehicles", headers=auth(tenant_admin),
                                  json={"plate_number": "60 A 003 AA", "driver_id": profile.id})
        assert with_driver.status_code == 201
    finally:
        client.put("/api/v1/admin/settings", headers=headers, json={"max_unassigned_vehicles": original})
