"""
Money paths under concurrency.

Every one of these hit a real defect before: a sandbox top-up could be credited several times,
duplicate refunds/cash-outs returned 500 instead of a clean 409, and a driver could reserve more
than their balance by firing cash-out requests in parallel.
"""
import uuid
from concurrent.futures import ThreadPoolExecutor

from app.models.finance import CashoutRequest, Wallet, WalletTransaction
from app.services import ledger_service
from tests.factories import auth, fund_client, make_driver, make_fare, make_route, make_user, make_uyushma, super_admin


def _parallel(fn, times: int):
    """Run `fn` concurrently. Callers must resolve ORM attributes first: a Session is not
    thread-safe, and a lazy refresh from several threads fails on its own."""
    with ThreadPoolExecutor(max_workers=times) as pool:
        return [f.result() for f in [pool.submit(fn, i) for i in range(times)]]


def _balance(db, user_id: int) -> int:
    db.expire_all()
    return int(db.query(Wallet.balance_uzs).filter(Wallet.user_id == user_id).scalar() or 0)


def test_sandbox_topup_credits_once_under_concurrency(client, db):
    user = make_user(db, "client")
    user_id = user.id
    headers = auth(user)
    before = _balance(db, user_id)
    order = client.post("/api/v1/wallet/topup", headers=headers, json={"amount_uzs": 10_000, "provider": "click"})
    assert order.status_code == 201, order.text
    topup_id = order.json()["id"]

    results = _parallel(lambda _: client.post(f"/api/v1/wallet/topup/{topup_id}/sandbox-complete", headers=headers), 5)
    assert sum(1 for r in results if r.status_code == 200) >= 1
    assert all(r.status_code in (200, 409) for r in results), [r.status_code for r in results]
    assert _balance(db, user_id) == before + 10_000

    credits = (
        db.query(WalletTransaction)
        .filter(WalletTransaction.reference_id == order.json()["merchant_trans_id"], WalletTransaction.entry_type == "topup")
        .count()
    )
    assert credits == 1


def _paid_ride(client, db, uyushma, route):
    driver_user, driver, vehicle = make_driver(db, uyushma, route)
    make_fare(db, uyushma, 2500)
    passenger = make_user(db, "client")
    fund_client(db, passenger, 10_000)
    client.post("/api/v1/driver/shift/start", headers=auth(driver_user), json={"direction": "outbound"})
    payment = client.post(
        "/api/v1/payments/pay",
        headers={**auth(passenger), "Idempotency-Key": str(uuid.uuid4())},
        json={"identifier": vehicle.internal_id, "method": "qr"},
    )
    assert payment.status_code in (200, 201), payment.text
    return driver_user, driver, payment.json()


def test_duplicate_refund_answers_409_not_500(client, db):
    uyushma = make_uyushma(db)
    route = make_route(db, uyushma)
    driver_user, driver, payment = _paid_ride(client, db, uyushma, route)
    driver_headers, payment_id = auth(driver_user), payment["payment_id"]
    try:
        results = _parallel(
            lambda _: client.post(
                f"/api/v1/driver/payments/{payment_id}/refund",
                headers=driver_headers,
                json={"reason": "Bir vaqtda qaytarish"},
            ),
            4,
        )
        codes = sorted(r.status_code for r in results)
        assert codes.count(200) == 1, codes
        assert all(code in (200, 409) for code in codes), codes
        refund_entries = (
            db.query(WalletTransaction)
            .filter(WalletTransaction.idempotency_key.in_([f"refund:{payment['payment_id']}:credit", f"refund:{payment['payment_id']}:debit"]))
            .count()
        )
        assert refund_entries <= 2
    finally:
        client.post("/api/v1/driver/shift/end", headers=driver_headers)


def test_cashout_cannot_reserve_more_than_the_balance(client, db):
    uyushma = make_uyushma(db)
    route = make_route(db, uyushma)
    driver_user, driver, _ = _paid_ride(client, db, uyushma, route)
    driver_headers, driver_id = auth(driver_user), driver.id
    try:
        available = client.get("/api/v1/driver/balance", headers=driver_headers).json()["available_balance"]
        assert available > 0
        results = _parallel(
            lambda i: client.post(
                "/api/v1/driver/cashouts",
                headers={**driver_headers, "Idempotency-Key": f"race-{uuid.uuid4()}"},
                json={"amount_uzs": available, "method": "cash"},
            ),
            5,
        )
        created = [r for r in results if r.status_code == 201]
        assert len(created) == 1, [r.status_code for r in results]
        assert all(r.status_code in (201, 409) for r in results)
        reserved = sum(
            c.amount_uzs
            for c in db.query(CashoutRequest).filter(CashoutRequest.driver_id == driver_id, CashoutRequest.status.in_(("pending", "approved"))).all()
        )
        assert reserved <= available
    finally:
        client.post("/api/v1/driver/shift/end", headers=driver_headers)


def test_wallet_adjustment_with_one_key_is_applied_once(client, db):
    admin_headers = auth(super_admin(db))
    user = make_user(db, "client")
    user_id = user.id
    before = _balance(db, user_id)
    key = f"adj-{uuid.uuid4()}"
    results = _parallel(
        lambda _: client.post(
            f"/api/v1/admin/wallets/{user_id}/adjust",
            headers={**admin_headers, "Idempotency-Key": key},
            json={"amount_uzs": 5_000, "reason": "Bir vaqtda tuzatish"},
        ),
        5,
    )
    assert all(r.status_code == 200 for r in results), [r.status_code for r in results]
    assert len({r.json()["id"] for r in results}) == 1
    assert _balance(db, user_id) == before + 5_000


def test_ledger_stays_consistent_after_the_races(client, db):
    health = client.get("/api/v1/admin/ledger/health", headers=auth(super_admin(db)))
    assert health.status_code == 200
    assert health.json()["inconsistent_wallets"] == []
    assert ledger_service is not None
