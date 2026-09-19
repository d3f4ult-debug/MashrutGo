from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep, get_current_user
from app.core.config import settings
from app.core.roles import UserRole
from app.core.security import verify_password, get_password_hash, create_access_token
from app.models.user import User, ClientProfile
from app.models.finance import Wallet
from app.schemas.auth import LoginRequest, TokenResponse, ClientRegisterRequest
from app.schemas.user import UserRead
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    db: Session = Depends(get_db_dep),
):
    """Authenticate user with phone and password, return JWT token."""
    user = db.query(User).filter(User.phone == payload.phone).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect phone number or password",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User account is deactivated",
        )

    # Determine Uyushma ID claim
    uyushma_id = user.uyushma_id
    if user.role == UserRole.DRIVER.value and user.driver_profile:
        uyushma_id = user.driver_profile.uyushma_id

    access_token = create_access_token(
        subject=user.id,
        role=user.role,
        uyushma_id=uyushma_id,
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )

    log_audit_event(
        db=db,
        action="user.login",
        actor_user_id=user.id,
        actor_role=user.role,
        target_type="user",
        target_id=str(user.id),
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserRead.model_validate(user),
    )


@router.post("/register-client", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register_client(
    payload: ClientRegisterRequest,
    db: Session = Depends(get_db_dep),
):
    """Public registration for clients. Drivers cannot self-register."""
    existing_user = db.query(User).filter(User.phone == payload.phone).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number already registered",
        )

    # 1. Create client user
    user = User(
        phone=payload.phone,
        hashed_password=get_password_hash(payload.password),
        full_name=payload.full_name,
        role=UserRole.CLIENT.value,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # 2. Create client profile
    client_profile = ClientProfile(
        user_id=user.id,
        preferred_language=payload.preferred_language or "uz",
    )
    db.add(client_profile)

    # 3. Create initial empty wallet
    wallet = Wallet(
        user_id=user.id,
        balance_uzs=0,
        currency="UZS",
        is_active=True,
    )
    db.add(wallet)
    db.commit()

    log_audit_event(
        db=db,
        action="client.registered",
        actor_user_id=user.id,
        actor_role=user.role,
        target_type="user",
        target_id=str(user.id),
    )

    access_token = create_access_token(
        subject=user.id,
        role=user.role,
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserRead.model_validate(user),
    )


@router.get("/me", response_model=UserRead)
def get_me(current_user: User = Depends(get_current_user)):
    """Retrieve details of the currently authenticated user."""
    return current_user


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(current_user: User = Depends(get_current_user)):
    """Generate fresh access token for current active user."""
    uyushma_id = current_user.uyushma_id
    if current_user.role == UserRole.DRIVER.value and current_user.driver_profile:
        uyushma_id = current_user.driver_profile.uyushma_id

    access_token = create_access_token(
        subject=current_user.id,
        role=current_user.role,
        uyushma_id=uyushma_id,
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserRead.model_validate(current_user),
    )
