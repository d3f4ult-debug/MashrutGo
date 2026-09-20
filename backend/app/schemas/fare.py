from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.fare_engine import SUPPORTED_RULE_TYPES

ALLOWED_CONFIG_KEYS = {"included_km", "cross_zone_extra", "peak_multiplier", "peak_start_hour", "peak_end_hour"}


def _validate_config(v: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    v = v or {}
    unknown = set(v) - ALLOWED_CONFIG_KEYS
    if unknown:
        raise ValueError(f"Unknown config keys: {', '.join(sorted(unknown))}")
    for key, value in v.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"config.{key} must be a number")
        if value < 0:
            raise ValueError(f"config.{key} must be >= 0")
    for hour_key in ("peak_start_hour", "peak_end_hour"):
        if hour_key in v and not 0 <= v[hour_key] <= 24:
            raise ValueError(f"config.{hour_key} must be between 0 and 24")
    if "peak_multiplier" in v and not 1 <= v["peak_multiplier"] <= 5:
        raise ValueError("config.peak_multiplier must be between 1 and 5")
    return v


class FareRuleBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=150, examples=["Standart shahar tarifi"])
    description: Optional[str] = Field(None, max_length=255)
    rule_type: str = Field("fixed", examples=list(SUPPORTED_RULE_TYPES))
    base_fare_uzs: int = Field(..., ge=0, le=100_000, examples=[2500])
    extra_fare_per_km_uzs: int = Field(0, ge=0, le=100_000)
    route_id: Optional[int] = Field(None, description="NULL = default rule for all routes of the Uyushma")
    config: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True

    @field_validator("rule_type")
    @classmethod
    def _rule_type(cls, v: str) -> str:
        if v not in SUPPORTED_RULE_TYPES:
            raise ValueError(f"rule_type must be one of {', '.join(SUPPORTED_RULE_TYPES)}")
        return v

    @field_validator("config")
    @classmethod
    def _config(cls, v: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        return _validate_config(v)


class FareRuleCreate(FareRuleBase):
    pass


class FareRuleUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=150)
    description: Optional[str] = Field(None, max_length=255)
    rule_type: Optional[str] = None
    base_fare_uzs: Optional[int] = Field(None, ge=0, le=100_000)
    extra_fare_per_km_uzs: Optional[int] = Field(None, ge=0, le=100_000)
    route_id: Optional[int] = None
    config: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None

    @field_validator("rule_type")
    @classmethod
    def _rule_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in SUPPORTED_RULE_TYPES:
            raise ValueError(f"rule_type must be one of {', '.join(SUPPORTED_RULE_TYPES)}")
        return v

    @field_validator("config")
    @classmethod
    def _config(cls, v: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return _validate_config(v) if v is not None else None


class FareRuleRead(FareRuleBase):
    id: int
    uyushma_id: int
    route_number: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FareRuleTypesResponse(BaseModel):
    rule_types: list[str]
