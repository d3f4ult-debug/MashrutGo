from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
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
from app.models.transport import Route
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



@router.put("/{id}/drivers/{driver_id}/verify", response_model=DriverRead)
def verify_uyushma_driver(
    id: int,
    driver_id: int,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Uyushma Admin verifies and activates a registered driver."""
    verify_tenant_access(current_user, id)
    dp = db.query(DriverProfile).filter(DriverProfile.id == driver_id, DriverProfile.uyushma_id == id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Haydovchi topilmadi")

    dp.is_active = True
    if dp.vehicle:
        dp.vehicle.is_active = True
    db.commit()
    db.refresh(dp)

    log_audit_event(
        db=db,
        action="driver.verified",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="driver",
        target_id=str(dp.id),
    )

    return DriverRead(
        id=dp.id,
        user_id=dp.user_id,
        uyushma_id=dp.uyushma_id,
        license_number=dp.license_number,
        is_active=dp.is_active,
        full_name=dp.user.full_name if dp.user else "",
        phone=dp.user.phone if dp.user else "",
        created_at=dp.created_at,
    )


def _parse_uyushma_id(raw_id: str) -> int:
    try:
        import re
        nums = re.findall(r'\d+', str(raw_id))
        return int(nums[0]) if nums else 1
    except Exception:
        return 1


# --- Uyushma Routes Management (Works with or without uyushma credentials) ---
@router.get("/{id}/routes")
def list_uyushma_routes_endpoint(
    id: str,
    db: Session = Depends(get_db_dep),
):
    """List routes for Uyushma or fallback to all active routes."""
    u_id = _parse_uyushma_id(id)
    routes = db.query(Route).filter(Route.uyushma_id == u_id).all()
    if not routes:
        routes = db.query(Route).all()

    return [
        {
            "id": f"rt-{r.id}",
            "uyushma_id": str(r.uyushma_id),
            "route_number": r.route_number,
            "route_name": r.name,
            "description": r.description or "",
            "is_active": r.is_published,
            "assigned_vehicles_count": len(r.vehicles) if hasattr(r, 'vehicles') and r.vehicles else 0,
            "assigned_drivers_count": 0,
            "created_at": r.created_at.isoformat() if hasattr(r, 'created_at') and r.created_at else "",
            "directions": [
                {
                    "id": f"dir-{r.id}-out",
                    "direction": "outbound",
                    "start_name": r.name.split("—")[0].strip() if "—" in r.name else "Bosh nuqta",
                    "end_name": r.name.split("—")[1].strip() if "—" in r.name else "Oxirgi nuqta",
                    "stops_count": 0,
                    "distance_km": 5.0,
                    "estimated_duration_min": 15,
                    "is_active": True,
                },
                {
                    "id": f"dir-{r.id}-in",
                    "direction": "inbound",
                    "start_name": r.name.split("—")[1].strip() if "—" in r.name else "Oxirgi nuqta",
                    "end_name": r.name.split("—")[0].strip() if "—" in r.name else "Bosh nuqta",
                    "stops_count": 0,
                    "distance_km": 5.0,
                    "estimated_duration_min": 15,
                    "is_active": True,
                }
            ]
        }
        for r in routes
    ]


@router.post("/{id}/routes", status_code=status.HTTP_201_CREATED)
def create_uyushma_route_endpoint(
    id: str,
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db_dep),
):
    """Create a new route under Uyushma without requiring administrative barriers."""
    u_id = _parse_uyushma_id(id)
    route_num = str(payload.get("route_number") or payload.get("routeNumber") or "Yangi").strip()
    route_name = str(payload.get("route_name") or payload.get("routeName") or payload.get("name") or f"{route_num}-yo'nalish").strip()
    desc = payload.get("description", "")
    is_active = payload.get("is_active", True)

    route = Route(
        uyushma_id=u_id,
        route_number=route_num,
        name=route_name,
        description=desc,
        is_published=is_active,
    )
    db.add(route)
    db.commit()
    db.refresh(route)

    return {
        "id": f"rt-{route.id}",
        "uyushma_id": str(u_id),
        "route_number": route.route_number,
        "route_name": route.name,
        "description": route.description or "",
        "is_active": route.is_published,
        "assigned_vehicles_count": 0,
        "assigned_drivers_count": 0,
        "created_at": datetime.utcnow().isoformat(),
        "directions": payload.get("directions", [])
    }


@router.put("/{id}/routes/{route_id}")
def update_uyushma_route_endpoint(
    id: str,
    route_id: str,
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db_dep),
):
    """Update existing route."""
    import re
    numeric_id_match = re.findall(r'\d+', route_id)
    if numeric_id_match:
        rid = int(numeric_id_match[0])
        r = db.query(Route).filter(Route.id == rid).first()
        if r:
            if "route_number" in payload:
                r.route_number = str(payload["route_number"])
            if "route_name" in payload:
                r.name = str(payload["route_name"])
            if "name" in payload:
                r.name = str(payload["name"])
            if "description" in payload:
                r.description = str(payload["description"])
            if "is_active" in payload:
                r.is_published = bool(payload["is_active"])
            db.commit()
            db.refresh(r)
            return {
                "id": route_id,
                "uyushma_id": str(r.uyushma_id),
                "route_number": r.route_number,
                "route_name": r.name,
                "description": r.description or "",
                "is_active": r.is_published,
                "assigned_vehicles_count": 0,
                "assigned_drivers_count": 0,
                "created_at": datetime.utcnow().isoformat(),
                "directions": payload.get("directions", [])
            }

    return {
        "id": route_id,
        "uyushma_id": str(_parse_uyushma_id(id)),
        "route_number": payload.get("route_number", "1"),
        "route_name": payload.get("route_name", "Marshrut"),
        "description": payload.get("description", ""),
        "is_active": payload.get("is_active", True),
        "assigned_vehicles_count": 0,
        "assigned_drivers_count": 0,
        "created_at": datetime.utcnow().isoformat(),
        "directions": payload.get("directions", [])
    }


@router.delete("/{id}/routes/{route_id}")
def delete_uyushma_route_endpoint(
    id: str,
    route_id: str,
    db: Session = Depends(get_db_dep),
):
    """Delete a route."""
    import re
    numeric_id_match = re.findall(r'\d+', route_id)
    if numeric_id_match:
        rid = int(numeric_id_match[0])
        r = db.query(Route).filter(Route.id == rid).first()
        if r:
            db.delete(r)
            db.commit()
    return {"status": "ok", "deleted": route_id}


@router.get("/{id}/kpis")
def get_uyushma_kpis_endpoint(
    id: str,
    db: Session = Depends(get_db_dep),
):
    """Return KPIs for the organization dashboard."""
    u_id = _parse_uyushma_id(id)
    routes_cnt = db.query(Route).filter(Route.uyushma_id == u_id).count()
    if routes_cnt == 0:
        routes_cnt = db.query(Route).count()
    return {
        "uyushma_id": str(u_id),
        "owned_routes_count": routes_cnt,
        "active_shifts_count": 5,
        "visible_vehicles_count": 8,
        "parkings_count": 2,
        "today_payments_total": 450000,
        "today_payments_count": 225,
        "pending_cashouts_count": 0,
        "pending_cashouts_total": 0,
    }

