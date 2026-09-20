"""Wallet top-up through external providers (Click first)."""
import logging
import secrets
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Mapping, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.finance import ProviderTransaction, Wallet
from app.models.user import User
from app.services import ledger_service
from app.services.audit_service import record_audit_event
from app.services.payments.click_provider import (
    ACTION_COMPLETE,
    ACTION_PREPARE,
    CLICK_ACTION_NOT_FOUND,
    CLICK_ALREADY_PAID,
    CLICK_BAD_REQUEST,
    CLICK_INCORRECT_AMOUNT,
    CLICK_ORDER_NOT_FOUND,
    CLICK_SIGN_FAILED,
    CLICK_SUCCESS,
    CLICK_TRANSACTION_CANCELLED,
    CLICK_TRANSACTION_NOT_FOUND,
    CLICK_UPDATE_FAILED,
    ERROR_NOTES,
    ClickProvider,
    parse_amount,
)

logger = logging.getLogger(__name__)


class TopupError(Exception):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_merchant_trans_id() -> str:
    return f"TOP{secrets.token_hex(6).upper()}"


def create_topup(db: Session, user: User, amount_uzs: int, sandbox: bool) -> ProviderTransaction:
    wallet = ledger_service.get_or_create_wallet(db, user)
    tx = ProviderTransaction(
        provider="click",
        purpose="wallet_topup",
        merchant_trans_id=new_merchant_trans_id(),
        user_id=user.id,
        wallet_id=wallet.id,
        amount_uzs=amount_uzs,
        status="created",
        is_sandbox=sandbox,
    )
    db.add(tx)
    db.flush()
    return tx


def _response(form: Mapping[str, Any], error: int, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "click_trans_id": form.get("click_trans_id"),
        "merchant_trans_id": form.get("merchant_trans_id"),
        "error": error,
        "error_note": ERROR_NOTES.get(error, "Error"),
    }
    if extra:
        body.update(extra)
    return body


def _load_tx(db: Session, merchant_trans_id: str) -> Optional[ProviderTransaction]:
    return (
        db.query(ProviderTransaction)
        .filter(ProviderTransaction.provider == "click", ProviderTransaction.merchant_trans_id == merchant_trans_id)
        .first()
    )


def _amount_matches(tx: ProviderTransaction, raw_amount: str) -> bool:
    amount = parse_amount(raw_amount)
    return amount is not None and amount == Decimal(tx.amount_uzs)


def _apply_prepare(db: Session, tx: ProviderTransaction, form: Mapping[str, Any]) -> Dict[str, Any]:
    if tx.status == "completed":
        return _response(form, CLICK_ALREADY_PAID)
    if tx.status in ("cancelled", "failed"):
        return _response(form, CLICK_TRANSACTION_CANCELLED)
    if not _amount_matches(tx, str(form.get("amount"))):
        return _response(form, CLICK_INCORRECT_AMOUNT)

    click_trans_id = str(form.get("click_trans_id"))
    if tx.provider_trans_id and tx.provider_trans_id != click_trans_id:
        # A different Click transaction already prepared this order
        return _response(form, CLICK_ALREADY_PAID)

    reused = (
        db.query(ProviderTransaction.id)
        .filter(
            ProviderTransaction.provider == "click",
            ProviderTransaction.provider_trans_id == click_trans_id,
            ProviderTransaction.id != tx.id,
        )
        .first()
    )
    if reused:
        return _response(form, CLICK_BAD_REQUEST)

    tx.provider_trans_id = click_trans_id
    tx.provider_paydoc_id = str(form.get("click_paydoc_id") or "") or None
    tx.status = "prepared"
    tx.prepared_at = tx.prepared_at or _utcnow()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return _response(form, CLICK_BAD_REQUEST)
    return _response(form, CLICK_SUCCESS, {"merchant_prepare_id": tx.id})


