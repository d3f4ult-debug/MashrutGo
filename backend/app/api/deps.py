from typing import Generator, Optional, List
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.config import settings
from app.core.roles import UserRole
from app.core.security import decode_access_token
from app.models.user import User

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.api_v1_prefix}/auth/login",
    auto_error=False,
)


def get_db_dep() -> Generator[Session, None, None]:
    """Dependency for yielding database sessions."""
    yield from get_db()


def get_current_user(
    db: Session = Depends(get_db_dep),
    token: Optional[str] = Depends(reusable_oauth2),
) -> User:
    """Validate bearer token and return the active user."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject identifier",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user account",
        )
    return user


def get_optional_current_user(
    db: Session = Depends(get_db_dep),
    token: Optional[str] = Depends(reusable_oauth2),
) -> Optional[User]:
    """Extract authenticated user if token present, otherwise return None."""
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload or not payload.get("sub"):
        return None
    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if user and user.is_active:
        return user
    return None


def require_roles(*allowed_roles: str):
    """Dependency factory enforcing specific UserRole membership."""
    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation not permitted for role '{current_user.role}'. Required: {list(allowed_roles)}",
            )
        return current_user
    return role_checker


require_super_admin = require_roles(UserRole.SUPER_ADMIN.value)
require_uyushma_admin = require_roles(UserRole.UYUSHMA_ADMIN.value, UserRole.SUPER_ADMIN.value)
require_driver = require_roles(UserRole.DRIVER.value)
require_client = require_roles(UserRole.CLIENT.value, UserRole.SUPER_ADMIN.value)


def verify_tenant_access(current_user: User, target_uyushma_id: int) -> None:
    """Ensure user has permission to access the specified Uyushma tenant."""
    if current_user.role == UserRole.SUPER_ADMIN.value:
        return
    if current_user.role == UserRole.UYUSHMA_ADMIN.value and current_user.uyushma_id == target_uyushma_id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Tenant isolation violation: Access denied to other Uyushma data",
    )
