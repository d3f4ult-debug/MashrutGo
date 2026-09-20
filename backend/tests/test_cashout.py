import uuid

from app.models.finance import Wallet
from tests.factories import auth, fund_client, make_driver, make_fare, make_route, make_user, make_uyushma


def _setup(client, db, rides=4):
    u = make_uyushma(db)
    route = make_route(db, u)
    make_fare(db, u, 2500)
    driver_user, driver, vehicle = make_driver(db, u, route)
    passenger = make_user(db, "client")
    fund_client(db, passenger, 50_000)
    for _ in range(rides):
        res = client.post("/api/v1/payments/pay", headers={**auth(passenger), "Idempotency-Key": uuid.uuid4().hex},
                          json={"identifier": vehicle.internal_id})
        assert res.status_code == 201
    admin = make_user(db, "uyushma_admin", u.id)
    return u, driver_user, admin


def test_cashout_request_approve_and_mark_paid(client, db):
    u, driver_user, admin = _setup(client, db)
    d_headers, a_headers = auth(driver_user), auth(admin)

    balance = client.get("/api/v1/driver/balance", headers=d_headers).json()
    assert balance["available_balance"] == 10_000 and balance["rides_count_today"] == 4

    assert client.post("/api/v1/driver/cashouts", headers=d_headers, json={"amount_uzs": 20_000}).status_code == 409
    key = uuid.uuid4().hex
    req = client.post("/api/v1/driver/cashouts", headers={**d_headers, "Idempotency-Key": key},
                      json={"amount_uzs": 6_000, "method": "cash"})
    assert req.status_code == 201, req.text
    replay = client.post("/api/v1/driver/cashouts", headers={**d_headers, "Idempotency-Key": key},
                         json={"amount_uzs": 6_000, "method": "cash"})
    assert replay.json()["id"] == req.json()["id"]
    cid = req.json()["id"]

    reserved = client.get("/api/v1/driver/balance", headers=d_headers).json()
    assert reserved["available_balance"] == 4_000 and reserved["pending_cashout"] == 6_000
    assert client.post("/api/v1/driver/cashouts", headers=d_headers, json={"amount_uzs": 5_000}).status_code == 409

    # Must be approved before paid
    assert client.post(f"/api/v1/uyushma/{u.id}/cashouts/{cid}/mark-paid", headers=a_headers,
                       json={"payment_reference": "KASSA-1"}).status_code == 409
    approved = client.post(f"/api/v1/uyushma/{u.id}/cashouts/{cid}/approve", headers=a_headers)
    assert approved.status_code == 200 and approved.json()["status"] == "approved"
    paid = client.post(f"/api/v1/uyushma/{u.id}/cashouts/{cid}/mark-paid", headers=a_headers, json={"payment_reference": "KASSA-1"})
    assert paid.status_code == 200 and paid.json()["status"] == "paid" and paid.json()["processed_by"]

    db.expire_all()
    assert db.query(Wallet).filter(Wallet.user_id == driver_user.id).one().balance_uzs == 4_000
    ledger = client.get("/api/v1/driver/ledger", headers=d_headers).json()
    assert ledger[0]["entry_type"] == "cashout" and ledger[0]["amount_uzs"] == -6_000
    # Idempotent mark-paid never double-debits
    client.post(f"/api/v1/uyushma/{u.id}/cashouts/{cid}/mark-paid", headers=a_headers, json={"payment_reference": "KASSA-1"})
    db.expire_all()
    assert db.query(Wallet).filter(Wallet.user_id == driver_user.id).one().balance_uzs == 4_000


def test_cashout_reject_requires_reason_and_releases_reservation(client, db):
    u, driver_user, admin = _setup(client, db, rides=2)
    cid = client.post("/api/v1/driver/cashouts", headers=auth(driver_user), json={"amount_uzs": 5_000}).json()["id"]
    assert client.post(f"/api/v1/uyushma/{u.id}/cashouts/{cid}/reject", headers=auth(admin), json={"reason": ""}).status_code == 422
    rejected = client.post(f"/api/v1/uyushma/{u.id}/cashouts/{cid}/reject", headers=auth(admin),
                           json={"reason": "Karta egasi mos emas"})
    assert rejected.status_code == 200 and rejected.json()["rejection_reason"] == "Karta egasi mos emas"
    assert client.get("/api/v1/driver/balance", headers=auth(driver_user)).json()["available_balance"] == 5_000
    # Another tenant cannot touch it
    foreign_admin = make_user(db, "uyushma_admin", make_uyushma(db).id)
    assert client.post(f"/api/v1/uyushma/{u.id}/cashouts/{cid}/approve", headers=auth(foreign_admin)).status_code == 403


def test_uyushma_finance_views(client, db):
    u, driver_user, admin = _setup(client, db, rides=3)
    headers = auth(admin)
    page = client.get(f"/api/v1/uyushma/{u.id}/payments?size=2", headers=headers).json()
    assert page["total"] == 3 and len(page["items"]) == 2 and page["pages"] == 2
    assert page["items"][0]["driver_name"] == driver_user.full_name
    summary = client.get(f"/api/v1/uyushma/{u.id}/finance/summary", headers=headers).json()
    assert summary["gross_revenue"] == 7_500 and summary["completed_rides_count"] == 3
    kpis = client.get(f"/api/v1/uyushma/{u.id}/kpis", headers=headers).json()
    assert kpis["today_payments_total"] == 7_500 and kpis["today_payments_count"] == 3
