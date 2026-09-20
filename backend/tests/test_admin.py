
from app.models.system import AuditLog
from tests.factories import PASSWORD, auth, fund_client, make_driver, make_route, make_user, make_uyushma, super_admin


def test_kpis_and_uyushma_admin_views(client, db):
    headers = auth(super_admin(db))
    kpis = client.get("/api/v1/admin/kpis", headers=headers)
    assert kpis.status_code == 200 and kpis.json()["system_status"] in ("healthy", "maintenance")
    u = make_uyushma(db, "KPI Uyushma")
    make_route(db, u)
    listed = {x["id"]: x for x in client.get("/api/v1/admin/uyushmalar", headers=headers).json()}
    assert listed[u.id]["routes_count"] == 1 and listed[u.id]["status"] == "active"

    upd = client.put(f"/api/v1/admin/uyushmalar/{u.id}", headers=headers, json={"contact_person": "Erkin", "region": "Asaka"})
    assert upd.status_code == 200 and upd.json()["contact_person"] == "Erkin"


def test_archive_uyushma_requires_reason_and_deactivates_tenant(client, db):
    headers = auth(super_admin(db))
    u = make_uyushma(db)
    route = make_route(db, u)
    tenant_admin = make_user(db, "uyushma_admin", u.id)
    assert client.post(f"/api/v1/admin/uyushmalar/{u.id}/archive", headers=headers, json={"reason": ""}).status_code == 422
    res = client.post(f"/api/v1/admin/uyushmalar/{u.id}/archive", headers=headers, json={"reason": "Litsenziya muddati tugagan"})
    assert res.status_code == 200 and res.json()["status"] == "archived"
    assert client.get(f"/api/v1/routes/{route.id}").status_code == 404
    assert client.post("/api/v1/auth/login", json={"phone": tenant_admin.phone, "password": PASSWORD}).status_code == 403
    assert db.query(AuditLog).filter(AuditLog.action == "uyushma.archive", AuditLog.target_id == str(u.id)).one().reason
    assert client.post(f"/api/v1/admin/uyushmalar/{u.id}/archive", headers=headers, json={"reason": "yana bir bor"}).status_code == 409


def test_client_block_unblock(client, db):
    headers = auth(super_admin(db))
    user = make_user(db, "client")
    assert client.post(f"/api/v1/admin/clients/{user.id}/toggle-block", headers=headers, json={"block": True}).status_code == 422
    blocked = client.post(f"/api/v1/admin/clients/{user.id}/toggle-block", headers=headers, json={"block": True, "reason": "Firibgarlik"})
    assert blocked.json()["is_blocked"] is True
    assert client.post("/api/v1/auth/login", json={"phone": user.phone, "password": PASSWORD}).status_code == 403
    client.post(f"/api/v1/admin/clients/{user.id}/toggle-block", headers=headers, json={"block": False})
    assert client.post("/api/v1/auth/login", json={"phone": user.phone, "password": PASSWORD}).status_code == 200
    page = client.get(f"/api/v1/admin/clients?search={user.phone[-7:]}", headers=headers).json()
    assert page["total"] == 1 and page["items"][0]["id"] == user.id


def test_settings_validation_and_audit(client, db):
    headers = auth(super_admin(db))
    current = client.get("/api/v1/admin/settings", headers=headers).json()
    assert current["refund_window_minutes"] >= 0
    assert client.put("/api/v1/admin/settings", headers=headers, json={"gps_interval_seconds": 1}).status_code == 422
    res = client.put("/api/v1/admin/settings", headers=headers, json={"refund_window_minutes": 20})
    assert res.status_code == 200 and res.json()["refund_window_minutes"] == 20 and res.json()["updated_by"]
    client.put("/api/v1/admin/settings", headers=headers, json={"refund_window_minutes": current["refund_window_minutes"]})
    logs = client.get("/api/v1/admin/audit-logs?action=settings.update", headers=headers).json()
    assert logs["total"] >= 1 and logs["items"][0]["changes"]["refund_window_minutes"]["new"] in (20, current["refund_window_minutes"])


def test_force_end_shift_and_live_list(client, db):
    headers = auth(super_admin(db))
    u = make_uyushma(db)
    driver_user, _, _ = make_driver(db, u, make_route(db, u))
    shift_id = client.post("/api/v1/driver/shift/start", headers=auth(driver_user), json={"direction": "outbound"}).json()["id"]
    live = {s["id"]: s for s in client.get("/api/v1/admin/shifts/live", headers=headers).json()}
    assert live[shift_id]["is_online"] is False  # no GPS yet, but shift is listed
    assert client.post(f"/api/v1/admin/shifts/{shift_id}/force-end", headers=headers, json={"reason": "no"}).status_code == 422
    res = client.post(f"/api/v1/admin/shifts/{shift_id}/force-end", headers=headers, json={"reason": "Haydovchi javob bermadi"})
    assert res.status_code == 200
    assert client.get("/api/v1/driver/shift/current", headers=auth(driver_user)).json() is None


def test_wallet_adjustment_and_ledger_health(client, db):
    headers = auth(super_admin(db))
    user = make_user(db, "client")
    fund_client(db, user, 1000)
    res = client.post(f"/api/v1/admin/wallets/{user.id}/adjust", headers=headers, json={"amount_uzs": 500, "reason": "Kompensatsiya"})
    assert res.status_code == 200 and res.json()["balance_after_uzs"] == 1500 and res.json()["entry_type"] == "adjustment"
    assert client.post(f"/api/v1/admin/wallets/{user.id}/adjust", headers=headers, json={"amount_uzs": -5000, "reason": "Xato"}).status_code == 409
    health = client.get("/api/v1/admin/ledger/health", headers=headers).json()
    assert health["wallets_checked"] >= 1 and health["inconsistent_wallets"] == []


def test_operations_live_fleet_is_tenant_scoped(client, db):
    u1, u2 = make_uyushma(db), make_uyushma(db)
    d1, _, v1 = make_driver(db, u1, make_route(db, u1))
    d2, _, v2 = make_driver(db, u2, make_route(db, u2))
    for d in (d1, d2):
        client.post("/api/v1/driver/shift/start", headers=auth(d), json={"direction": "outbound"})
    try:
        admin1 = make_user(db, "uyushma_admin", u1.id)
        fleet = client.get("/api/v1/operations/live-fleet", headers=auth(admin1)).json()
        ids = {v["vehicle_id"] for v in fleet}
        assert v1.internal_id in ids and v2.internal_id not in ids
        assert fleet[0]["shift_status"] == "awaiting_gps"
        everything = {v["vehicle_id"] for v in client.get("/api/v1/operations/live-fleet", headers=auth(super_admin(db))).json()}
        assert {v1.internal_id, v2.internal_id} <= everything
    finally:
        for d in (d1, d2):
            client.post("/api/v1/driver/shift/end", headers=auth(d))
