"""
Fare engine.

A FareRule is resolved for a route (route-specific rule overrides the Uyushma-wide default)
and priced by a strategy registered for its `rule_type`. Adding a new tariff model means
registering one more `FareStrategy` — the payment and routing code stays untouched.
"""
import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Protocol

from sqlalchemy.orm import Session

from app.models.finance import FareRule

# Andijon local time (Asia/Tashkent, UTC+5, no DST)
LOCAL_TZ = timezone(timedelta(hours=5))
ROUNDING_UZS = 100


@dataclass
class FareContext:
    distance_km: Optional[float] = None
    at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    crosses_zone: bool = False


@dataclass
class FareQuote:
    amount_uzs: int
    rule_id: int
    rule_type: str
    rule_name: str


class FareStrategy(Protocol):
    def price(self, rule: FareRule, config: Dict[str, Any], ctx: FareContext) -> float: ...


def _round_fare(amount: float) -> int:
    return int(math.ceil(max(0.0, amount) / ROUNDING_UZS) * ROUNDING_UZS)


class FixedFare:
    def price(self, rule: FareRule, config: Dict[str, Any], ctx: FareContext) -> float:
        return rule.base_fare_uzs


class DistanceFare:
    def price(self, rule: FareRule, config: Dict[str, Any], ctx: FareContext) -> float:
        if ctx.distance_km is None:
            return rule.base_fare_uzs
        included = float(config.get("included_km", 0) or 0)
        extra_km = max(0.0, ctx.distance_km - included)
        return rule.base_fare_uzs + extra_km * (rule.extra_fare_per_km_uzs or 0)


class ZoneFare:
    def price(self, rule: FareRule, config: Dict[str, Any], ctx: FareContext) -> float:
        extra = float(config.get("cross_zone_extra", 0) or 0)
        return rule.base_fare_uzs + (extra if ctx.crosses_zone else 0)


class TimeBasedFare:
    def price(self, rule: FareRule, config: Dict[str, Any], ctx: FareContext) -> float:
        multiplier = float(config.get("peak_multiplier", 1.0) or 1.0)
        start = int(config.get("peak_start_hour", 7))
        end = int(config.get("peak_end_hour", 10))
        at = ctx.at if ctx.at.tzinfo else ctx.at.replace(tzinfo=timezone.utc)
        hour = at.astimezone(LOCAL_TZ).hour
        in_peak = start <= hour < end if start <= end else (hour >= start or hour < end)
        return rule.base_fare_uzs * (multiplier if in_peak else 1.0)


STRATEGIES: Dict[str, FareStrategy] = {
    "fixed": FixedFare(),
    "distance": DistanceFare(),
    "zone": ZoneFare(),
    "time_based": TimeBasedFare(),
}

SUPPORTED_RULE_TYPES = tuple(STRATEGIES.keys())


def parse_config(rule: FareRule) -> Dict[str, Any]:
    if not rule.config_json:
        return {}
    try:
        data = json.loads(rule.config_json)
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


def resolve_rule(db: Session, uyushma_id: int, route_id: Optional[int]) -> Optional[FareRule]:
    """Route-specific active rule first, otherwise the Uyushma-wide default."""
    base_q = db.query(FareRule).filter(FareRule.uyushma_id == uyushma_id, FareRule.is_active.is_(True))
    if route_id is not None:
        specific = base_q.filter(FareRule.route_id == route_id).order_by(FareRule.updated_at.desc()).first()
        if specific:
            return specific
    return base_q.filter(FareRule.route_id.is_(None)).order_by(FareRule.updated_at.desc()).first()


def quote_rule(rule: FareRule, ctx: Optional[FareContext] = None) -> FareQuote:
    strategy = STRATEGIES.get(rule.rule_type)
    if strategy is None:
        raise ValueError(f"Unsupported fare rule type '{rule.rule_type}'")
    amount = strategy.price(rule, parse_config(rule), ctx or FareContext())
    return FareQuote(amount_uzs=_round_fare(amount), rule_id=rule.id, rule_type=rule.rule_type, rule_name=rule.name)


def quote_fare(db: Session, uyushma_id: int, route_id: Optional[int], ctx: Optional[FareContext] = None) -> Optional[FareQuote]:
    """Return a quote, or None when the Uyushma has not configured a tariff (never invent a fare)."""
    rule = resolve_rule(db, uyushma_id, route_id)
    if rule is None:
        return None
    return quote_rule(rule, ctx)
