from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
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
from app.models.finance import CashoutRequest
from app.models.user import User, DriverProfile
from app.models.uyushma import Uyushma
from app.schemas.user import DriverCreateRequest, DriverRead
from app.schemas.uyushma import UyushmaCreate, UyushmaRead, UyushmaUpdate
from app.schemas.finance import (
    CashoutResponse,
    CashoutActionRequest,
    CashoutListResponse,
)
from app.services.audit_service import log_audit_event
from app.services.payment.cashout_service import cashout_service
from app.schemas.admin import VehicleCreateRequest, VehicleDetailResponse
from app.services.admin_service import admin_service

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


# --- Uyushma Cashout Management (Stage 7) - Placed BEFORE parameterized /{id} ---
@router.get("/cashouts", response_model=CashoutListResponse)
def list_my_uyushma_cashouts(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=100),
    status: Optional[str] = Query(None, description="Filter by status (pending, approved, rejected, paid)"),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """List cashout requests within current Uyushma tenant."""
    uyushma_id = current_user.uyushma_id if current_user.role != UserRole.SUPER_ADMIN.value else None
    items, total = cashout_service.list_uyushma_cashouts(
        uyushma_id=uyushma_id,
        status_filter=status,
        page=page,
        size=size,
        db=db,
    )
    pages = (total + size - 1) // size if size > 0 else 0

    return CashoutListResponse(
        items=[
            CashoutResponse(
                id=c.id,
                driver_id=c.driver_id,
                driver_name=c.driver.user.full_name if c.driver and c.driver.user else None,
                uyushma_id=c.uyushma_id,
                amount_uzs=c.amount_uzs,
                status=c.status,
                approved_by_user_id=c.approved_by_user_id,
                processed_at=c.processed_at,
                notes=c.notes,
                created_at=c.created_at,
                updated_at=c.updated_at,
            )
            for c in items
        ],
        total=total,
        page=page,
        size=size,
        pages=pages,
    )


