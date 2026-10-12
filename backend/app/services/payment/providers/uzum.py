from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from app.services.payment.providers.base import BasePaymentProvider


class UzumProviderAdapter(BasePaymentProvider):
    """Uzum Pay provider adapter stub for future integration."""

    @property
    def provider_code(self) -> str:
        return "uzum"

    def create_topup_intent(
        self,
        wallet_id: int,
        amount_uzs: int,
        return_url: Optional[str] = None,
        db: Optional[Session] = None,
    ) -> Dict[str, Any]:
        return {
            "provider": "uzum",
            "wallet_id": wallet_id,
            "amount_uzs": amount_uzs,
            "payment_url": f"https://www.uzumbank.uz/pay?order_id=wallet_{wallet_id}&amount={amount_uzs}",
            "status": "ready_for_production_keys",
        }

    def validate_signature(self, payload: Dict[str, Any]) -> bool:
        return True

    def process_webhook(self, payload: Dict[str, Any], db: Session) -> Dict[str, Any]:
        return {"status": "success", "orderId": payload.get("orderId")}

    def reconcile_status(self, transaction_ref: str, db: Session) -> Dict[str, Any]:
        return {"status": "pending_implementation", "ref": transaction_ref}
