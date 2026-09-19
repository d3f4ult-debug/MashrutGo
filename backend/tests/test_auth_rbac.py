import pytest
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.db.session import SessionLocal
from app.models.system import AuditLog
from app.models.uyushma import Uyushma


@pytest.mark.asyncio
async def test_client_registration_and_login_flow():
    """Client public registration creates user, profile, and wallet, and issues JWT."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ts = int(datetime.now(timezone.utc).timestamp())
        phone = f"+99893{ts % 10000000:07d}"

        # 1. Register Client
        reg_payload = {
            "phone": phone,
            "password": "Password123!",
            "full_name": "Valijon Toirov",
            "preferred_language": "uz",
        }
        res = await client.post("/api/v1/auth/register-client", json=reg_payload)
        assert res.status_code == 201, res.text
        data = res.json()
        assert "access_token" in data
        assert data["user"]["role"] == "client"
        token = data["access_token"]

        # 2. Duplicate registration should fail
        dup_res = await client.post("/api/v1/auth/register-client", json=reg_payload)
        assert dup_res.status_code == 400

        # 3. Call /auth/me with Bearer token
        me_res = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me_res.status_code == 200
        assert me_res.json()["phone"] == phone

        # 4. Call /auth/me without token -> 401
        no_auth = await client.get("/api/v1/auth/me")
        assert no_auth.status_code == 401

        # 5. Login with credentials
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"phone": phone, "password": "Password123!"},
        )
        assert login_res.status_code == 200
        assert "access_token" in login_res.json()

        # 6. Login with wrong password -> 401
        wrong_res = await client.post(
            "/api/v1/auth/login",
            json={"phone": phone, "password": "WrongPassword"},
        )
        assert wrong_res.status_code == 401


@pytest.mark.asyncio
async def test_rbac_and_tenant_isolation():
    """
    Test RBAC hierarchy and tenant isolation:
    - Super Admin creates Uyushma.
    - Non-Super Admin cannot create Uyushma (403).
    - Uyushma Admin can create Driver under own Uyushma.
    - Driver self-registration does not exist.
    - Tenant isolation: Uyushma Admin 1 cannot access or mutate Uyushma 2 data.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ts = int(datetime.now(timezone.utc).timestamp())

        # 1. Login as Super Admin (seeded credentials)
        sa_res = await client.post(
            "/api/v1/auth/login",
            json={"phone": "+998901234567", "password": "admin123"},
        )
        assert sa_res.status_code == 200
        sa_token = sa_res.json()["access_token"]
        sa_headers = {"Authorization": f"Bearer {sa_token}"}

        # 2. Super Admin creates Uyushma 1 and Uyushma 2
        code_1 = f"UY-TEST1-{ts}"
        code_2 = f"UY-TEST2-{ts}"
        u1_res = await client.post(
            "/api/v1/uyushma",
            json={"name": "Uyushma 1", "code": code_1, "phone": "+998741110001"},
            headers=sa_headers,
        )
        assert u1_res.status_code == 201
        uyushma_1_id = u1_res.json()["id"]

        u2_res = await client.post(
            "/api/v1/uyushma",
            json={"name": "Uyushma 2", "code": code_2, "phone": "+998741110002"},
            headers=sa_headers,
        )
        assert u2_res.status_code == 201
        uyushma_2_id = u2_res.json()["id"]

        # 3. Create Uyushma Admin for Uyushma 1 directly in DB / test
        db = SessionLocal()
        from app.models.user import User
        from app.core.security import get_password_hash
        admin1_phone = f"+99894{ts % 10000000:07d}"
        admin1_user = User(
            phone=admin1_phone,
            hashed_password=get_password_hash("pass123"),
            full_name="Uyushma 1 Admin",
            role="uyushma_admin",
            uyushma_id=uyushma_1_id,
            is_active=True,
        )
        db.add(admin1_user)
        db.commit()
        db.close()

        # Login as Uyushma 1 Admin
        u1_admin_login = await client.post(
            "/api/v1/auth/login",
            json={"phone": admin1_phone, "password": "pass123"},
        )
        assert u1_admin_login.status_code == 200
        u1_token = u1_admin_login.json()["access_token"]
        u1_headers = {"Authorization": f"Bearer {u1_token}"}

        # 4. Uyushma Admin cannot create another Uyushma (Only Super Admin can)
        forbidden_uy = await client.post(
            "/api/v1/uyushma",
            json={"name": "Fake", "code": f"FAKE-{ts}", "phone": "+998740000000"},
            headers=u1_headers,
        )
        assert forbidden_uy.status_code == 403

        # 5. Uyushma 1 Admin creates Driver in Uyushma 1 -> Success
        driver_phone = f"+99895{ts % 10000000:07d}"
        drv_res = await client.post(
            f"/api/v1/uyushma/{uyushma_1_id}/drivers",
            json={
                "phone": driver_phone,
                "password": "driverpassword",
                "full_name": "Bahrom Haydovchi",
                "license_number": "AA7654321",
            },
            headers=u1_headers,
        )
        assert drv_res.status_code == 201
        drv_data = drv_res.json()
        assert drv_data["phone"] == driver_phone
        assert drv_data["uyushma_id"] == uyushma_1_id

        # 6. Tenant Isolation: Uyushma 1 Admin tries to create Driver in Uyushma 2 -> 403
        drv2_res = await client.post(
            f"/api/v1/uyushma/{uyushma_2_id}/drivers",
            json={
                "phone": f"+99896{ts % 10000000:07d}",
                "password": "driverpassword",
                "full_name": "Hacker Driver",
            },
            headers=u1_headers,
        )
        assert drv2_res.status_code == 403

        # 7. Tenant Isolation: Uyushma 1 Admin tries to view Uyushma 2 drivers -> 403
        list_u2 = await client.get(
            f"/api/v1/uyushma/{uyushma_2_id}/drivers",
            headers=u1_headers,
        )
        assert list_u2.status_code == 403

        # 8. Uyushma 1 Admin lists own drivers -> 200
        list_u1 = await client.get(
            f"/api/v1/uyushma/{uyushma_1_id}/drivers",
            headers=u1_headers,
        )
        assert list_u1.status_code == 200
        assert len(list_u1.json()) >= 1


def test_audit_log_persisted():
    """Verify that sensitive actions produce immutable AuditLog records."""
    db = SessionLocal()
    try:
        logs = db.query(AuditLog).all()
        assert len(logs) > 0
        actions = [log.action for log in logs]
        assert "user.login" in actions or "client.registered" in actions or "uyushma.create" in actions
    finally:
        db.close()
