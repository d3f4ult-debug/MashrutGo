from datetime import datetime, timedelta, timezone
from typing import Generator, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.roles import UserRole
from app.core.security import decode_access_token
from app.db.session import SessionLocal, get_db
from app.models.user import DriverProfile, User
from app.models.uyushma import Uyushma

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.api_v1_prefix}/auth/login/form",
    auto_error=False,
)

_ACTIVITY_WRITE_INTERVAL = timedelta(minutes=5)


def get_db_dep() -> Generator[Session, None, None]:
    """Dependency for yielding database sessions."""
    yield from get_db()


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _user_from_token(db: Session, token: str) -> Optional[User]:
    payload = decode_access_token(token)
    if not payload or not payload.get("sub"):
        return None
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError):
        return None
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        return None
    # A password change invalidates tokens issued before it (stolen-token revocation)
    changed_at = user.password_changed_at
    if changed_at is not None:
        if changed_at.tzinfo is None:
            changed_at = changed_at.replace(tzinfo=timezone.utc)
        issued_for = payload.get("pwd")
        if not isinstance(issued_for, int) or issued_for < int(changed_at.timestamp()):
            return None
    return user


def _touch_activity(user: User) -> None:
    """
    Record "last seen" at most every few minutes.

    Written through its own short-lived session: committing the request's session from a read
    path would expire every loaded object (and could commit work the request has staged).
    """
    now = datetime.now(timezone.utc)
    last = user.last_active_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if last is not None and now - last <= _ACTIVITY_WRITE_INTERVAL:
        return
    session = SessionLocal()
    try:
        session.execute(
            update(User).where(User.id == user.id).values(last_active_at=now).execution_options(synchronize_session=False)
        )
        session.commit()
        # Do not write back onto the request's instance: that would make the read-path session
        # dirty and flush it inside unrelated transactions.
    except Exception:  # pragma: no cover - activity tracking must never break a request
        session.rollback()
    finally:
        session.close()


def get_current_user(
    db: Session = Depends(get_db_dep),
    token: Optional[str] = Depends(reusable_oauth2),
) -> User:
    """Validate bearer token and return the active user."""
    if not token:
        raise _unauthorized("Authentication token required")
    user = _user_from_token(db, token)
    if not user:
        raise _unauthorized("Invalid or expired token")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated or blocked")
    _touch_activity(user)
    return user


def get_optional_current_user(
    db: Session = Depends(get_db_dep),
    token: Optional[str] = Depends(reusable_oauth2),
) -> Optional[User]:
    """Extract authenticated user if token present, otherwise return None."""
    if not token:
        return None
    user = _user_from_token(db, token)
    if user and user.is_active:
        return user
    return None


def require_roles(*allowed_roles: str):
    """Dependency factory enforcing specific UserRole membership."""

    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation not permitted for role '{current_user.role}'",
            )
        return current_user

    return role_checker


require_super_admin = require_roles(UserRole.SUPER_ADMIN.value)
require_uyushma_admin = require_roles(UserRole.UYUSHMA_ADMIN.value, UserRole.SUPER_ADMIN.value)
require_driver = require_roles(UserRole.DRIVER.value)
require_client = require_roles(UserRole.CLIENT.value)


def verify_tenant_access(current_user: User, target_uyushma_id: Optional[int]) -> None:
    """Ensure user has permission to access the specified Uyushma tenant."""
    if current_user.role == UserRole.SUPER_ADMIN.value:
        return
    if (
        current_user.role == UserRole.UYUSHMA_ADMIN.value
        and target_uyushma_id is not None
        and current_user.uyushma_id == target_uyushma_id
    ):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Tenant isolation violation: Access denied to other Uyushma data",
    )


def get_tenant_uyushma(db: Session, current_user: User, uyushma_id: int) -> Uyushma:
    """Resolve an Uyushma the caller may manage (404 if missing, 403 if foreign)."""
    verify_tenant_access(current_user, uyushma_id)
    uyushma = db.query(Uyushma).filter(Uyushma.id == uyushma_id).first()
    if not uyushma:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Uyushma not found")
    return uyushma


def get_driver_profile(current_user: User = Depends(require_driver)) -> DriverProfile:
    """Resolve the calling driver's profile or fail with a clear error."""
    profile = current_user.driver_profile
    if not profile:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Driver profile not found for user")
    if not profile.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Driver profile is deactivated")
    return profile
