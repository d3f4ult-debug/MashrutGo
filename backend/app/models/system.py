from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text

from app.db.base import Base
from app.db.types import UTCDateTime


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    title = Column(String(150), nullable=False)
    body = Column(String(500), nullable=False)
    notification_type = Column(String(50), nullable=False)
    data_payload = Column(Text, nullable=True)  # JSON string
    is_read = Column(Boolean, default=False, nullable=False)
    push_status = Column(String(20), default="skipped", nullable=False)  # sent, failed, skipped
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)


class DeviceToken(Base):
    """FCM registration token of a signed-in device (Flutter wrapper / PWA)."""

    __tablename__ = "device_tokens"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String(512), unique=True, nullable=False)
    platform = Column(String(20), default="android", nullable=False)  # android, ios, web
    app_version = Column(String(30), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    last_seen_at = Column(UTCDateTime(), default=_utcnow, nullable=False)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    key = Column(String(100), unique=True, index=True, nullable=False)
    value = Column(Text, nullable=False)  # JSON encoded
    description = Column(String(255), nullable=True)
    updated_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_role = Column(String(30), nullable=True)
    action = Column(String(100), nullable=False, index=True)
    target_type = Column(String(50), nullable=True)
    target_id = Column(String(64), nullable=True)
    uyushma_id = Column(Integer, nullable=True, index=True)
    reason = Column(String(255), nullable=True)
    changes_json = Column(Text, nullable=True)
    ip_address = Column(String(50), nullable=True)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False, index=True)
