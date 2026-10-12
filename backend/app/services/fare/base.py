from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session


@dataclass
class FareCalculationResult:
    amount_uzs: int
    rule_type: str = "fixed"
    rule_id: Optional[int] = None
    currency: str = "UZS"
    breakdown: Dict[str, Any] = field(default_factory=dict)


class BaseFareEngine(ABC):
    """Abstract interface for fare calculation engine.

    Designed for extension: MVP 'fixed', with support for 'distance', 'zone', and 'custom' engines.
    """

    @abstractmethod
    def calculate_fare(
        self,
        route_id: Optional[int] = None,
        uyushma_id: Optional[int] = None,
        distance_km: Optional[float] = None,
        zone: Optional[str] = None,
        db: Optional[Session] = None,
    ) -> FareCalculationResult:
        """Calculate transit fare based on context, rules, and optional distance/zone."""
        pass
