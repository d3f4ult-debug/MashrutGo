"""
Click (click.uz) SHOP API adapter.

Flow for a wallet top-up:
1. Client calls POST /wallet/topup -> ProviderTransaction(status=created) + checkout URL
   (https://my.click.uz/services/pay?service_id&merchant_id&amount&transaction_param&return_url).
2. Click calls our Prepare webhook (action=0): we verify the MD5 signature, amount and state,
   and answer with merchant_prepare_id.
3. Click calls our Complete webhook (action=1): we verify again and credit the wallet ledger
   exactly once (idempotency key derived from click_trans_id).

Signatures (Click documentation):
  prepare : md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + amount + action + sign_time)
  complete: md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + merchant_prepare_id
                + amount + action + sign_time)
The raw `amount` string exactly as posted by Click is used for the signature.
"""
import hashlib
import hmac
from decimal import Decimal, InvalidOperation
from typing import Mapping, Optional
from urllib.parse import urlencode

from app.core.config import settings
from app.models.finance import ProviderTransaction
from app.services.payments.base import PaymentProvider, register_provider

# Click error codes returned in webhook responses
CLICK_SUCCESS = 0
CLICK_SIGN_FAILED = -1
CLICK_INCORRECT_AMOUNT = -2
CLICK_ACTION_NOT_FOUND = -3
CLICK_ALREADY_PAID = -4
CLICK_ORDER_NOT_FOUND = -5
CLICK_TRANSACTION_NOT_FOUND = -6
CLICK_UPDATE_FAILED = -7
CLICK_BAD_REQUEST = -8
CLICK_TRANSACTION_CANCELLED = -9

ACTION_PREPARE = 0
ACTION_COMPLETE = 1

ERROR_NOTES = {
    CLICK_SUCCESS: "Success",
    CLICK_SIGN_FAILED: "SIGN CHECK FAILED!",
    CLICK_INCORRECT_AMOUNT: "Incorrect parameter amount",
    CLICK_ACTION_NOT_FOUND: "Action not found",
    CLICK_ALREADY_PAID: "Already paid",
    CLICK_ORDER_NOT_FOUND: "Order does not exist",
    CLICK_TRANSACTION_NOT_FOUND: "Transaction does not exist",
    CLICK_UPDATE_FAILED: "Failed to update user",
    CLICK_BAD_REQUEST: "Error in request from click",
    CLICK_TRANSACTION_CANCELLED: "Transaction cancelled",
}


def compute_sign(
    secret_key: str,
    click_trans_id: str,
    service_id: str,
    merchant_trans_id: str,
    amount: str,
    action: str,
    sign_time: str,
    merchant_prepare_id: Optional[str] = None,
) -> str:
    parts = [click_trans_id, service_id, secret_key, merchant_trans_id]
    if merchant_prepare_id is not None:
        parts.append(merchant_prepare_id)
    parts.extend([amount, action, sign_time])
    return hashlib.md5("".join(parts).encode("utf-8")).hexdigest()


def parse_amount(raw: str) -> Optional[Decimal]:
    try:
        value = Decimal(raw)
    except (InvalidOperation, TypeError):
        return None
    return value if value.is_finite() else None


@register_provider
class ClickProvider(PaymentProvider):
    name = "click"

    def __init__(self) -> None:
        self.service_id = settings.click_service_id
        self.merchant_id = settings.click_merchant_id
        self.secret_key = settings.click_secret_key
        self.merchant_user_id = settings.click_merchant_user_id
        self.checkout_url = settings.click_checkout_url

    def is_configured(self) -> bool:
        return settings.click_configured

    def build_checkout_url(self, tx: ProviderTransaction, return_url: str) -> str:
        params = {
            "service_id": self.service_id,
            "merchant_id": self.merchant_id,
            "amount": f"{tx.amount_uzs}",
            "transaction_param": tx.merchant_trans_id,
            "return_url": return_url,
        }
        if self.merchant_user_id and "placeholder" not in self.merchant_user_id.lower():
            params["merchant_user_id"] = self.merchant_user_id
        return f"{self.checkout_url}?{urlencode(params)}"

    def verify_signature(self, form: Mapping[str, str], with_prepare_id: bool) -> bool:
        if not self.is_configured():
            return False
        try:
            expected = compute_sign(
                secret_key=self.secret_key,
                click_trans_id=str(form["click_trans_id"]),
                service_id=str(form["service_id"]),
                merchant_trans_id=str(form["merchant_trans_id"]),
                amount=str(form["amount"]),
                action=str(form["action"]),
                sign_time=str(form["sign_time"]),
                merchant_prepare_id=str(form["merchant_prepare_id"]) if with_prepare_id else None,
            )
        except KeyError:
            return False
        return hmac.compare_digest(expected, str(form.get("sign_string", "")).lower())

    def service_matches(self, form: Mapping[str, str]) -> bool:
        return str(form.get("service_id", "")) == str(self.service_id)
