import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Deque, Dict

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db_dep
from app.core.config import settings
from app.core.roles import UserRole
from app.core.security import create_access_token, get_password_hash, verify_password
from app.models.finance import Wallet
from app.models.user import ClientProfile, User
from app.models.uyushma import Uyushma
from app.schemas.auth import ChangePasswordRequest, ClientRegisterRequest, LoginRequest, TokenResponse
from app.schemas.user import MeResponse, UserRead, normalize_phone
from app.services.audit_service import client_ip, record_audit_event
from app.services.rate_limit import limit_by_ip, registration_limiter

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginThrottle:
    """
    In-memory sliding-window limiter. Two buckets are checked: per (phone, ip) and per phone
    alone, so rotating source addresses cannot brute-force one account. Single-node MVP scope:
    behind several workers, move this to Redis.
    """

    MAX_KEYS = 50_000

    def __init__(self) -> None:
        self._failures: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _keys(self, phone: str, ip: str) -> tuple:
        return (f"{phone}|{ip}", f"phone|{phone}")

    def _limit(self, key: str) -> int:
        # The phone-only bucket is more permissive: one person may legitimately retry from
        # a few addresses, but not hundreds of times.
        return settings.login_max_attempts if "|" in key and not key.startswith("phone|") else settings.login_max_attempts * 3

    def _prune(self, now: float) -> None:
        if len(self._failures) <= self.MAX_KEYS:
            return
        for key in [k for k, w in self._failures.items() if not w or now - w[-1] > settings.login_lockout_seconds]:
            self._failures.pop(key, None)

    def check(self, phone: str, ip: str) -> None:
        now = time.monotonic()
        with self._lock:
            for key in self._keys(phone, ip):
                window = self._failures[key]
                while window and now - window[0] > settings.login_lockout_seconds:
                    window.popleft()
                if len(window) >= self._limit(key):
                    retry = int(settings.login_lockout_seconds - (now - window[0])) + 1
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="Juda ko'p muvaffaqiyatsiz urinish. Birozdan so'ng qayta urinib ko'ring.",
                        headers={"Retry-After": str(max(retry, 1))},
                    )

    def fail(self, phone: str, ip: str) -> None:
        now = time.monotonic()
        with self._lock:
            for key in self._keys(phone, ip):
                self._failures[key].append(now)
            self._prune(now)

    def reset(self, phone: str, ip: str) -> None:
        with self._lock:
            for key in self._keys(phone, ip):
                self._failures.pop(key, None)


login_throttle = LoginThrottle()


def _token_claims_uyushma(user: User):
    if user.role == UserRole.DRIVER.value and user.driver_profile:
        return user.driver_profile.uyushma_id
    return user.uyushma_id


def _issue_token(user: User) -> TokenResponse:
    token = create_access_token(
        subject=user.id,
        role=user.role,
        uyushma_id=_token_claims_uyushma(user),
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
        password_changed_at=user.password_changed_at,
    )
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60,
        user=UserRead.model_validate(user),
    )


def _authenticate(db: Session, request: Request, phone: str, password: str) -> TokenResponse:
    ip = client_ip(request) or "unknown"
    login_throttle.check(phone, ip)
    user = db.query(User).filter(User.phone == phone).first()
    if not user or not verify_password(password, user.hashed_password):
        login_throttle.fail(phone, ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Telefon raqami yoki parol noto'g'ri")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Akkaunt faol emas yoki bloklangan")
    if user.role == UserRole.DRIVER.value and (not user.driver_profile or not user.driver_profile.is_active):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Haydovchi profili faol emas")
    login_throttle.reset(phone, ip)
    record_audit_event(
        db,
        action="user.login",
        actor_user_id=user.id,
        actor_role=user.role,
        target_type="user",
        target_id=user.id,
        ip_address=ip,
    )
    db.commit()
    return _issue_token(user)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db_dep)):
    """Authenticate with phone and password; returns a JWT access token."""
    return _authenticate(db, request, payload.phone, payload.password)


@router.post("/login/form", response_model=TokenResponse, include_in_schema=True)
def login_form(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db_dep)):
    """OAuth2 password flow for the Swagger UI "Authorize" button (username = phone)."""
    try:
        phone = normalize_phone(form.username)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _authenticate(db, request, phone, form.password)


@router.post("/register-client", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register_client(payload: ClientRegisterRequest, request: Request, db: Session = Depends(get_db_dep)):
    """Public registration for passengers. Drivers/Uyushma accounts cannot self-register."""
    # Rate limited: the 409 below is a phone-enumeration oracle if it can be called freely
    limit_by_ip(registration_limiter, request, "Juda ko'p ro'yxatdan o'tish urinishi. Birozdan so'ng qayta urinib ko'ring.")
    if db.query(User.id).filter(User.phone == payload.phone).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bu telefon raqami allaqachon ro'yxatdan o'tgan")

    user = User(
        phone=payload.phone,
        hashed_password=get_password_hash(payload.password),
        full_name=payload.full_name.strip(),
        role=UserRole.CLIENT.value,
        is_active=True,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bu telefon raqami allaqachon ro'yxatdan o'tgan") from exc
    db.add(ClientProfile(user_id=user.id, preferred_language=payload.preferred_language))
    db.add(Wallet(user_id=user.id, balance_uzs=0, currency="UZS", is_active=True))
    record_audit_event(
        db,
        action="client.registered",
        actor_user_id=user.id,
        actor_role=user.role,
        target_type="user",
        target_id=user.id,
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(user)
    return _issue_token(user)


@router.get("/me", response_model=MeResponse)
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db_dep)):
    """Current user with role context (Uyushma, driver's vehicle and route)."""
    me = MeResponse.model_validate(current_user)
    if current_user.role == UserRole.DRIVER.value and current_user.driver_profile:
        profile = current_user.driver_profile
        me.driver_id = profile.id
        me.uyushma_id = profile.uyushma_id
        me.uyushma_name = profile.uyushma.name if profile.uyushma else None
        if profile.vehicle:
            me.vehicle_id = profile.vehicle.id
            me.vehicle_internal_id = profile.vehicle.internal_id
            me.route_id = profile.vehicle.route_id
    elif current_user.uyushma_id:
        uyushma = db.query(Uyushma).filter(Uyushma.id == current_user.uyushma_id).first()
        me.uyushma_name = uyushma.name if uyushma else None
    return me


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(current_user: User = Depends(get_current_user)):
    """Issue a fresh access token for the current active user."""
    return _issue_token(current_user)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Joriy parol noto'g'ri")
    current_user.hashed_password = get_password_hash(payload.new_password)
    # Invalidate every token issued before this moment (the caller signs in again)
    current_user.password_changed_at = datetime.now(timezone.utc)
    record_audit_event(
        db,
        action="user.password_changed",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="user",
        target_id=current_user.id,
        ip_address=client_ip(request),
    )
    db.commit()
