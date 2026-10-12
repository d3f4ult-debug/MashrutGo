from typing import Dict
from app.services.payment.providers.base import BasePaymentProvider
from app.services.payment.providers.click import ClickProviderAdapter
from app.services.payment.providers.payme import PaymeProviderAdapter
from app.services.payment.providers.uzum import UzumProviderAdapter
from app.services.payment.providers.humo import HumoProviderAdapter


class PaymentProviderRegistry:
    """Registry maintaining active and extension payment providers."""

    def __init__(self):
        self._providers: Dict[str, BasePaymentProvider] = {
            "click": ClickProviderAdapter(),
            "payme": PaymeProviderAdapter(),
            "uzum": UzumProviderAdapter(),
            "humo": HumoProviderAdapter(),
        }

    def get_provider(self, name: str) -> BasePaymentProvider:
        provider = self._providers.get(name.lower())
        if not provider:
            raise ValueError(f"Payment provider '{name}' is not supported")
        return provider

    def register_provider(self, name: str, provider: BasePaymentProvider) -> None:
        self._providers[name.lower()] = provider


payment_registry = PaymentProviderRegistry()
