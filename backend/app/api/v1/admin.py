import math
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import (
    get_db_dep,
    require_super_admin,
    require_uyushma_admin,
    verify_tenant_access,
)
from app.core.roles import UserRole
from app.models.finance import Payment, Refund, WalletTransaction
from app.models.user import User, DriverProfile
from app.models.uyushma import Uyushma
from app.schemas.admin import (
    DashboardSummaryResponse,
    VehicleCreateRequest,
    VehicleUpdateRequest,
    VehicleDetailResponse,
    VehicleListResponse,
    DriverUpdateRequest,
    DriverDetailResponse,
    DriverListResponse,
    TariffCreateRequest,
    TariffUpdateRequest,
    TariffResponse,
    TariffListResponse,
    ClientDetailResponse,
    ClientUpdateRequest,
    ClientListResponse,
    ShiftDetailResponse,
    ShiftListResponse,
    SettingCreateRequest,
    SettingUpdateRequest,
    SettingResponse,
    AuditLogResponse,
    AuditLogListResponse,
    LiveStatusOverviewResponse,
)
from app.schemas.finance import (
    PaymentListResponse,
    PaymentResponse,
    RefundResponse,
    WalletTransactionListResponse,
    WalletTransactionResponse,
)
from app.services.admin_service import admin_service

router = APIRouter(prefix="/admin", tags=["admin"])


