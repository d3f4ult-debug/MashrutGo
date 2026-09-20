import json
from typing import Any, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.system import AuditLog


def client_ip(request: Optional[Request]) -> Optional[str]:
    """
    Real client address. `X-Forwarded-For` is honoured only when the direct peer is a configured
    trusted proxy (TRUSTED_PROXIES); otherwise any caller could forge audit entries and bypass
    the login throttle by rotating the header.
    """
    if request is None:
        return None
    peer = request.client.host if request.client else None
    trusted = settings.trusted_proxies if isinstance(settings.trusted_proxies, list) else []
    if peer and trusted and ("*" in trusted or peer in trusted):
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()[:50]
    return peer[:50] if peer else None


def record_audit_event(
    db: Session,
    action: str,
    actor_user_id: Optional[int] = None,
    actor_role: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[Any] = None,
    changes: Optional[Any] = None,
    ip_address: Optional[str] = None,
    uyushma_id: Optional[int] = None,
    reason: Optional[str] = None,
) -> AuditLog:
    """Stage an immutable audit entry in the caller's transaction (no commit)."""
    entry = AuditLog(
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        changes_json=json.dumps(changes, ensure_ascii=False, default=str) if changes is not None else None,
        ip_address=ip_address,
        uyushma_id=uyushma_id,
        reason=reason,
    )
    db.add(entry)
    return entry


def log_audit_event(db: Session, action: str, **kwargs: Any) -> AuditLog:
    """Create and commit an audit entry (for flows whose main change is already committed)."""
    entry = record_audit_event(db, action, **kwargs)
    db.commit()
    db.refresh(entry)
    return entry
