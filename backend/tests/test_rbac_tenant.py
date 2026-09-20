from app.models.user import User
from tests.factories import auth, make_driver, make_route, make_uyushma, make_user, super_admin, unique_phone


def test_super_admin_creates_uyushma_with_admin_account(client, db):
    admin_headers = auth(super_admin(db))
    phone = unique_phone()
    res = client.post("/api/v1/uyushma", headers=admin_headers, json={
        "name": "Asaka Trans", "code": f"ASK-{phone[-4:]}", "phone": "+998741112233",
        "admin_full_name": "Asaka Dispetcher", "admin_phone": phone, "admin_password": "asaka-pass-1",
    })
    assert res.status_code == 201, res.text
    uyushma_id = res.json()["id"]
    admin_user = db.query(User).filter(User.phone == phone).first()
    assert admin_user.role == "uyushma_admin" and admin_user.uyushma_id == uyushma_id
    login = client.post("/api/v1/auth/login", json={"phone": phone, "password": "asaka-pass-1"})
    assert login.status_code == 200

    duplicate = client.post("/api/v1/uyushma", headers=admin_headers, json={"name": "Dup", "code": f"ASK-{phone[-4:]}", "phone": "+998741112233"})
    assert duplicate.status_code == 409


def test_only_super_admin_manages_uyushmas(client, db):
    u = make_uyushma(db)
    uy_admin = make_user(db, "uyushma_admin", u.id)
    client_user = make_user(db, "client")
    body = {"name": "Nope", "code": "NOPE-1", "phone": "+998740000000"}
    assert client.post("/api/v1/uyushma", headers=auth(uy_admin), json=body).status_code == 403
    assert client.post("/api/v1/uyushma", headers=auth(client_user), json=body).status_code == 403
    assert client.get("/api/v1/admin/kpis", headers=auth(uy_admin)).status_code == 403


def test_tenant_isolation_across_resources(client, db):
    u1, u2 = make_uyushma(db, "U1"), make_uyushma(db, "U2")
    admin1 = make_user(db, "uyushma_admin", u1.id)
    headers = auth(admin1)
    for path in ("drivers", "vehicles", "parkings", "fares", "payments", "cashouts", "kpis", "routes", "finance/summary"):
        assert client.get(f"/api/v1/uyushma/{u1.id}/{path}", headers=headers).status_code == 200, path
        assert client.get(f"/api/v1/uyushma/{u2.id}/{path}", headers=headers).status_code == 403, path
    created = client.post(f"/api/v1/uyushma/{u2.id}/drivers", headers=headers,
                          json={"phone": unique_phone(), "password": "driver-pass", "full_name": "Hacker"})
    assert created.status_code == 403


def test_uyushma_admin_cannot_see_foreign_drafts(client, db):
    u1, u2 = make_uyushma(db), make_uyushma(db)
    draft = make_route(db, u2, published=False)
    admin1 = make_user(db, "uyushma_admin", u1.id)
    listed = client.get(f"/api/v1/routes?uyushma_id={u2.id}", headers=auth(admin1)).json()
    assert draft.id not in {r["id"] for r in listed}
    assert client.get(f"/api/v1/routes/{draft.id}", headers=auth(admin1)).status_code == 403
    assert client.get(f"/api/v1/routes/{draft.id}").status_code == 404


def test_role_guards_on_driver_and_client_endpoints(client, db):
    u = make_uyushma(db)
    client_user = make_user(db, "client")
    driver_user, _, _ = make_driver(db, u, make_route(db, u))
    assert client.post("/api/v1/driver/shift/start", headers=auth(client_user), json={"direction": "outbound"}).status_code == 403
    assert client.get("/api/v1/wallet/balance", headers=auth(driver_user)).status_code == 403
    assert client.get("/api/v1/driver/payments", headers=auth(client_user)).status_code == 403
