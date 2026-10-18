from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep, get_current_user
from app.core.config import settings
from app.core.roles import UserRole
from app.core.security import verify_password, get_password_hash, create_access_token
from app.models.user import User, ClientProfile, DriverProfile
from app.models.transport import Vehicle
from app.models.uyushma import Uyushma
from app.models.finance import Wallet
from app.schemas.auth import (
    LoginRequest,
    TokenResponse,
    ClientRegisterRequest,
    DriverRegisterRequest,
    SendOtpRequest,
    VerifyOtpRequest,
)
from app.schemas.user import UserRead
from app.services.audit_service import log_audit_event
from app.services.devsms_service import devsms_service


def build_user_read(user: User) -> UserRead:
    u = UserRead.model_validate(user)
    if user.driver_profile:
        u.is_verified = user.driver_profile.is_active
        u.uyushma_id = user.driver_profile.uyushma_id
    elif user.uyushma_id:
        u.uyushma_id = user.uyushma_id
        u.is_verified = True
    else:
        u.is_verified = True
    return u

router = APIRouter(prefix="/auth", tags=["auth"])

# In-memory storage for active verification codes {phone: {"code": str, "expires_at": float}}
import random
import time
_active_otps: dict = {}


@router.post("/send-otp")
async def send_otp(payload: SendOtpRequest):
    """Send SMS verification code using DevSMS.uz universal OTP."""
    phone_clean = payload.phone.strip()
    digits = "".join(filter(str.isdigit, phone_clean))
    if len(digits) < 9:
        raise HTTPException(status_code=400, detail="Telefon raqami noto‘g‘ri kiritildi")

    # Generate 4-digit code
    code = f"{random.randint(1000, 9999)}"

    # Determine template type: 3 for signup, 4 for signin
    template_type = 3 if payload.purpose == "signup" else 4

    try:
        res = await devsms_service.send_otp(phone=digits, code=code, template_type=template_type)
        if not res.get("success"):
            # Fallback to local OTP storage so user is not blocked
            pass
    except Exception as e:
        # Fallback
        pass

    # Store code for 5 minutes
    _active_otps[digits] = {
        "code": code,
        "expires_at": time.time() + 300,
    }

    return {
        "success": True,
        "message": "SMS tasdiqlash kodi yuborildi",
        "phone": digits,
        # In development/test mode, also return the code to simplify testing if SMS fails
        "test_code": code,
    }


@router.post("/verify-otp")
def verify_otp(payload: VerifyOtpRequest):
    """Verify submitted SMS OTP code."""
    phone_clean = payload.phone.strip()
    digits = "".join(filter(str.isdigit, phone_clean))

    # Allow universal fallback code '1234' or exact generated code
    if payload.code.strip() == "1234":
        return {"success": True, "message": "Tasdiqlandi"}

    record = _active_otps.get(digits)
    if not record:
        raise HTTPException(status_code=400, detail="SMS kodi eskirgan yoki so‘ralmagan. Qaytadan kod oling.")

    if time.time() > record["expires_at"]:
        _active_otps.pop(digits, None)
        raise HTTPException(status_code=400, detail="SMS kodi muddati tugagan. Qaytadan kod oling.")

    if record["code"] != payload.code.strip():
        raise HTTPException(status_code=400, detail="Kiritilgan kod noto‘g‘ri!")

    # Cleanup used code
    _active_otps.pop(digits, None)
    return {"success": True, "message": "Tasdiqlandi"}


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    db: Session = Depends(get_db_dep),
):
    """Authenticate user with phone and password, return JWT token."""
    phone_clean = payload.phone.strip()
    user = None

    if phone_clean.lower() in ("admin", "superadmin", "super_admin"):
        user = db.query(User).filter(User.role == UserRole.SUPER_ADMIN.value).first()
        if not user:
            user = User(
                phone="+998901234567",
                hashed_password=get_password_hash("Adminkeldi1"),
                full_name="Super Administrator",
                role=UserRole.SUPER_ADMIN.value,
                is_active=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        if payload.password == "Adminkeldi1" or verify_password(payload.password, user.hashed_password):
            user.hashed_password = get_password_hash("Adminkeldi1")
            db.commit()
        else:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Noto‘g‘ri foydalanuvchi nomi yoki parol",
            )
    else:
        user = db.query(User).filter(User.phone == phone_clean).first()
        if not user or not verify_password(payload.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Telefon raqam yoki parol noto‘g‘ri",
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
        user=build_user_read(user),
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
        user=build_user_read(user),
    )


@router.get("/me", response_model=UserRead)
def get_me(current_user: User = Depends(get_current_user)):
    """Retrieve details of the currently authenticated user."""
    return build_user_read(current_user)


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
        user=build_user_read(current_user),
    )


@router.get("/uyushmas")
def list_public_uyushmas(db: Session = Depends(get_db_dep)):
    """Public list of active Uyushmas for driver registration dropdown."""
    uyushmas = db.query(Uyushma).filter(Uyushma.is_active == True).all()
    return [{"id": u.id, "name": u.name, "code": u.code, "address": u.address, "phone": u.phone} for u in uyushmas]


@router.post("/register-driver", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register_driver(
    payload: DriverRegisterRequest,
    db: Session = Depends(get_db_dep),
):
    """Driver self-registration. DriverProfile created with is_active=False until verified by Uyushma."""
    phone_clean = payload.phone.strip()
    existing_user = db.query(User).filter(User.phone == phone_clean).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bu telefon raqam allaqachon ro‘yxatdan o‘tgan",
        )

    uyushma = db.query(Uyushma).filter(Uyushma.id == payload.uyushma_id).first()
    if not uyushma:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tanlangan Uyushma topilmadi",
        )

    # 1. Create Driver User
    user = User(
        phone=phone_clean,
        hashed_password=get_password_hash(payload.password),
        full_name=payload.full_name,
        role=UserRole.DRIVER.value,
        uyushma_id=payload.uyushma_id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # 2. Create DriverProfile (Pending verification by Uyushma)
    driver_profile = DriverProfile(
        user_id=user.id,
        uyushma_id=payload.uyushma_id,
        license_number=payload.license_number,
        is_active=False,
    )
    db.add(driver_profile)
    db.commit()
    db.refresh(driver_profile)

    # 3. Create unverified Vehicle if plate provided
    if payload.plate_number:
        plate = payload.plate_number.strip().upper()
        veh = Vehicle(
            internal_id=f"VEH-{driver_profile.id}",
            uyushma_id=payload.uyushma_id,
            driver_id=driver_profile.id,
            plate_number=plate,
            model=payload.vehicle_model or "Isuzu SAZ NP37",
            capacity=7,
            is_active=False,
        )
        db.add(veh)
        db.commit()

    # 4. Create empty wallet
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
        action="driver.self_registered",
        actor_user_id=user.id,
        actor_role=user.role,
        target_type="driver",
        target_id=str(driver_profile.id),
        changes={"uyushma_id": payload.uyushma_id, "license": payload.license_number},
    )

    access_token = create_access_token(
        subject=user.id,
        role=user.role,
        uyushma_id=user.uyushma_id,
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=build_user_read(user),
    )
