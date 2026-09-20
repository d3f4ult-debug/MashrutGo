import hashlib

import pytest

from app.core.config import settings
from app.models.finance import ProviderTransaction, Wallet
from app.services.payments.topup_service import create_topup
from tests.factories import auth, make_user

SECRET = "test-click-secret"


@pytest.fixture
def click_configured(monkeypatch):
    monkeypatch.setattr(settings, "click_service_id", "1001")
    monkeypatch.setattr(settings, "click_merchant_id", "2002")
    monkeypatch.setattr(settings, "click_secret_key", SECRET)


def _sign(form: dict, with_prepare: bool) -> str:
    parts = [form["click_trans_id"], form["service_id"], SECRET, form["merchant_trans_id"]]
    if with_prepare:
        parts.append(form["merchant_prepare_id"])
    parts += [form["amount"], form["action"], form["sign_time"]]
    return hashlib.md5("".join(parts).encode()).hexdigest()


def _form(tx: ProviderTransaction, action: int, click_trans_id=None, amount=None, prepare_id=None, error="0"):
    click_trans_id = click_trans_id or f"77{tx.id:06d}"
    form = {
        "click_trans_id": click_trans_id, "service_id": "1001", "click_paydoc_id": "9001",
        "merchant_trans_id": tx.merchant_trans_id, "amount": amount or f"{tx.amount_uzs}.00",
        "action": str(action), "error": error, "error_note": "Success", "sign_time": "2026-09-19 10:00:00",
    }
    if prepare_id is not None:
        form["merchant_prepare_id"] = str(prepare_id)
    form["sign_string"] = _sign(form, prepare_id is not None)
    return form


def _balance(db, user):
    db.expire_all()
    return db.query(Wallet).filter(Wallet.user_id == user.id).one().balance_uzs


def test_topup_creates_click_checkout_url(client, db, click_configured):
    user = make_user(db, "client")
    res = client.post("/api/v1/wallet/topup", headers=auth(user), json={"amount_uzs": 10_000})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "created" and body["is_sandbox"] is False
    assert body["checkout_url"].startswith("https://my.click.uz/services/pay?service_id=1001&merchant_id=2002&amount=10000")
    assert f"transaction_param={body['merchant_trans_id']}" in body["checkout_url"]
    assert client.post("/api/v1/wallet/topup", headers=auth(user), json={"amount_uzs": 10}).status_code == 422


def test_click_prepare_complete_credits_wallet_once(client, db, click_configured):
    user = make_user(db, "client")
    tx = create_topup(db, user, 15_000, sandbox=False)
    db.commit()

    prep = client.post("/api/v1/payments/webhook/click/prepare", data=_form(tx, 0)).json()
    assert prep["error"] == 0 and prep["merchant_prepare_id"] == tx.id
    done = client.post("/api/v1/payments/webhook/click/complete", data=_form(tx, 1, prepare_id=tx.id)).json()
    assert done["error"] == 0 and done["merchant_confirm_id"] == tx.id
    assert _balance(db, user) == 15_000

    again = client.post("/api/v1/payments/webhook/click/complete", data=_form(tx, 1, prepare_id=tx.id)).json()
    assert again["error"] == -4
    # A second order cannot reuse the same Click transaction id
    other = create_topup(db, user, 1_000, sandbox=False)
    db.commit()
    stolen = client.post("/api/v1/payments/webhook/click/prepare", data=_form(other, 0, click_trans_id=f"77{tx.id:06d}", amount="1000")).json()
    assert stolen["error"] == -8
    assert _balance(db, user) == 15_000
    status = client.get(f"/api/v1/wallet/topup/{tx.id}", headers=auth(user)).json()
    assert status["status"] == "completed"


def test_click_rejects_bad_signature_amount_and_unknown_order(client, db, click_configured):
    user = make_user(db, "client")
    tx = create_topup(db, user, 5_000, sandbox=False)
    db.commit()
    forged = _form(tx, 0)
    forged["sign_string"] = "0" * 32
    assert client.post("/api/v1/payments/webhook/click/prepare", data=forged).json()["error"] == -1
    assert client.post("/api/v1/payments/webhook/click/prepare", data=_form(tx, 0, amount="1.00")).json()["error"] == -2
    unknown = _form(tx, 0)
    unknown["merchant_trans_id"] = "TOPUNKNOWN"
    unknown["sign_string"] = _sign(unknown, False)
    assert client.post("/api/v1/payments/webhook/click/prepare", data=unknown).json()["error"] == -5
    assert client.post("/api/v1/payments/webhook/click/prepare", data=_form(tx, 1)).json()["error"] == -3
    assert client.post("/api/v1/payments/webhook/click/prepare", data={"foo": "bar"}).json()["error"] == -8
    assert _balance(db, user) == 0


def test_click_failed_payment_cancels_order(client, db, click_configured):
    user = make_user(db, "client")
    tx = create_topup(db, user, 5_000, sandbox=False)
    db.commit()
    client.post("/api/v1/payments/webhook/click/prepare", data=_form(tx, 0))
    res = client.post("/api/v1/payments/webhook/click/complete", data=_form(tx, 1, prepare_id=tx.id, error="-5017")).json()
    assert res["error"] == -9
    db.refresh(tx)
    assert tx.status == "cancelled" and _balance(db, user) == 0


def test_webhook_refuses_when_click_not_configured(client, db):
    user = make_user(db, "client")
    tx = create_topup(db, user, 5_000, sandbox=False)
    db.commit()
    assert client.post("/api/v1/payments/webhook/click/prepare", data=_form(tx, 0)).json()["error"] == -1


def test_sandbox_topup_flow_only_outside_production(client, db, monkeypatch):
    user = make_user(db, "client")
    created = client.post("/api/v1/wallet/topup", headers=auth(user), json={"amount_uzs": 20_000}).json()
    assert created["is_sandbox"] is True and created["checkout_url"] is None
    done = client.post(f"/api/v1/wallet/topup/{created['id']}/sandbox-complete", headers=auth(user))
    assert done.status_code == 200 and done.json()["status"] == "completed"
    assert _balance(db, user) == 20_000
    assert client.post(f"/api/v1/wallet/topup/{created['id']}/sandbox-complete", headers=auth(user)).status_code == 409

    monkeypatch.setattr(settings, "app_env", "production")
    assert client.post("/api/v1/wallet/topup", headers=auth(user), json={"amount_uzs": 20_000}).status_code == 503
