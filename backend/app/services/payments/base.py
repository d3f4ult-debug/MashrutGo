"""Payment provider abstraction. Click is implemented first; Payme/Uzum/HUMO plug in here."""
import abc
from typing import Dict, Type

from app.models.finance import ProviderTransaction


class ProviderNotConfiguredError(Exception):
    """Raised when a provider is selected but its merchant credentials are missing."""


class PaymentProvider(abc.ABC):
    name: str = ""

    @abc.abstractmethod
    def is_configured(self) -> bool:
        """True when merchant credentials are present."""

    @abc.abstractmethod
    def build_checkout_url(self, tx: ProviderTransaction, return_url: str) -> str:
        """URL the client opens to pay `tx.amount_uzs` for `tx.merchant_trans_id`."""


_REGISTRY: Dict[str, Type[PaymentProvider]] = {}


def register_provider(cls: Type[PaymentProvider]) -> Type[PaymentProvider]:
    _REGISTRY[cls.name] = cls
    return cls


def get_provider(name: str) -> PaymentProvider:
    try:
        return _REGISTRY[name]()
    except KeyError as exc:
        raise ProviderNotConfiguredError(f"Payment provider '{name}' is not supported") from exc


def supported_providers() -> list[str]:
    return sorted(_REGISTRY.keys())
