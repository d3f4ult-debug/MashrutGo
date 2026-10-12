from typing import Dict, Optional
from sqlalchemy.orm import Session
from app.models.finance import FareRule
from app.services.fare.base import BaseFareEngine, FareCalculationResult
from app.services.fare.fixed_engine import FixedFareEngine
from app.services.fare.distance_engine import DistanceFareEngine
from app.services.fare.zone_engine import ZoneFareEngine


class FareService:
    """Central Fare Engine Registry & Resolver.

    Provides extensibility across fixed, distance, zone, and custom fare strategies.
    """

    def __init__(self):
        self._engines: Dict[str, BaseFareEngine] = {
            "fixed": FixedFareEngine(),
            "distance": DistanceFareEngine(),
            "zone": ZoneFareEngine(),
        }

    def register_engine(self, name: str, engine: BaseFareEngine) -> None:
        """Register a new or custom fare engine strategy."""
        self._engines[name.lower()] = engine

    def get_engine(self, name: str) -> BaseFareEngine:
        """Retrieve registered engine or fallback to fixed."""
        return self._engines.get(name.lower(), self._engines["fixed"])

    def calculate_fare(
        self,
        route_id: Optional[int] = None,
        uyushma_id: Optional[int] = None,
        distance_km: Optional[float] = None,
        zone: Optional[str] = None,
        db: Optional[Session] = None,
    ) -> FareCalculationResult:
        """Dynamically resolve applicable fare rule type and execute calculation."""
        engine_type = "fixed"

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

            if rule is not None and rule.rule_type in self._engines:
                engine_type = rule.rule_type

        engine = self.get_engine(engine_type)
        return engine.calculate_fare(
            route_id=route_id,
            uyushma_id=uyushma_id,
            distance_km=distance_km,
            zone=zone,
            db=db,
        )


fare_service = FareService()