def _apply_complete(db: Session, tx: ProviderTransaction, form: Mapping[str, Any]) -> Dict[str, Any]:
    click_trans_id = str(form.get("click_trans_id"))
    try:
        prepare_id = int(form.get("merchant_prepare_id"))
    except (TypeError, ValueError):
        return _response(form, CLICK_TRANSACTION_NOT_FOUND)
    if prepare_id != tx.id or tx.provider_trans_id != click_trans_id:
        return _response(form, CLICK_TRANSACTION_NOT_FOUND)
    if tx.status == "completed":
        return _response(form, CLICK_ALREADY_PAID, {"merchant_confirm_id": tx.id})
    if tx.status in ("cancelled", "failed"):
        return _response(form, CLICK_TRANSACTION_CANCELLED)
    if not _amount_matches(tx, str(form.get("amount"))):
        return _response(form, CLICK_INCORRECT_AMOUNT)

    try:
        click_error = int(form.get("error", 0))
    except (TypeError, ValueError):
        click_error = 0
    if click_error < 0:
        # Click reports the payment failed on its side (e.g. card declined)
        tx.status = "cancelled"
        tx.error_code = click_error
        tx.error_note = str(form.get("error_note") or "")[:255]
        db.commit()
        return _response(form, CLICK_TRANSACTION_CANCELLED)

    wallet = db.query(Wallet).filter(Wallet.id == tx.wallet_id).first()
    if wallet is None:
        return _response(form, CLICK_ORDER_NOT_FOUND)

    # Claim the order before crediting: concurrent callbacks for the same order lose the race here
    claimed = (
        db.query(ProviderTransaction)
        .filter(ProviderTransaction.id == tx.id, ProviderTransaction.status != "completed")
        .update({"status": "completing"}, synchronize_session=False)
    )
    if not claimed:
        db.rollback()
        db.refresh(tx)
        return _response(form, CLICK_ALREADY_PAID, {"merchant_confirm_id": tx.id})

    try:
        ledger_service.post_entry(
            db,
            wallet,
            entry_type="topup",
            amount_uzs=tx.amount_uzs,
            description=f"Click orqali to'ldirish ({tx.merchant_trans_id})" + (" [sandbox]" if tx.is_sandbox else ""),
            idempotency_key=f"click:{click_trans_id}:complete",
            reference_type="provider_transaction",
            reference_id=tx.merchant_trans_id,
        )
        tx.status = "completed"
        tx.completed_at = _utcnow()
        record_audit_event(
            db,
            action="wallet.topup.completed",
            actor_user_id=tx.user_id,
            target_type="provider_transaction",
            target_id=tx.merchant_trans_id,
            changes={"amount_uzs": tx.amount_uzs, "provider": "click", "sandbox": tx.is_sandbox},
        )
        db.commit()
    except (IntegrityError, ledger_service.LedgerError):
        db.rollback()
        logger.exception("Click complete failed for %s", tx.merchant_trans_id)
        return _response(form, CLICK_UPDATE_FAILED)
    return _response(form, CLICK_SUCCESS, {"merchant_confirm_id": tx.id})


def handle_click_webhook(db: Session, form: Mapping[str, Any], expected_action: int) -> Dict[str, Any]:
    """Validate and apply a Click Prepare/Complete callback. Always returns a Click-shaped body."""
    required = ("click_trans_id", "service_id", "merchant_trans_id", "amount", "action", "sign_time", "sign_string")
    if any(form.get(k) in (None, "") for k in required):
        return _response(form, CLICK_BAD_REQUEST)
    try:
        action = int(form["action"])
    except (TypeError, ValueError):
        return _response(form, CLICK_ACTION_NOT_FOUND)
    if action != expected_action:
        return _response(form, CLICK_ACTION_NOT_FOUND)

    provider = ClickProvider()
    if not provider.service_matches(form) or not provider.verify_signature(form, with_prepare_id=action == ACTION_COMPLETE):
        logger.warning("Click signature check failed for merchant_trans_id=%s", form.get("merchant_trans_id"))
        return _response(form, CLICK_SIGN_FAILED)

    tx = _load_tx(db, str(form["merchant_trans_id"]))
    if tx is None:
        return _response(form, CLICK_ORDER_NOT_FOUND)
    if tx.is_sandbox:
        # Sandbox orders can only be finished through the internal sandbox path
        return _response(form, CLICK_ORDER_NOT_FOUND)

    if action == ACTION_PREPARE:
        return _apply_prepare(db, tx, form)
    return _apply_complete(db, tx, form)


def sandbox_complete(db: Session, tx: ProviderTransaction) -> ProviderTransaction:
    """
    Development-only: drive a sandbox order through the same prepare/complete state machine
    (without Click's network signature, which only real Click can produce).
    """
    if not settings.sandbox_payments_enabled or not tx.is_sandbox:
        raise TopupError("Sandbox payments are disabled")
    # Deterministic per order: the wallet_transactions unique index then rejects concurrent
    # repeats of the same sandbox order (a random id per call would mint money under a race).
    click_trans_id = f"SBX{tx.id}"
    base = {
        "click_trans_id": click_trans_id,
        "click_paydoc_id": click_trans_id,
        "merchant_trans_id": tx.merchant_trans_id,
        "amount": str(tx.amount_uzs),
        "error": "0",
    }
    prep = _apply_prepare(db, tx, {**base, "action": str(ACTION_PREPARE)})
    if prep["error"] not in (CLICK_SUCCESS,):
        raise TopupError(prep["error_note"])
    done = _apply_complete(db, tx, {**base, "action": str(ACTION_COMPLETE), "merchant_prepare_id": str(tx.id)})
    if done["error"] != CLICK_SUCCESS:
        raise TopupError(done["error_note"])
    db.refresh(tx)
    return tx