# --- 1. Dashboard ---
@router.get("/dashboard", response_model=DashboardSummaryResponse)
def get_dashboard_metrics(
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """
    Platform or Tenant-isolated Dashboard:
    - Overview of Uyushmas, routes, drivers, vehicles, parkings,
    - Realtime live vehicles and active shifts,
    - Financial totals: payments, refunds, ledger volume, pending cashouts.
    """
    return admin_service.get_dashboard_summary(current_user=current_user, db=db)


@router.get("/kpis", response_model=DashboardSummaryResponse)
def get_kpis_metrics(
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Alias for dashboard metrics used by admin panel."""
    return admin_service.get_dashboard_summary(current_user=current_user, db=db)


@router.get("/uyushmalar")
def list_admin_uyushmalar(
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """Super Admin gets list of registered Uyushma organizations."""
    uyushmas = db.query(Uyushma).all()
    res = []
    for u in uyushmas:
        routes_count = len(u.routes) if u.routes else 0
        drivers_count = len(u.drivers) if u.drivers else 0
        vehicles_count = len(u.vehicles) if u.vehicles else 0
        res.append({
            "id": str(u.id),
            "name": u.name,
            "region": u.address or "Andijon viloyati",
            "contact_person": "Boshqaruvchi",
            "contact_phone": u.phone or "",
            "admin_email": f"{u.code}@mashrutgo.uz",
            "license_number": f"LNZ-{u.code}-2024",
            "routes_count": routes_count,
            "drivers_count": drivers_count,
            "vehicles_count": vehicles_count,
            "status": "active" if u.is_active else "archived",
            "created_at": u.created_at.isoformat() if u.created_at else datetime.utcnow().isoformat(),
        })
    return res


# --- 2. Vehicles CRUD & Filter ---
@router.get("/vehicles", response_model=VehicleListResponse)
def list_vehicles_endpoint(
    uyushma_id: Optional[int] = Query(None, description="Filter by Uyushma ID"),
    route_id: Optional[int] = Query(None, description="Filter by Route ID"),
    driver_id: Optional[int] = Query(None, description="Filter by assigned Driver ID"),
    is_active: Optional[bool] = Query(None, description="Filter active/archived"),
    search: Optional[str] = Query(None, description="Search by internal_id, plate, or model"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """List and filter vehicles. Enforces tenant isolation for Uyushma Admins."""
    scoped_uyushma = current_user.uyushma_id if current_user.role != UserRole.SUPER_ADMIN.value else uyushma_id
    items, total = admin_service.list_vehicles(
        uyushma_id=scoped_uyushma,
        route_id=route_id,
        driver_id=driver_id,
        is_active=is_active,
        search=search,
        page=page,
        size=size,
        db=db,
    )
    pages = math.ceil(total / size) if size > 0 else 0

    return VehicleListResponse(
        items=[
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
            for v in items
        ],
        total=total,
        page=page,
        size=size,
        pages=pages,
    )


@router.post("/vehicles", response_model=VehicleDetailResponse, status_code=status.HTTP_201_CREATED)
def create_vehicle_endpoint(
    payload: VehicleCreateRequest,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Register a new vehicle under Uyushma."""
    if payload.uyushma_id:
        verify_tenant_access(current_user, payload.uyushma_id)
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


@router.put("/vehicles/{id}", response_model=VehicleDetailResponse)
def update_vehicle_endpoint(
    id: int,
    payload: VehicleUpdateRequest,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Update vehicle specifications, plate number, or driver/route assignment."""
    v = admin_service.update_vehicle(vehicle_id=id, data=payload, admin_user=current_user, db=db)
    verify_tenant_access(current_user, v.uyushma_id)
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


@router.delete("/vehicles/{id}", response_model=VehicleDetailResponse)
def archive_vehicle_endpoint(
    id: int,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Soft-delete / archive vehicle (sets is_active=False)."""
    v = admin_service.soft_delete_vehicle(vehicle_id=id, admin_user=current_user, db=db)
    verify_tenant_access(current_user, v.uyushma_id)
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


# --- 3. Drivers CRUD, Filter & Soft-Delete ---
@router.get("/drivers", response_model=DriverListResponse)
def list_drivers_endpoint(
    uyushma_id: Optional[int] = Query(None, description="Filter by Uyushma ID"),
    is_active: Optional[bool] = Query(None, description="Filter active/archived"),
    search: Optional[str] = Query(None, description="Search by name, phone, or license"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """List and filter driver accounts."""
    scoped_uyushma = current_user.uyushma_id if current_user.role != UserRole.SUPER_ADMIN.value else uyushma_id
    items, total = admin_service.list_drivers(
        uyushma_id=scoped_uyushma,
        is_active=is_active,
        search=search,
        page=page,
        size=size,
        db=db,
    )
    pages = math.ceil(total / size) if size > 0 else 0

    return DriverListResponse(
        items=[
            DriverDetailResponse(
                id=d.id,
                user_id=d.user_id,
                uyushma_id=d.uyushma_id,
                uyushma_name=d.uyushma.name if d.uyushma else None,
                full_name=d.user.full_name if d.user else "",
                phone=d.user.phone if d.user else "",
                license_number=d.license_number,
                is_active=d.is_active,
                assigned_vehicle_id=d.vehicle.id if d.vehicle else None,
                assigned_vehicle_internal_id=d.vehicle.internal_id if d.vehicle else None,
                wallet_balance_uzs=d.user.wallet.balance_uzs if d.user and d.user.wallet else 0,
                created_at=d.created_at,
            )
            for d in items
        ],
        total=total,
        page=page,
        size=size,
        pages=pages,
    )


@router.put("/drivers/{id}", response_model=DriverDetailResponse)
def update_driver_endpoint(
    id: int,
    payload: DriverUpdateRequest,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Update driver profile, name, or active status."""
    d = admin_service.update_driver(driver_id=id, data=payload, admin_user=current_user, db=db)
    verify_tenant_access(current_user, d.uyushma_id)
    return DriverDetailResponse(
        id=d.id,
        user_id=d.user_id,
        uyushma_id=d.uyushma_id,
        uyushma_name=d.uyushma.name if d.uyushma else None,
        full_name=d.user.full_name if d.user else "",
        phone=d.user.phone if d.user else "",
        license_number=d.license_number,
        is_active=d.is_active,
        assigned_vehicle_id=d.vehicle.id if d.vehicle else None,
        assigned_vehicle_internal_id=d.vehicle.internal_id if d.vehicle else None,
        wallet_balance_uzs=d.user.wallet.balance_uzs if d.user and d.user.wallet else 0,
        created_at=d.created_at,
    )


@router.delete("/drivers/{id}", response_model=DriverDetailResponse)
def archive_driver_endpoint(
    id: int,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Soft-delete / archive driver (sets is_active=False)."""
    d = admin_service.soft_delete_driver(driver_id=id, admin_user=current_user, db=db)
    verify_tenant_access(current_user, d.uyushma_id)
    return DriverDetailResponse(
        id=d.id,
        user_id=d.user_id,
        uyushma_id=d.uyushma_id,
        uyushma_name=d.uyushma.name if d.uyushma else None,
        full_name=d.user.full_name if d.user else "",
        phone=d.user.phone if d.user else "",
        license_number=d.license_number,
        is_active=d.is_active,
        assigned_vehicle_id=d.vehicle.id if d.vehicle else None,
        assigned_vehicle_internal_id=d.vehicle.internal_id if d.vehicle else None,
        wallet_balance_uzs=d.user.wallet.balance_uzs if d.user and d.user.wallet else 0,
        created_at=d.created_at,
    )


# --- 4. Tariffs (FareRules) CRUD & Filter ---
@router.get("/tariffs", response_model=TariffListResponse)
def list_tariffs_endpoint(
    uyushma_id: Optional[int] = Query(None, description="Filter by Uyushma ID"),
    route_id: Optional[int] = Query(None, description="Filter by Route ID"),
    rule_type: Optional[str] = Query(None, description="Filter by rule type (fixed, distance, zone)"),
    is_active: Optional[bool] = Query(None, description="Filter active/archived"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """List tariffs and fare rules."""
    scoped_uyushma = current_user.uyushma_id if current_user.role != UserRole.SUPER_ADMIN.value else uyushma_id
    items, total = admin_service.list_tariffs(
        uyushma_id=scoped_uyushma,
        route_id=route_id,
        rule_type=rule_type,
        is_active=is_active,
        page=page,
        size=size,
        db=db,
    )
    pages = math.ceil(total / size) if size > 0 else 0

    return TariffListResponse(
        items=[
            TariffResponse(
                id=t.id,
                uyushma_id=t.uyushma_id,
                uyushma_name=t.uyushma.name if t.uyushma else None,
                route_id=t.route_id,
                route_number=t.route.route_number if t.route else None,
                rule_type=t.rule_type,
                base_fare_uzs=t.base_fare_uzs,
                extra_fare_per_km_uzs=t.extra_fare_per_km_uzs,
                is_active=t.is_active,
                created_at=t.created_at,
                updated_at=t.updated_at,
            )
            for t in items
        ],
        total=total,
        page=page,
        size=size,
        pages=pages,
    )


@router.post("/tariffs", response_model=TariffResponse, status_code=status.HTTP_201_CREATED)
def create_tariff_endpoint(
    payload: TariffCreateRequest,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Create a new tariff / fare rule."""
    if payload.uyushma_id:
        verify_tenant_access(current_user, payload.uyushma_id)
    t = admin_service.create_tariff(data=payload, admin_user=current_user, db=db)
    return TariffResponse(
        id=t.id,
        uyushma_id=t.uyushma_id,
        uyushma_name=t.uyushma.name if t.uyushma else None,
        route_id=t.route_id,
        route_number=t.route.route_number if t.route else None,
        rule_type=t.rule_type,
        base_fare_uzs=t.base_fare_uzs,
        extra_fare_per_km_uzs=t.extra_fare_per_km_uzs,
        is_active=t.is_active,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


@router.put("/tariffs/{id}", response_model=TariffResponse)
def update_tariff_endpoint(
    id: int,
    payload: TariffUpdateRequest,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Update tariff parameters."""
    t = admin_service.update_tariff(tariff_id=id, data=payload, admin_user=current_user, db=db)
    verify_tenant_access(current_user, t.uyushma_id)
    return TariffResponse(
        id=t.id,
        uyushma_id=t.uyushma_id,
        uyushma_name=t.uyushma.name if t.uyushma else None,
        route_id=t.route_id,
        route_number=t.route.route_number if t.route else None,
        rule_type=t.rule_type,
        base_fare_uzs=t.base_fare_uzs,
        extra_fare_per_km_uzs=t.extra_fare_per_km_uzs,
        is_active=t.is_active,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


@router.delete("/tariffs/{id}", response_model=TariffResponse)
def archive_tariff_endpoint(
    id: int,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Soft-delete / archive tariff rule."""
    t = admin_service.soft_delete_tariff(tariff_id=id, admin_user=current_user, db=db)
    verify_tenant_access(current_user, t.uyushma_id)
    return TariffResponse(
        id=t.id,
        uyushma_id=t.uyushma_id,
        uyushma_name=t.uyushma.name if t.uyushma else None,
        route_id=t.route_id,
        route_number=t.route.route_number if t.route else None,
        rule_type=t.rule_type,
        base_fare_uzs=t.base_fare_uzs,
        extra_fare_per_km_uzs=t.extra_fare_per_km_uzs,
        is_active=t.is_active,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


# --- 5. Clients Management ---
@router.get("/clients", response_model=ClientListResponse)
def list_clients_endpoint(
    search: Optional[str] = Query(None, description="Search by phone or full_name"),
    is_active: Optional[bool] = Query(None, description="Filter active/blocked"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """List registered platform clients."""
    items, total = admin_service.list_clients(
        search=search,
        is_active=is_active,
        page=page,
        size=size,
        db=db,
    )
    pages = math.ceil(total / size) if size > 0 else 0

    return ClientListResponse(
        items=[
            ClientDetailResponse(
                id=u.id,
                phone=u.phone,
                full_name=u.full_name,
                is_active=u.is_active,
                preferred_language=u.client_profile.preferred_language if u.client_profile else "uz",
                wallet_balance_uzs=u.wallet.balance_uzs if u.wallet else 0,
                created_at=u.created_at,
            )
            for u in items
        ],
        total=total,
        page=page,
        size=size,
        pages=pages,
    )


@router.put("/clients/{id}", response_model=ClientDetailResponse)
def update_client_endpoint(
    id: int,
    payload: ClientUpdateRequest,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """Super Admin blocks/unblocks or updates client details."""
    u = admin_service.update_client(client_user_id=id, data=payload, admin_user=current_user, db=db)
    return ClientDetailResponse(
        id=u.id,
        phone=u.phone,
        full_name=u.full_name,
        is_active=u.is_active,
        preferred_language=u.client_profile.preferred_language if u.client_profile else "uz",
        wallet_balance_uzs=u.wallet.balance_uzs if u.wallet else 0,
        created_at=u.created_at,
    )


# --- 6. Shifts Monitoring ---
@router.get("/shifts", response_model=ShiftListResponse)
def list_shifts_endpoint(
    uyushma_id: Optional[int] = Query(None, description="Filter by Uyushma ID"),
    route_id: Optional[int] = Query(None, description="Filter by Route ID"),
    driver_id: Optional[int] = Query(None, description="Filter by Driver ID"),
    status: Optional[str] = Query(None, description="Filter by status (active, completed)"),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Monitor driver shift history."""
    scoped_uyushma = current_user.uyushma_id if current_user.role != UserRole.SUPER_ADMIN.value else uyushma_id
    items, total = admin_service.list_shifts(
        uyushma_id=scoped_uyushma,
        route_id=route_id,
        driver_id=driver_id,
        status_filter=status,
        date_from=date_from,
        date_to=date_to,
        page=page,
        size=size,
        db=db,
    )
    pages = math.ceil(total / size) if size > 0 else 0

    return ShiftListResponse(
        items=[
            ShiftDetailResponse(
                id=s.id,
                driver_id=s.driver_id,
                driver_name=s.driver.user.full_name if s.driver and s.driver.user else None,
                vehicle_id=s.vehicle_id,
                vehicle_internal_id=s.vehicle.internal_id if s.vehicle else None,
                route_id=s.route_id,
                route_number=s.route.route_number if s.route else None,
                direction=s.direction,
                status=s.status,
                started_at=s.started_at,
                ended_at=s.ended_at,
                last_gps_at=s.last_gps_at,
            )
            for s in items
        ],
        total=total,
        page=page,
        size=size,
        pages=pages,
    )


# --- 7. Live Fleet Status Overview ---
@router.get("/live-status", response_model=LiveStatusOverviewResponse)
def get_live_status_endpoint(
    uyushma_id: Optional[int] = Query(None, description="Filter by Uyushma ID"),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Real-time fleet overview showing all live vehicles, route distribution, and parking counts."""
    scoped_uyushma = current_user.uyushma_id if current_user.role != UserRole.SUPER_ADMIN.value else uyushma_id
    return admin_service.get_live_status_overview(uyushma_id=scoped_uyushma, db=db)


# --- 8. Transactions & Payments Ledger Monitoring ---
@router.get("/transactions", response_model=WalletTransactionListResponse)
def list_transactions_endpoint(
    wallet_id: Optional[int] = Query(None, description="Filter by Wallet ID"),
    entry_type: Optional[str] = Query(None, description="Filter by entry type (topup, ride_payment, refund, etc.)"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=100),
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """Super Admin audits platform-wide double-entry ledger transactions."""
    query = db.query(WalletTransaction)
    if wallet_id:
        query = query.filter(WalletTransaction.wallet_id == wallet_id)
    if entry_type:
        query = query.filter(WalletTransaction.entry_type == entry_type)

    total = query.count()
    items = query.order_by(WalletTransaction.id.desc()).offset((page - 1) * size).limit(size).all()
    pages = math.ceil(total / size) if size > 0 else 0

    return WalletTransactionListResponse(
        items=[
            WalletTransactionResponse(
                id=tx.id,
                wallet_id=tx.wallet_id,
                entry_type=tx.entry_type,
                amount_uzs=tx.amount_uzs,
                balance_after_uzs=tx.balance_after_uzs,
                reference_id=tx.reference_id,
                description=tx.description,
                idempotency_key=tx.idempotency_key,
                created_at=tx.created_at,
            )
            for tx in items
        ],
        total=total,
        page=page,
        size=size,
        pages=pages,
    )


# --- 9. Refunds Monitoring ---
@router.get("/refunds", response_model=List[RefundResponse])
def list_refunds_endpoint(
    driver_id: Optional[int] = Query(None, description="Filter by Driver ID"),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Monitor refunded payments."""
    query = db.query(Refund)
    if current_user.role != UserRole.SUPER_ADMIN.value:
        query = query.join(DriverProfile).filter(DriverProfile.uyushma_id == current_user.uyushma_id)
    elif driver_id:
        query = query.filter(Refund.driver_id == driver_id)

    items = query.order_by(Refund.id.desc()).limit(100).all()
    return [
        RefundResponse(
            id=r.id,
            payment_id=r.payment_id,
            driver_id=r.driver_id,
            amount_uzs=r.amount_uzs,
            reason=r.reason,
            status=r.status,
            created_at=r.created_at,
        )
        for r in items
    ]


# --- 10. System Settings CRUD ---
@router.get("/settings", response_model=List[SettingResponse])
def list_settings_endpoint(
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """Super Admin retrieves all global system settings."""
    items = admin_service.list_settings(db)
    return [
        SettingResponse(
            id=s.id,
            key=s.key,
            value=s.value,
            description=s.description,
            created_at=s.created_at,
            updated_at=s.updated_at,
        )
        for s in items
    ]


@router.post("/settings", response_model=SettingResponse)
def set_setting_endpoint(
    payload: SettingCreateRequest,
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """Super Admin creates or updates a global configuration setting."""
    s = admin_service.set_setting(
        key=payload.key,
        value=payload.value,
        description=payload.description,
        admin_user=current_user,
        db=db,
    )
    return SettingResponse(
        id=s.id,
        key=s.key,
        value=s.value,
        description=s.description,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


# --- 11. Audit Logs ---
@router.get("/audit-logs", response_model=AuditLogListResponse)
def list_audit_logs_endpoint(
    actor_user_id: Optional[int] = Query(None, description="Filter by Actor User ID"),
    action: Optional[str] = Query(None, description="Filter by Action prefix/name"),
    target_type: Optional[str] = Query(None, description="Filter by target type (vehicle, driver, etc.)"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=100),
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db_dep),
):
    """Super Admin audits system activity and security logs."""
    items, total = admin_service.list_audit_logs(
        actor_user_id=actor_user_id,
        action=action,
        target_type=target_type,
        page=page,
        size=size,
        db=db,
    )
    pages = math.ceil(total / size) if size > 0 else 0

    return AuditLogListResponse(
        items=[
            AuditLogResponse(
                id=a.id,
                actor_user_id=a.actor_user_id,
                actor_role=a.actor_role,
                action=a.action,
                target_type=a.target_type,
                target_id=a.target_id,
                changes_json=a.changes_json,
                ip_address=a.ip_address,
                created_at=a.created_at,
            )
            for a in items
        ],
        total=total,
        page=page,
        size=size,
        pages=pages,
    )
