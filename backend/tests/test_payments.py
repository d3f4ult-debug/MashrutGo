import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.finance import Payment, Wallet
from app.services import ledger_service
from app.services.settings_service import update_settings
from tests.factories import auth, fund_client, make_driver, make_fare, make_route, make_uyushma, make_user, super_admin


@pytest.fixture
def fleet(db):
    u = make_uyushma(db)
    route = make_route(db, u)
    make_fare(db, u, 2500)
    driver_user, driver, vehicle = make_driver(db, u, route)
    passenger = make_user(db, "client")
    fund_client(db, passenger, 10_000)
    return {"u": u, "route": route, "driver_user": driver_user, "driver": driver, "vehicle": vehicle, "client": passenger}


def _pay(client, passenger, identifier, key=None, method="manual"):
    return client.post("/api/v1/payments/pay", headers={**auth(passenger), "Idempotency-Key": key or uuid.uuid4().hex},
                       json={"identifier": identifier, "method": method})


def _balance(db, user) -> int:
    db.expire_all()
    return db.query(Wallet).filter(Wallet.user_id == user.id).one().balance_uzs


def test_ledger_is_atomic_idempotent_and_reconciles(db):
    user = make_user(db, "client")
    wallet = ledger_service.get_or_create_wallet(db, user)
    ledger_service.post_entry(db, wallet, "topup", 5000, "t", "k-1")
    again = ledger_service.post_entry(db, wallet, "topup", 5000, "t", "k-1")  # replay
    db.commit()
    assert again.balance_after_uzs == 5000 and _balance(db, user) == 5000
    with pytest.raises(ledger_service.IdempotencyConflictError):
        ledger_service.post_entry(db, wallet, "topup", 7000, "t", "k-1")
    with pytest.raises(ledger_service.InsufficientFundsError):
        ledger_service.post_entry(db, wallet, "ride_payment", -6000, "t", "k-2")
    db.rollback()
    assert ledger_service.reconcile_wallet(db, wallet).is_consistent


def test_resolve_vehicle_by_qr_plate_and_internal_id(client, fleet):
    v = fleet["vehicle"]
    for identifier in (v.internal_id, f"mashrutgo://v/{v.internal_id}", f"https://app.mashrutgo.uz/pay?v={v.internal_id}",
                       v.plate_number.replace(" ", "").lower()):
        res = client.post("/api/v1/payments/resolve-vehicle", json={"identifier": identifier})
        assert res.status_code == 200, (identifier, res.text)
        body = res.json()
        assert body["vehicle_id"] == v.internal_id and body["fare_uzs"] == 2500
        assert " " not in body["driver_name"]  # passengers only see the first name
    assert client.post("/api/v1/payments/resolve-vehicle", json={"identifier": "NOPE-000"}).status_code == 404


def test_ride_payment_moves_money_both_sides_and_is_idempotent(client, db, fleet):
    key = uuid.uuid4().hex
    res = _pay(client, fleet["client"], fleet["vehicle"].internal_id, key, "qr")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["amount_uzs"] == 2500 and body["balance_after_uzs"] == 7500 and body["reference"].startswith("PAY-")

    replay = _pay(client, fleet["client"], fleet["vehicle"].internal_id, key, "qr")
    assert replay.status_code == 201 and replay.json()["payment_id"] == body["payment_id"]
    assert _balance(db, fleet["client"]) == 7500
    assert _balance(db, fleet["driver_user"]) == 2500

    # Driver sees it; other drivers do not
    own = client.get("/api/v1/driver/payments", headers=auth(fleet["driver_user"])).json()
    assert [p["id"] for p in own] == [body["payment_id"]] and own[0]["refundable"] is True
    assert own[0]["passenger_label"].startswith("Mijoz #")
    _, _, _ = make_driver(db, fleet["u"], fleet["route"])
    other_user = make_driver(db, fleet["u"], fleet["route"])[0]
    assert client.get("/api/v1/driver/payments", headers=auth(other_user)).json() == []

    history = client.get("/api/v1/payments/my", headers=auth(fleet["client"])).json()
    assert history[0]["reference"] == body["reference"]
    tx = client.get("/api/v1/wallet/transactions", headers=auth(fleet["client"])).json()
    assert tx[0]["entry_type"] == "ride_payment" and tx[0]["amount_uzs"] == -2500


def test_payment_rejections(client, db, fleet):
    poor = make_user(db, "client")
    res = _pay(client, poor, fleet["vehicle"].internal_id)
    assert res.status_code == 402

    no_fare_u = make_uyushma(db)
    _, _, lonely_vehicle = make_driver(db, no_fare_u, make_route(db, no_fare_u))
    assert _pay(client, fleet["client"], lonely_vehicle.internal_id).status_code == 409

    no_key = client.post("/api/v1/payments/pay", headers=auth(fleet["client"]), json={"identifier": fleet["vehicle"].internal_id})
    assert no_key.status_code == 422

    update_settings(db, {"maintenance_mode": True}, super_admin(db))
    db.commit()
    try:
        assert _pay(client, fleet["client"], fleet["vehicle"].internal_id).status_code == 503
    finally:
        update_settings(db, {"maintenance_mode": False}, super_admin(db))
        db.commit()


def test_driver_refund_rules(client, db, fleet):
    p1 = _pay(client, fleet["client"], fleet["vehicle"].internal_id).json()
    headers = auth(fleet["driver_user"])

    assert client.post(f"/api/v1/driver/payments/{p1['payment_id']}/refund", headers=headers, json={"reason": "x"}).status_code == 422
    other_user = make_driver(db, fleet["u"], fleet["route"])[0]
    assert client.post(f"/api/v1/driver/payments/{p1['payment_id']}/refund", headers=auth(other_user),
                       json={"reason": "Adashib to'ladi"}).status_code == 404

    ok = client.post(f"/api/v1/driver/payments/{p1['payment_id']}/refund", headers=headers, json={"reason": "Adashib to'ladi"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "refunded" and ok.json()["refund_reason"] == "Adashib to'ladi"
    assert _balance(db, fleet["client"]) == 10_000 and _balance(db, fleet["driver_user"]) == 0
    assert client.post(f"/api/v1/driver/payments/{p1['payment_id']}/refund", headers=headers,
                       json={"reason": "yana"}).status_code == 409

    # Outside the refund window
    p2 = _pay(client, fleet["client"], fleet["vehicle"].internal_id).json()
    payment = db.query(Payment).filter(Payment.id == p2["payment_id"]).one()
    payment.refundable_until = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
    late = client.post(f"/api/v1/driver/payments/{p2['payment_id']}/refund", headers=headers, json={"reason": "Kech qoldi"})
    assert late.status_code == 409

    for w in db.query(Wallet).filter(Wallet.user_id.in_([fleet["client"].id, fleet["driver_user"].id])).all():
        assert ledger_service.reconcile_wallet(db, w).is_consistent


def test_commission_is_withheld_from_driver(client, db, fleet):
    update_settings(db, {"platform_commission_percent": 2.0}, super_admin(db))
    db.commit()
    try:
        body = _pay(client, fleet["client"], fleet["vehicle"].internal_id).json()
    finally:
        update_settings(db, {"platform_commission_percent": 0.0}, super_admin(db))
        db.commit()
    assert body["amount_uzs"] == 2500
    assert _balance(db, fleet["driver_user"]) == 2450
