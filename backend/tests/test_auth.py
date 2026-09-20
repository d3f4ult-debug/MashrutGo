from app.api.v1.auth import login_throttle
from app.core.config import settings
from app.models.system import AuditLog
from tests.factories import PASSWORD, auth, make_user, unique_phone


def test_health(client):
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "database": "ok"}


def test_client_registration_login_and_me(client, db):
    phone = unique_phone()
    res = client.post("/api/v1/auth/register-client", json={"phone": phone, "password": "strong-pass", "full_name": "Ali Valiyev"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["user"]["role"] == "client" and body["expires_in"] > 0

    assert client.post("/api/v1/auth/register-client", json={"phone": phone, "password": "strong-pass", "full_name": "X Y"}).status_code == 409

    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200 and me.json()["phone"] == phone

    # Phone normalization: "90 123 45 67"-style input maps to the same account
    local = phone[4:]
    login = client.post("/api/v1/auth/login", json={"phone": f"{local[:2]} {local[2:5]} {local[5:7]} {local[7:]}", "password": "strong-pass"})
    assert login.status_code == 200
    assert db.query(AuditLog).filter(AuditLog.action == "user.login", AuditLog.actor_user_id == body["user"]["id"]).count() >= 1


def test_register_validation(client):
    assert client.post("/api/v1/auth/register-client", json={"phone": "12345", "password": "strong-pass", "full_name": "Ali"}).status_code == 422
    assert client.post("/api/v1/auth/register-client", json={"phone": unique_phone(), "password": "short", "full_name": "Ali"}).status_code == 422


def test_unauthenticated_and_bad_token(client):
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_wrong_password_and_throttling(client, db, monkeypatch):
    user = make_user(db, "client")
    monkeypatch.setattr(settings, "login_max_attempts", 3)
    login_throttle.reset(user.phone, "testclient")
    for _ in range(3):
        assert client.post("/api/v1/auth/login", json={"phone": user.phone, "password": "wrong-pass"}).status_code == 401
    locked = client.post("/api/v1/auth/login", json={"phone": user.phone, "password": PASSWORD})
    assert locked.status_code == 429 and "Retry-After" in locked.headers
    login_throttle.reset(user.phone, "testclient")
    assert client.post("/api/v1/auth/login", json={"phone": user.phone, "password": PASSWORD}).status_code == 200


def test_blocked_user_cannot_login_or_use_token(client, db):
    user = make_user(db, "client")
    headers = auth(user)
    user.is_active = False
    db.commit()
    assert client.post("/api/v1/auth/login", json={"phone": user.phone, "password": PASSWORD}).status_code == 403
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 403


def test_change_password(client, db):
    user = make_user(db, "client")
    headers = auth(user)
    assert client.post("/api/v1/auth/change-password", headers=headers,
                       json={"current_password": "nope-nope", "new_password": "new-password-1"}).status_code == 400
    assert client.post("/api/v1/auth/change-password", headers=headers,
                       json={"current_password": PASSWORD, "new_password": "new-password-1"}).status_code == 204
    assert client.post("/api/v1/auth/login", json={"phone": user.phone, "password": "new-password-1"}).status_code == 200


def test_swagger_form_login(client, db):
    user = make_user(db, "client")
    res = client.post("/api/v1/auth/login/form", data={"username": user.phone, "password": PASSWORD})
    assert res.status_code == 200 and res.json()["access_token"]
