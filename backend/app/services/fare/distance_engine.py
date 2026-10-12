from typing import Optional
from sqlalchemy.orm import Session
from app.models.finance import FareRule
from app.services.fare.base import BaseFareEngine, FareCalculationResult


class DistanceFareEngine(BaseFareEngine):
    """Distance-based Fare Engine.

    Calculates fare using formula: base_fare + (distance_km * extra_fare_per_km).
    """

    def __init__(self, default_base_uzs: int = 2500, default_per_km_uzs: int = 500):
        self.default_base_uzs = default_base_uzs
        self.default_per_km_uzs = default_per_km_uzs

    def calculate_fare(
        self,
        route_id: Optional[int] = None,
        uyushma_id: Optional[int] = None,
        distance_km: Optional[float] = None,
        zone: Optional[str] = None,
        db: Optional[Session] = None,
    ) -> FareCalculationResult:
        base_fare = self.default_base_uzs
        per_km_fare = self.default_per_km_uzs
        rule_id = None

        if db is not None:
            rule = None
            if route_id is not None:
                rule = (
                    db.query(FareRule)
                    .filter(
                        FareRule.route_id == route_id,
                        FareRule.rule_type == "distance",
                        FareRule.is_active.is_(True),
                    )
                    .first()
                )
            if rule is None and uyushma_id is not None:
                rule = (
                    db.query(FareRule)
                    .filter(
                        FareRule.uyushma_id == uyushma_id,
                        FareRule.rule_type == "distance",
                        FareRule.is_active.is_(True),
                    )
                    .first()
                )
            if rule is not None:
                base_fare = rule.base_fare_uzs
                per_km_fare = rule.extra_fare_per_km_uzs
                rule_id = rule.id

        km = max(0.0, float(distance_km or 0.0))
        extra_fare = int(round(km * per_km_fare))
        total_fare = base_fare + extra_fare

        return FareCalculationResult(
            amount_uzs=total_fare,
            rule_type="distance",
            rule_id=rule_id,
            currency="UZS",
            breakdown={
                "base_fare": base_fare,
                "distance_km": round(km, 2),
                "per_km_rate": per_km_fare,
                "extra_fare": extra_fare,
            },
        )
