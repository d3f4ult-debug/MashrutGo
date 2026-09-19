from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import (
    get_db_dep,
    get_current_user,
    require_super_admin,
    require_uyushma_admin,
    verify_tenant_access,
)
from app.core.roles import UserRole
from app.core.security import get_password_hash
from app.models.user import User, DriverProfile
from app.models.uyushma import Uyushma
from app.schemas.user import DriverCreateRequest, DriverRead
from app.schemas.uyushma import UyushmaCreate, UyushmaRead, UyushmaUpdate
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/uyushma", tags=["uyushma"])


@router.post("", response_model=UyushmaRead, status_code=status.HTTP_201_CREATED)
def create_uyushma(
    payload: UyushmaCreate,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """Super Admin creates a new Uyushma transport organization."""
    existing = db.query(Uyushma).filter(Uyushma.code == payload.code).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Uyushma with code '{payload.code}' already exists",
        )

    uyushma = Uyushma(
        name=payload.name,
        code=payload.code,
        phone=payload.phone,
        address=payload.address,
        is_active=payload.is_active,
    )
    db.add(uyushma)
    db.commit()
    db.refresh(uyushma)

    log_audit_event(
        db=db,
        action="uyushma.create",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="uyushma",
        target_id=str(uyushma.id),
        changes={"name": uyushma.name, "code": uyushma.code},
    )
    return uyushma


@router.get("", response_model=List[UyushmaRead])
def list_uyushmas(
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """Super Admin lists all Uyushma organizations."""
    return db.query(Uyushma).offset(skip).limit(limit).all()


@router.get("/{id}", response_model=UyushmaRead)
def get_uyushma(
    id: int,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Retrieve Uyushma organization details. Tenant-isolated."""
    verify_tenant_access(current_user, id)
    uyushma = db.query(Uyushma).filter(Uyushma.id == id).first()
    if not uyushma:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uyushma not found",
        )
    return uyushma


@router.post("/{id}/drivers", response_model=DriverRead, status_code=status.HTTP_201_CREATED)
def create_driver_for_uyushma(
    id: int,
    payload: DriverCreateRequest,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """
    Uyushma Admin or Super Admin creates a Driver under this Uyushma.
    Drivers cannot self-register. Tenant isolation enforced.
    """
    verify_tenant_access(current_user, id)

    uyushma = db.query(Uyushma).filter(Uyushma.id == id).first()
    if not uyushma:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uyushma not found",
        )

    # Check if phone is already taken
    existing_user = db.query(User).filter(User.phone == payload.phone).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number already registered to an account",
        )

    # 1. Create Driver User
    driver_user = User(
        phone=payload.phone,
        hashed_password=get_password_hash(payload.password),
        full_name=payload.full_name,
        role=UserRole.DRIVER.value,
        uyushma_id=id,
        is_active=True,
    )
    db.add(driver_user)
    db.commit()
    db.refresh(driver_user)

    # 2. Create Driver Profile
    driver_profile = DriverProfile(
        user_id=driver_user.id,
        uyushma_id=id,
        license_number=payload.license_number,
        is_active=True,
    )
    db.add(driver_profile)
    db.commit()
    db.refresh(driver_profile)

    log_audit_event(
        db=db,
        action="driver.create",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="driver",
        target_id=str(driver_profile.id),
        changes={"uyushma_id": id, "phone": payload.phone, "name": payload.full_name},
    )

    return DriverRead(
        id=driver_profile.id,
        user_id=driver_user.id,
        uyushma_id=id,
        license_number=driver_profile.license_number,
        is_active=driver_profile.is_active,
        full_name=driver_user.full_name,
        phone=driver_user.phone,
        created_at=driver_profile.created_at,
    )


@router.get("/{id}/drivers", response_model=List[DriverRead])
def list_uyushma_drivers(
    id: int,
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """List all drivers belonging to the specified Uyushma. Tenant-isolated."""
    verify_tenant_access(current_user, id)

    profiles = (
        db.query(DriverProfile)
        .filter(DriverProfile.uyushma_id == id)
        .offset(skip)
        .limit(limit)
        .all()
    )

    result = []
    for dp in profiles:
        result.append(
            DriverRead(
                id=dp.id,
                user_id=dp.user_id,
                uyushma_id=dp.uyushma_id,
                license_number=dp.license_number,
                is_active=dp.is_active,
                full_name=dp.user.full_name if dp.user else "",
                phone=dp.user.phone if dp.user else "",
                created_at=dp.created_at,
            )
        )
    return result
