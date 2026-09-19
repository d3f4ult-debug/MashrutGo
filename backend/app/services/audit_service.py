import json
from typing import Any, Optional
from sqlalchemy.orm import Session
from app.models.system import AuditLog


def log_audit_event(
    db: Session,
    action: str,
    actor_user_id: Optional[int] = None,
    actor_role: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    changes: Optional[Any] = None,
    ip_address: Optional[str] = None,
) -> AuditLog:
    """Create and persist an immutable audit log entry."""
    changes_str = json.dumps(changes) if changes is not None else None
    audit_entry = AuditLog(
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        changes_json=changes_str,
        ip_address=ip_address,
    )
    db.add(audit_entry)
    db.commit()
    db.refresh(audit_entry)
    return audit_entry
