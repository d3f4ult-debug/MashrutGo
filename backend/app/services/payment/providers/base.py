from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session


class BasePaymentProvider(ABC):
    """Abstract payment provider adapter interface.

    Allows plugging in Click, Payme, Uzum, HUMO, or custom banking providers
    with signature validation, webhook callbacks, idempotency, and status reconciliation.
    """

    @property
    @abstractmethod
    def provider_code(self) -> str:
        """Provider code ('click', 'payme', 'uzum', 'humo')."""
        pass

    @abstractmethod
    def create_topup_intent(
        self,
        wallet_id: int,
        amount_uzs: int,
        return_url: Optional[str] = None,
        db: Optional[Session] = None,
    ) -> Dict[str, Any]:
        """Generate checkout intent details and payment redirect URL."""
        pass

    @abstractmethod
    def validate_signature(self, payload: Dict[str, Any]) -> bool:
        """Verify authenticity of webhook payload signature."""
        pass

    @abstractmethod
    def process_webhook(self, payload: Dict[str, Any], db: Session) -> Dict[str, Any]:
        """Process provider webhook, update ledger, and handle idempotency."""
        pass

    @abstractmethod
    def reconcile_status(self, transaction_ref: str, db: Session) -> Dict[str, Any]:
        """Query and reconcile transaction status."""
        pass
