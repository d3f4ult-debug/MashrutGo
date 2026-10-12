from typing import Optional
from sqlalchemy.orm import Session
from app.models.finance import FareRule
from app.services.fare.base import BaseFareEngine, FareCalculationResult

DEFAULT_FIXED_FARE_UZS = 2500


class FixedFareEngine(BaseFareEngine):
    """MVP Fixed Fare Engine.

    Calculates fixed fare according to Route/Uyushma tariff rule or platform default (2500 UZS).
    """

    def __init__(self, default_fare_uzs: int = DEFAULT_FIXED_FARE_UZS):
        self.default_fare_uzs = default_fare_uzs

    def calculate_fare(
        self,
        route_id: Optional[int] = None,
        uyushma_id: Optional[int] = None,
        distance_km: Optional[float] = None,
        zone: Optional[str] = None,
        db: Optional[Session] = None,
    ) -> FareCalculationResult:
        if db is not None:
            rule = None
            if route_id is not None:
                rule = (
                    db.query(FareRule)
                    .filter(
                        FareRule.route_id == route_id,
                        FareRule.is_active.is_(True),
                    )
                    .order_by(FareRule.id.desc())
                    .first()
                )

            if rule is None and uyushma_id is not None:
                rule = (
                    db.query(FareRule)
                    .filter(
                        FareRule.uyushma_id == uyushma_id,
                        FareRule.route_id.is_(None),
                        FareRule.is_active.is_(True),
                    )
                    .order_by(FareRule.id.desc())
                    .first()
                )

            if rule is not None:
                return FareCalculationResult(
                    amount_uzs=rule.base_fare_uzs,
                    rule_type="fixed",
                    rule_id=rule.id,
                    currency="UZS",
                    breakdown={
                        "base_fare": rule.base_fare_uzs,
                        "extra_km_fare": 0,
                    },
                )

        return FareCalculationResult(
            amount_uzs=self.default_fare_uzs,
            rule_type="fixed",
            rule_id=None,
            currency="UZS",
            breakdown={
                "base_fare": self.default_fare_uzs,
                "extra_km_fare": 0,
            },
        )