@router.post("/cashout/{id}/approve", response_model=CashoutResponse)
def approve_cashout_endpoint(
    id: int,
    payload: CashoutActionRequest = CashoutActionRequest(),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Uyushma admin approves cashout request."""
    req = db.query(CashoutRequest).filter(CashoutRequest.id == id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Cashout so'rovi topilmadi")
    verify_tenant_access(current_user, req.uyushma_id)

    res = cashout_service.approve_cashout_request(
        cashout_id=id,
        admin_user=current_user,
        notes=payload.notes,
        db=db,
    )
    return CashoutResponse(
        id=res.id,
        driver_id=res.driver_id,
        driver_name=res.driver.user.full_name if res.driver and res.driver.user else None,
        uyushma_id=res.uyushma_id,
        amount_uzs=res.amount_uzs,
        status=res.status,
        approved_by_user_id=res.approved_by_user_id,
        processed_at=res.processed_at,
        notes=res.notes,
        created_at=res.created_at,
        updated_at=res.updated_at,
    )


@router.post("/cashout/{id}/reject", response_model=CashoutResponse)
def reject_cashout_endpoint(
    id: int,
    payload: CashoutActionRequest = CashoutActionRequest(),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Uyushma admin rejects cashout request."""
    req = db.query(CashoutRequest).filter(CashoutRequest.id == id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Cashout so'rovi topilmadi")
    verify_tenant_access(current_user, req.uyushma_id)

    res = cashout_service.reject_cashout_request(
        cashout_id=id,
        admin_user=current_user,
        notes=payload.notes,
        db=db,
    )
    return CashoutResponse(
        id=res.id,
        driver_id=res.driver_id,
        driver_name=res.driver.user.full_name if res.driver and res.driver.user else None,
        uyushma_id=res.uyushma_id,
        amount_uzs=res.amount_uzs,
        status=res.status,
        approved_by_user_id=res.approved_by_user_id,
        processed_at=res.processed_at,
        notes=res.notes,
        created_at=res.created_at,
        updated_at=res.updated_at,
    )


@router.post("/cashout/{id}/pay", response_model=CashoutResponse)
def pay_cashout_endpoint(
    id: int,
    payload: CashoutActionRequest = CashoutActionRequest(),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Uyushma admin marks cashout paid and executes double-entry ledger debit."""
    req = db.query(CashoutRequest).filter(CashoutRequest.id == id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Cashout so'rovi topilmadi")
    verify_tenant_access(current_user, req.uyushma_id)

    res = cashout_service.mark_cashout_paid(
        cashout_id=id,
        admin_user=current_user,
        notes=payload.notes,
        db=db,
    )
    return CashoutResponse(
        id=res.id,
        driver_id=res.driver_id,
        driver_name=res.driver.user.full_name if res.driver and res.driver.user else None,
        uyushma_id=res.uyushma_id,
        amount_uzs=res.amount_uzs,
        status=res.status,
        approved_by_user_id=res.approved_by_user_id,
        processed_at=res.processed_at,
        notes=res.notes,
        created_at=res.created_at,
        updated_at=res.updated_at,
    )


# --- Parameterized Uyushma routes ---
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


@router.put("/{id}", response_model=UyushmaRead)
def update_uyushma(
    id: int,
    payload: UyushmaUpdate,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """Super Admin updates an existing Uyushma organization."""
    uyushma = db.query(Uyushma).filter(Uyushma.id == id).first()
    if not uyushma:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uyushma not found",
        )

    changes = {}
    if payload.name is not None:
        uyushma.name = payload.name
        changes["name"] = payload.name
    if payload.phone is not None:
        uyushma.phone = payload.phone
        changes["phone"] = payload.phone
    if payload.address is not None:
        uyushma.address = payload.address
        changes["address"] = payload.address
    if payload.is_active is not None:
        uyushma.is_active = payload.is_active
        changes["is_active"] = payload.is_active

    db.commit()
    db.refresh(uyushma)

    log_audit_event(
        db=db,
        action="uyushma.update",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="uyushma",
        target_id=str(uyushma.id),
        changes=changes,
    )
    return uyushma


@router.delete("/{id}", response_model=UyushmaRead)
def archive_uyushma(
    id: int,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """Super Admin soft-deletes / archives an Uyushma organization (sets is_active=False)."""
    uyushma = db.query(Uyushma).filter(Uyushma.id == id).first()
    if not uyushma:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uyushma not found",
        )
    uyushma.is_active = False
    db.commit()
    db.refresh(uyushma)

    log_audit_event(
        db=db,
        action="uyushma.archive",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="uyushma",
        target_id=str(uyushma.id),
        changes={"is_active": False},
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

    existing_user = db.query(User).filter(User.phone == payload.phone).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number already registered to an account",
        )

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


@router.get("/{id}/cashouts", response_model=CashoutListResponse)
def list_specific_uyushma_cashouts(
    id: int,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=100),
    status: Optional[str] = Query(None, description="Filter by status (pending, approved, rejected, paid)"),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """List cashouts for specific Uyushma (tenant isolated)."""
    verify_tenant_access(current_user, id)
    items, total = cashout_service.list_uyushma_cashouts(
        uyushma_id=id,
        status_filter=status,
        page=page,
        size=size,
        db=db,
    )
    pages = (total + size - 1) // size if size > 0 else 0

    return CashoutListResponse(
        items=[
            CashoutResponse(
                id=c.id,
                driver_id=c.driver_id,
                driver_name=c.driver.user.full_name if c.driver and c.driver.user else None,
                uyushma_id=c.uyushma_id,
                amount_uzs=c.amount_uzs,
                status=c.status,
                approved_by_user_id=c.approved_by_user_id,
                processed_at=c.processed_at,
                notes=c.notes,
                created_at=c.created_at,
                updated_at=c.updated_at,
            )
            for c in items
        ],
        total=total,
        page=page,
        size=size,
        pages=pages,
    )


@router.get("/{id}/vehicles", response_model=List[VehicleDetailResponse])
def list_uyushma_vehicles(
    id: int,
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """List all vehicles belonging to the specified Uyushma. Tenant-isolated."""
    verify_tenant_access(current_user, id)
    vehicles, _ = admin_service.list_vehicles(
        uyushma_id=id,
        route_id=None,
        driver_id=None,
        is_active=None,
        search=None,
        page=skip // limit + 1 if limit > 0 else 1,
        size=limit,
        db=db,
    )
    return [
        VehicleDetailResponse(
            id=v.id,
            internal_id=v.internal_id,
            uyushma_id=v.uyushma_id,
            uyushma_name=v.uyushma.name if v.uyushma else None,
            driver_id=v.driver_id,
            driver_name=v.driver.user.full_name if v.driver and v.driver.user else None,
            route_id=v.route_id,
            route_number=v.route.route_number if v.route else None,
            plate_number=v.plate_number,
            model=v.model,
            color=v.color,
            capacity=v.capacity,
            is_active=v.is_active,
            created_at=v.created_at,
            updated_at=v.updated_at,
        )
        for v in vehicles
    ]


@router.post("/{id}/vehicles", response_model=VehicleDetailResponse, status_code=status.HTTP_201_CREATED)
def create_vehicle_for_uyushma(
    id: int,
    payload: VehicleCreateRequest,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Register a vehicle directly under specified Uyushma. Tenant-isolated."""
    verify_tenant_access(current_user, id)
    payload.uyushma_id = id
    v = admin_service.create_vehicle(data=payload, admin_user=current_user, db=db)
    return VehicleDetailResponse(
        id=v.id,
        internal_id=v.internal_id,
        uyushma_id=v.uyushma_id,
        uyushma_name=v.uyushma.name if v.uyushma else None,
        driver_id=v.driver_id,
        driver_name=v.driver.user.full_name if v.driver and v.driver.user else None,
        route_id=v.route_id,
        route_number=v.route.route_number if v.route else None,
        plate_number=v.plate_number,
        model=v.model,
        color=v.color,
        capacity=v.capacity,
        is_active=v.is_active,
        created_at=v.created_at,
        updated_at=v.updated_at,
    )

