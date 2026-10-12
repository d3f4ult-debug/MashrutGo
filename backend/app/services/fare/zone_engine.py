from typing import Optional, Dict
from sqlalchemy.orm import Session
from app.services.fare.base import BaseFareEngine, FareCalculationResult


class ZoneFareEngine(BaseFareEngine):
    """Zone-based Fare Engine.

    Calculates transit fare based on predefined tariff zones (e.g., city_center, suburb, inter_district).
    """

    ZONE_RATES: Dict[str, int] = {
        "inner_city": 2500,
        "outer_city": 3500,
        "inter_district": 5000,
    }

    def __init__(self, default_zone_fare_uzs: int = 2500):
        self.default_zone_fare_uzs = default_zone_fare_uzs

    def calculate_fare(
        self,
        route_id: Optional[int] = None,
        uyushma_id: Optional[int] = None,
        distance_km: Optional[float] = None,
        zone: Optional[str] = None,
        db: Optional[Session] = None,
    ) -> FareCalculationResult:
        selected_zone = (zone or "inner_city").lower()
        amount = self.ZONE_RATES.get(selected_zone, self.default_zone_fare_uzs)

        return FareCalculationResult(
            amount_uzs=amount,
            rule_type="zone",
            rule_id=None,
            currency="UZS",
            breakdown={
                "zone": selected_zone,
                "zone_rate": amount,
            },
        )
