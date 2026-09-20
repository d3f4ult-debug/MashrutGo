import json
from datetime import datetime, timezone

from app.models.finance import FareRule
from app.services.fare_engine import FareContext, quote_fare, quote_rule
from tests.factories import make_fare, make_route, make_uyushma


def _rule(rule_type: str, base: int = 2000, per_km: int = 0, **config) -> FareRule:
    return FareRule(id=1, uyushma_id=1, name="t", rule_type=rule_type, base_fare_uzs=base,
                    extra_fare_per_km_uzs=per_km, config_json=json.dumps(config) if config else None)


def test_fixed_fare():
    assert quote_rule(_rule("fixed", 2500)).amount_uzs == 2500


def test_distance_fare_rounds_up_to_100():
    rule = _rule("distance", 2000, per_km=333, included_km=3)
    assert quote_rule(rule, FareContext(distance_km=2)).amount_uzs == 2000
    assert quote_rule(rule, FareContext(distance_km=5)).amount_uzs == 2700  # 2000 + 666 -> 2700


def test_zone_fare():
    rule = _rule("zone", 2000, cross_zone_extra=1000)
    assert quote_rule(rule, FareContext(crosses_zone=False)).amount_uzs == 2000
    assert quote_rule(rule, FareContext(crosses_zone=True)).amount_uzs == 3000


def test_time_based_fare_uses_tashkent_time():
    rule = _rule("time_based", 2000, peak_multiplier=1.5, peak_start_hour=7, peak_end_hour=10)
    peak = datetime(2026, 9, 19, 3, 30, tzinfo=timezone.utc)  # 08:30 local
    off_peak = datetime(2026, 9, 19, 9, 0, tzinfo=timezone.utc)  # 14:00 local
    assert quote_rule(rule, FareContext(at=peak)).amount_uzs == 3000
    assert quote_rule(rule, FareContext(at=off_peak)).amount_uzs == 2000


def test_rule_resolution_prefers_route_specific(db):
    u = make_uyushma(db)
    route, other = make_route(db, u), make_route(db, u)
    assert quote_fare(db, u.id, route.id) is None  # never invent a fare
    make_fare(db, u, 2500)
    make_fare(db, u, 4000, route_id=route.id, name="Maxsus")
    assert quote_fare(db, u.id, route.id).amount_uzs == 4000
    assert quote_fare(db, u.id, other.id).amount_uzs == 2500
