import hashlib
import logging
import uuid
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.finance import Wallet, WalletTransaction
from app.services.payment.providers.base import BasePaymentProvider
from app.services.wallet.ledger_service import wallet_ledger_service

logger = logging.getLogger(__name__)


# Click Merchant Error Codes
CLICK_SUCCESS = 0
CLICK_ERROR_SIGN_CHECK = -1
CLICK_ERROR_INVALID_AMOUNT = -2
CLICK_ERROR_ACTION_NOT_FOUND = -3
CLICK_ERROR_ALREADY_PAID = -4
CLICK_ERROR_USER_NOT_FOUND = -5
CLICK_ERROR_TRANSACTION_NOT_FOUND = -6
CLICK_ERROR_FAILED_UPDATE = -7
CLICK_ERROR_IN_REQUEST = -8
CLICK_ERROR_CANCELLED = -9


class ClickProviderAdapter(BasePaymentProvider):
    """Click Payment Provider Adapter.

    Implements:
    - Topup payment intent generation with redirect URL
    - MD5 signature generation and validation
    - Prepare (action=0) and Complete (action=1) webhook protocol
    - Strict idempotency protection
    - Status reconciliation
    """

    @property
    def provider_code(self) -> str:
        return "click"

    def _get_secret_key(self) -> str:
        sec = settings.click_secret_key
        if sec and not sec.startswith("placeholder"):
            return sec
        return "click-test-secret-key-123"

    def _get_service_id(self) -> str:
        sid = settings.click_service_id
        if sid and (sid.isdigit() or not sid.startswith("placeholder")):
            return sid
        return "32100"

    def _get_merchant_id(self) -> str:
        mid = settings.click_merchant_id
        if mid and (mid.isdigit() or not mid.startswith("placeholder")):
            return mid
        return "12345"

    def create_topup_intent(
        self,
        wallet_id: int,
        amount_uzs: int,
        return_url: Optional[str] = None,
        db: Optional[Session] = None,
    ) -> Dict[str, Any]:
        """Generate Click topup intent and payment URL."""
        if amount_uzs <= 0:
            raise ValueError("Amount must be greater than 0")

        # Verify wallet exists
        if db is not None:
            wallet = db.query(Wallet).filter(Wallet.id == wallet_id).first()
            if not wallet:
                raise ValueError(f"Wallet #{wallet_id} not found")

        intent_id = str(uuid.uuid4())
        merchant_trans_id = f"wallet_{wallet_id}_{intent_id[:8]}"
        service_id = self._get_service_id()
        merchant_id = self._get_merchant_id()

        ret_url = return_url or "http://localhost:5173/wallet"
        payment_url = (
            f"https://my.click.uz/services/pay"
            f"?service_id={service_id}"
            f"&merchant_id={merchant_id}"
            f"&amount={amount_uzs}"
            f"&transaction_param={merchant_trans_id}"
            f"&return_url={ret_url}"
        )

        return {
            "payment_intent_id": intent_id,
            "wallet_id": wallet_id,
            "amount_uzs": amount_uzs,
            "payment_url": payment_url,
            "service_id": service_id,
            "merchant_trans_id": merchant_trans_id,
        }

    def compute_signature(
        self,
        click_trans_id: Any,
        service_id: Any,
        merchant_trans_id: Any,
        amount: Any,
        action: Any,
        sign_time: Any,
        merchant_prepare_id: Optional[Any] = None,
    ) -> str:
        """Compute expected MD5 signature according to Click specification."""
        secret_key = self._get_secret_key()
        # Click amount format can be float with 2 decimals or int
        amount_str = f"{float(amount):.2f}" if "." in str(amount) else str(amount)

        if int(action) == 0:
            sign_str = (
                f"{click_trans_id}{service_id}{secret_key}"
                f"{merchant_trans_id}{amount_str}{action}{sign_time}"
            )
        else:
            prep_id = "" if merchant_prepare_id is None else str(merchant_prepare_id)
            sign_str = (
                f"{click_trans_id}{service_id}{secret_key}"
                f"{merchant_trans_id}{prep_id}{amount_str}{action}{sign_time}"
            )

        return hashlib.md5(sign_str.encode("utf-8")).hexdigest()

    def validate_signature(self, payload: Dict[str, Any]) -> bool:
        """Validate Click request signature."""
        provided_sign = str(payload.get("sign_string", "")).lower()
        if not provided_sign:
            return False

        # Support amount passed as float or formatted string
        expected_sign_1 = self.compute_signature(
            click_trans_id=payload.get("click_trans_id"),
            service_id=payload.get("service_id"),
            merchant_trans_id=payload.get("merchant_trans_id"),
            amount=payload.get("amount"),
            action=payload.get("action"),
            sign_time=payload.get("sign_time"),
            merchant_prepare_id=payload.get("merchant_prepare_id"),
        ).lower()

        # Alternate format: without decimal point if integer
        raw_amt = payload.get("amount")
        try:
            int_amt = int(float(raw_amt))
            secret_key = self._get_secret_key()
            if int(payload.get("action", 0)) == 0:
                alt_str = (
                    f"{payload.get('click_trans_id')}{payload.get('service_id')}{secret_key}"
                    f"{payload.get('merchant_trans_id')}{int_amt}{payload.get('action')}{payload.get('sign_time')}"
                )
            else:
                prep = payload.get("merchant_prepare_id") or ""
                alt_str = (
                    f"{payload.get('click_trans_id')}{payload.get('service_id')}{secret_key}"
                    f"{payload.get('merchant_trans_id')}{prep}{int_amt}{payload.get('action')}{payload.get('sign_time')}"
                )
            expected_sign_2 = hashlib.md5(alt_str.encode("utf-8")).hexdigest().lower()
        except Exception:
            expected_sign_2 = ""

        return provided_sign in (expected_sign_1, expected_sign_2)

    def _parse_wallet_id(self, merchant_trans_id: str, db: Session) -> Optional[int]:
        """Extract wallet_id from transaction reference string (e.g. wallet_12_abcd or '12')."""
        if not merchant_trans_id:
            return None
        parts = merchant_trans_id.split("_")
        if len(parts) >= 2 and parts[0] == "wallet":
            try:
                return int(parts[1])
            except ValueError:
                pass
        try:
            return int(merchant_trans_id)
        except ValueError:
            pass
        return None

    def process_webhook(self, payload: Dict[str, Any], db: Session) -> Dict[str, Any]:
        """Process incoming Click webhook for prepare (0) and complete (1) actions."""
        click_trans_id = payload.get("click_trans_id")
        merchant_trans_id = str(payload.get("merchant_trans_id", ""))
        action = int(payload.get("action", 0))
        amount = float(payload.get("amount", 0.0))
        error = int(payload.get("error", 0))

        # 1. Signature Verification
        if not self.validate_signature(payload):
            logger.warning(f"Click webhook signature verification failed for trans #{click_trans_id}")
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": CLICK_ERROR_SIGN_CHECK,
                "error_note": "SIGN CHECK FAILED",
            }

        # 2. Extract and Validate Wallet
        wallet_id = self._parse_wallet_id(merchant_trans_id, db)
        if not wallet_id:
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": CLICK_ERROR_USER_NOT_FOUND,
                "error_note": "User/Wallet identifier invalid",
            }

        wallet = db.query(Wallet).filter(Wallet.id == wallet_id).first()
        if not wallet or not wallet.is_active:
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": CLICK_ERROR_USER_NOT_FOUND,
                "error_note": "Wallet not found or inactive",
            }

        if amount <= 0:
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": CLICK_ERROR_INVALID_AMOUNT,
                "error_note": "Incorrect amount",
            }

        # 3. ACTION 0: PREPARE
        if action == 0:
            prep_id = f"prep_{click_trans_id}"
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "merchant_prepare_id": prep_id,
                "error": CLICK_SUCCESS,
                "error_note": "Success",
            }

        # 4. ACTION 1: COMPLETE
        elif action == 1:
            if error < 0:
                logger.warning(f"Click reported transaction cancellation: error={error}")
                return {
                    "click_trans_id": click_trans_id,
                    "merchant_trans_id": merchant_trans_id,
                    "error": CLICK_ERROR_CANCELLED,
                    "error_note": "Transaction cancelled",
                }

            idempotency_key = f"click_{click_trans_id}"
            conf_id = f"conf_{click_trans_id}"

            # Check if already processed (Idempotency)
            existing_tx = (
                db.query(WalletTransaction)
                .filter(WalletTransaction.idempotency_key == idempotency_key)
                .first()
            )
            if existing_tx:
                logger.info(f"Click trans #{click_trans_id} was already completed. Returning idempotent response.")
                return {
                    "click_trans_id": click_trans_id,
                    "merchant_trans_id": merchant_trans_id,
                    "merchant_confirm_id": conf_id,
                    "error": CLICK_SUCCESS,
                    "error_note": "Already paid",
                }

            # Credit Wallet via WalletLedgerService
            amount_uzs = int(round(amount))
            wallet_ledger_service.credit(
                wallet_id=wallet.id,
                amount_uzs=amount_uzs,
                entry_type="topup",
                idempotency_key=idempotency_key,
                reference_id=str(click_trans_id),
                description=f"Click hisob to'ldirish (Click ID: {click_trans_id})",
                db=db,
            )

            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "merchant_confirm_id": conf_id,
                "error": CLICK_SUCCESS,
                "error_note": "Success",
            }

        else:
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": CLICK_ERROR_ACTION_NOT_FOUND,
                "error_note": f"Action {action} not found",
            }

    def reconcile_status(self, transaction_ref: str, db: Session) -> Dict[str, Any]:
        """Check status of a Click payment in the ledger."""
        # Query by click_trans_id or idempotency_key or reference_id
        tx = (
            db.query(WalletTransaction)
            .filter(
                (WalletTransaction.idempotency_key == f"click_{transaction_ref}")
                | (WalletTransaction.reference_id == str(transaction_ref))
            )
            .first()
        )
        if tx:
            return {
                "status": "completed",
                "transaction_id": tx.id,
                "wallet_id": tx.wallet_id,
                "amount_uzs": tx.amount_uzs,
                "created_at": tx.created_at.isoformat(),
            }
        return {
            "status": "pending_or_not_found",
            "transaction_ref": transaction_ref,
        }
