"""
Typed, DB-backed platform settings managed by the Super Admin.

Each key is stored as a JSON value in `system_settings`. Unknown keys are rejected and
values are validated against the declared type/range, so the rest of the code can rely
on `get_setting()` always returning a sane value.
"""
import json
from dataclasses import dataclass
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.system import SystemSetting
from app.models.user import User


@dataclass(frozen=True)
class SettingSpec:
    default: Any
    kind: type
    description: str
    min_value: Optional[float] = None
    max_value: Optional[float] = None


SETTING_SPECS: Dict[str, SettingSpec] = {
    "gps_interval_seconds": SettingSpec(5, int, "Driver GPS yuborish intervali (soniya)", 2, 60),
    "refund_window_minutes": SettingSpec(30, int, "Haydovchi to'lovni qaytara oladigan muddat (daqiqa)", 0, 1440),
    "platform_commission_percent": SettingSpec(0.0, float, "Platforma komissiyasi (%)", 0, 20),
    "maintenance_mode": SettingSpec(False, bool, "Texnik xizmat rejimi: yangi to'lovlar bloklanadi"),
    "fcm_notifications_enabled": SettingSpec(True, bool, "Push bildirishnomalarni yuborish"),
    "max_unassigned_vehicles": SettingSpec(50, int, "Uyushmada biriktirilmagan transportlar limiti", 0, 10000),
    "min_topup_uzs": SettingSpec(1000, int, "Minimal hamyon to'ldirish summasi", 100, 1_000_000),
    "max_topup_uzs": SettingSpec(2_000_000, int, "Maksimal hamyon to'ldirish summasi", 1000, 50_000_000),
}


class SettingValidationError(ValueError):
    pass


def _coerce(key: str, value: Any) -> Any:
    spec = SETTING_SPECS[key]
    if spec.kind is bool:
        if not isinstance(value, bool):
            raise SettingValidationError(f"'{key}' must be a boolean")
        return value
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SettingValidationError(f"'{key}' must be a number")
    coerced = spec.kind(value)
    if spec.min_value is not None and coerced < spec.min_value:
        raise SettingValidationError(f"'{key}' must be >= {spec.min_value}")
    if spec.max_value is not None and coerced > spec.max_value:
        raise SettingValidationError(f"'{key}' must be <= {spec.max_value}")
    return coerced


def get_setting(db: Session, key: str) -> Any:
    spec = SETTING_SPECS[key]
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if not row:
        return spec.default
    try:
        return _coerce(key, json.loads(row.value))
    except (ValueError, SettingValidationError):
        return spec.default


def get_all_settings(db: Session) -> Dict[str, Any]:
    rows = {r.key: r for r in db.query(SystemSetting).filter(SystemSetting.key.in_(SETTING_SPECS.keys())).all()}
    values: Dict[str, Any] = {}
    last_update: Optional[SystemSetting] = None
    for key, spec in SETTING_SPECS.items():
        row = rows.get(key)
        if row is None:
            values[key] = spec.default
            continue
        try:
            values[key] = _coerce(key, json.loads(row.value))
        except (ValueError, SettingValidationError):
            values[key] = spec.default
        if last_update is None or (row.updated_at and row.updated_at > last_update.updated_at):
            last_update = row

    updated_by = None
    if last_update and last_update.updated_by_user_id:
        actor = db.query(User).filter(User.id == last_update.updated_by_user_id).first()
        updated_by = actor.full_name if actor else None
    values["updated_at"] = last_update.updated_at if last_update else None
    values["updated_by"] = updated_by
    return values


def update_settings(db: Session, updates: Dict[str, Any], actor: User) -> Dict[str, Any]:
    """Validate and persist changed keys. Caller commits; returns the old->new diff."""
    for key in updates:
        if key not in SETTING_SPECS:
            raise SettingValidationError(f"Unknown setting '{key}'")
    coerced = {key: _coerce(key, raw) for key, raw in updates.items()}
    min_topup = coerced.get("min_topup_uzs", get_setting(db, "min_topup_uzs"))
    max_topup = coerced.get("max_topup_uzs", get_setting(db, "max_topup_uzs"))
    if min_topup > max_topup:
        raise SettingValidationError("'min_topup_uzs' must not exceed 'max_topup_uzs'")

    diff: Dict[str, Any] = {}
    for key, value in coerced.items():
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        old = get_setting(db, key)
        if row is None:
            row = SystemSetting(key=key, value=json.dumps(value), description=SETTING_SPECS[key].description)
            db.add(row)
        else:
            row.value = json.dumps(value)
        row.updated_by_user_id = actor.id
        if old != value:
            diff[key] = {"old": old, "new": value}
    return diff
