import uuid
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.roles import UserRole
from app.core.security import create_access_token, get_password_hash
from app.db.session import SessionLocal
from app.main import app
from app.models.system import DeviceToken, Notification
from app.models.user import User
from app.services.notification import (
    DevNoOpNotificationProvider,
    FCMNotificationProvider,
    notification_service,
    notify_payment_received,
    notify_refund_issued,
    notify_cashout_status,
    notify_arrival_alert,
)


@pytest.fixture
def notification_test_setup():
    """Setup test users: Super Admin, Uyushma Admin, Driver, and Client."""
    db = SessionLocal()
    uid = uuid.uuid4().hex[:6]

    # 1. Super Admin
    super_admin = User(
        phone=f"+99899{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Super Admin Notification Test",
        role=UserRole.SUPER_ADMIN.value,
        is_active=True,
    )
    db.add(super_admin)
    db.commit()
    db.refresh(super_admin)
    super_token = create_access_token(subject=super_admin.id, role=super_admin.role)

    # 2. Uyushma Admin
    uyushma_admin = User(
        phone=f"+99891{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Uyushma Admin Notification Test",
        role=UserRole.UYUSHMA_ADMIN.value,
        is_active=True,
    )
    db.add(uyushma_admin)
    db.commit()
    db.refresh(uyushma_admin)
    admin_token = create_access_token(subject=uyushma_admin.id, role=uyushma_admin.role)

    # 3. Driver
    driver_user = User(
        phone=f"+99893{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Haydovchi Notification Test",
        role=UserRole.DRIVER.value,
        is_active=True,
    )
    db.add(driver_user)
    db.commit()
    db.refresh(driver_user)
    driver_token = create_access_token(subject=driver_user.id, role=driver_user.role)

    # 4. Client
    client_user = User(
        phone=f"+99897{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Mijoz Notification Test",
        role=UserRole.CLIENT.value,
        is_active=True,
    )
    db.add(client_user)
    db.commit()
    db.refresh(client_user)
    client_token = create_access_token(subject=client_user.id, role=client_user.role)

    data = {
        "super_admin_id": super_admin.id,
        "super_token": super_token,
        "admin_id": uyushma_admin.id,
        "admin_token": admin_token,
        "driver_id": driver_user.id,
        "driver_token": driver_token,
        "client_id": client_user.id,
        "client_token": client_token,
        "uid": uid,
    }
    db.close()
    return data


# --- 1. Provider Unit Tests: DevNoOp & FCM Fallback ---
@pytest.mark.asyncio
async def test_noop_and_fcm_providers():
    noop = DevNoOpNotificationProvider()
    noop.clear_history()

    # 1. Single token send
    ok = await noop.send_to_token("test-fcm-token-123456", "Test Title", "Test Body")
    assert ok is True
    history = noop.get_sent_notifications()
    assert len(history) == 1
    assert history[0]["token"] == "test-fcm-token-123456"

    # 2. Multicast send
    res = await noop.send_multicast(["tok-1", "tok-2", "tok-3"], "Multicast Title", "Multicast Body")
    assert res.success is True
    assert res.delivered_count == 3
    assert len(noop.get_sent_notifications()) == 4

    # 3. Topic send
    res_topic = await noop.send_to_topic("drivers_andijon", "Topic Alert", "Topic Body")
    assert res_topic.success is True
    assert res_topic.delivered_count == 1

    # 4. FCM Provider fallback / mock mode without credentials
    fcm = FCMNotificationProvider()
    assert fcm.name == "fcm"
    fcm_res = await fcm.send_to_token("fcm-fake-token-000", "Hello FCM", "Body text")
    assert fcm_res is True

    fcm_multi = await fcm.send_multicast(["t1", "t2"], "Title", "Body")
    assert fcm_multi.success is True
    assert fcm_multi.delivered_count == 2


# --- 2. Device Token Registration Lifecycle ---
@pytest.mark.asyncio
async def test_device_token_registration_lifecycle(notification_test_setup):
    token_str = f"fcm-device-token-{uuid.uuid4().hex}"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Register device token
        res_reg = await client.post(
            "/api/v1/notifications/device-token",
            headers={"Authorization": f"Bearer {notification_test_setup['client_token']}"},
            json={
                "token": token_str,
                "platform": "android",
                "device_name": "Xiaomi Redmi Note 12",
            },
        )
        assert res_reg.status_code == 200
        token_data = res_reg.json()
        assert token_data["token"] == token_str
        assert token_data["platform"] == "android"
        assert token_data["device_name"] == "Xiaomi Redmi Note 12"
        assert token_data["is_active"] is True

        # 2. List user's active devices
        res_list = await client.get(
            "/api/v1/notifications/my-devices",
            headers={"Authorization": f"Bearer {notification_test_setup['client_token']}"},
        )
        assert res_list.status_code == 200
        devices = res_list.json()["items"]
        assert any(d["token"] == token_str for d in devices)

        # 3. Refresh token (same token with updated device name)
        res_refresh = await client.post(
            "/api/v1/notifications/device-token",
            headers={"Authorization": f"Bearer {notification_test_setup['client_token']}"},
            json={
                "token": token_str,
                "platform": "android",
                "device_name": "Xiaomi Redmi Note 12 Pro",
            },
        )
        assert res_refresh.status_code == 200
        assert res_refresh.json()["device_name"] == "Xiaomi Redmi Note 12 Pro"

        # 4. De-register token on logout
        res_del = await client.delete(
            f"/api/v1/notifications/device-token?token={token_str}",
            headers={"Authorization": f"Bearer {notification_test_setup['client_token']}"},
        )
        assert res_del.status_code == 200
        assert res_del.json()["success"] is True

        # 5. Verify token is now inactive in my-devices
        res_list_after = await client.get(
            "/api/v1/notifications/my-devices",
            headers={"Authorization": f"Bearer {notification_test_setup['client_token']}"},
        )
        assert res_list_after.status_code == 200
        tokens_after = [d["token"] for d in res_list_after.json()["items"]]
        assert token_str not in tokens_after


# --- 3. In-App Notifications Inbox & Read Management ---
@pytest.mark.asyncio
async def test_inbox_and_read_management(notification_test_setup):
    db = SessionLocal()
    # Send a notification to client via notification_service
    await notification_service.send_to_user(
        user_id=notification_test_setup["client_id"],
        title="Xush kelibsiz!",
        body="MashrutGo platformasiga xush kelibsiz.",
        notification_type="system.welcome",
        data={"action": "open_profile"},
        save_in_db=True,
        db=db,
    )
    db.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Fetch inbox
        res_inbox = await client.get(
            "/api/v1/notifications/inbox",
            headers={"Authorization": f"Bearer {notification_test_setup['client_token']}"},
        )
        assert res_inbox.status_code == 200
        inbox_data = res_inbox.json()
        assert inbox_data["total"] >= 1
        assert inbox_data["unread_count"] >= 1
        notif_id = inbox_data["items"][0]["id"]
        assert inbox_data["items"][0]["is_read"] is False

        # 2. Mark specific notification as read
        res_read = await client.post(
            f"/api/v1/notifications/inbox/{notif_id}/read",
            headers={"Authorization": f"Bearer {notification_test_setup['client_token']}"},
        )
        assert res_read.status_code == 200
        assert res_read.json()["is_read"] is True

        # 3. Mark all as read
        res_read_all = await client.post(
            "/api/v1/notifications/inbox/read-all",
            headers={"Authorization": f"Bearer {notification_test_setup['client_token']}"},
        )
        assert res_read_all.status_code == 200
        assert res_read_all.json()["success"] is True


# --- 4. Admin Broadcast & Push API ---
@pytest.mark.asyncio
async def test_admin_broadcast_and_rbac(notification_test_setup):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Client tries to broadcast -> Forbidden (HTTP 403)
        res_forbidden = await client.post(
            "/api/v1/notifications/broadcast",
            headers={"Authorization": f"Bearer {notification_test_setup['client_token']}"},
            json={
                "topic": "drivers",
                "title": "Hacked",
                "body": "Should fail",
            },
        )
        assert res_forbidden.status_code == 403

        # 2. Uyushma admin broadcasts to topic
        res_topic = await client.post(
            "/api/v1/notifications/broadcast",
            headers={"Authorization": f"Bearer {notification_test_setup['admin_token']}"},
            json={
                "topic": "drivers_andijon",
                "title": "E'tibor bering!",
                "body": "Bugun yo'lda ta'mirlash ishlari olib borilmoqda.",
                "notification_type": "traffic.alert",
            },
        )
        assert res_topic.status_code == 200
        assert res_topic.json()["success"] is True
        assert res_topic.json()["delivered_count"] >= 1

        # 3. Super admin inspects dev notification history
        res_history = await client.get(
            "/api/v1/notifications/dev-history",
            headers={"Authorization": f"Bearer {notification_test_setup['super_token']}"},
        )
        assert res_history.status_code == 200
        assert "history" in res_history.json()


# --- 5. Event-Triggered Hooks ---
@pytest.mark.asyncio
async def test_event_triggered_hooks(notification_test_setup):
    db = SessionLocal()
    # 1. Register a device token for driver so push delivery can be verified
    driver_token_str = f"fcm-driver-token-{uuid.uuid4().hex}"
    notification_service.register_device_token(
        user_id=notification_test_setup["driver_id"],
        token=driver_token_str,
        platform="android",
        device_name="Driver Phone",
        db=db,
    )

    # 2. Trigger notify_payment_received hook
    pay_res = await notify_payment_received(
        driver_user_id=notification_test_setup["driver_id"],
        vehicle_internal_id="AND-101",
        amount_uzs=2500,
        payment_id=999,
        db=db,
    )
    assert pay_res is not None
    assert pay_res.success is True

    # 3. Trigger notify_refund_issued hook
    ref_res = await notify_refund_issued(
        client_user_id=notification_test_setup["client_id"],
        amount_uzs=2500,
        refund_id=888,
        db=db,
    )
    assert ref_res is not None
    assert ref_res.success is True

    # 4. Trigger notify_cashout_status hook
    cash_res = await notify_cashout_status(
        driver_user_id=notification_test_setup["driver_id"],
        cashout_id=777,
        amount_uzs=150000,
        status="paid",
        notes="Bank kartasiga o'tkazildi",
        db=db,
    )
    assert cash_res is not None
    assert cash_res.success is True

    # 5. Trigger notify_arrival_alert hook
    arr_res = await notify_arrival_alert(
        client_user_id=notification_test_setup["client_id"],
        route_number="10",
        vehicle_internal_id="AND-101",
        eta_minutes=2,
        db=db,
    )
    assert arr_res is not None
    assert arr_res.success is True

    # 6. Verify in-app notifications were created in DB
    notifs = (
        db.query(Notification)
        .filter(Notification.user_id == notification_test_setup["driver_id"])
        .all()
    )
    types = [n.notification_type for n in notifs]
    assert "payment.received" in types
    assert "cashout.status_updated" in types

    db.close()
