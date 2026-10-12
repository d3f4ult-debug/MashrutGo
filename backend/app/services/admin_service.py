import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Tuple, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from fastapi import HTTPException, status

from app.core.roles import UserRole
from app.models.finance import (
    FareRule,
    Payment,
    Refund,
    CashoutRequest,
    Wallet,
    WalletTransaction,
)
from app.models.shift import DriverShift
from app.models.system import AuditLog, SystemSetting
from app.models.transport import Parking, Route, Vehicle
from app.models.user import DriverProfile, User, ClientProfile
from app.models.uyushma import Uyushma
from app.schemas.admin import (
    DashboardSummaryResponse,
    VehicleCreateRequest,
    VehicleUpdateRequest,
    DriverUpdateRequest,
    TariffCreateRequest,
    TariffUpdateRequest,
    ClientUpdateRequest,
    SettingCreateRequest,
    SettingUpdateRequest,
    LiveStatusOverviewResponse,
)
from app.services.audit_service import log_audit_event
from app.services.realtime.tracking_service import tracking_service

logger = logging.getLogger(__name__)


class AdminService:
    """Central administrative and tenant management service providing
    metrics dashboards, CRUD/filtering, and soft-delete/archiving operations.
    """

    # --- Dashboard Analytics ---
    def get_dashboard_summary(
        self,
        current_user: User,
        db: Session,
    ) -> DashboardSummaryResponse:
        """Compute platform or tenant-scoped summary dashboard statistics."""
        uyushma_id = current_user.uyushma_id if current_user.role != UserRole.SUPER_ADMIN.value else None

        # 1. Uyushmas
        total_uyushmas = db.query(Uyushma).count() if uyushma_id is None else 1

        # 2. Routes
        route_q = db.query(Route)
        if uyushma_id:
            route_q = route_q.filter(Route.uyushma_id == uyushma_id)
        total_routes = route_q.count()
        published_routes = route_q.filter(Route.is_published.is_(True)).count()

        # 3. Drivers
        drv_q = db.query(DriverProfile)
        if uyushma_id:
            drv_q = drv_q.filter(DriverProfile.uyushma_id == uyushma_id)
        total_drivers = drv_q.count()
        active_drivers = drv_q.filter(DriverProfile.is_active.is_(True)).count()

        # 4. Vehicles
        veh_q = db.query(Vehicle)
        if uyushma_id:
            veh_q = veh_q.filter(Vehicle.uyushma_id == uyushma_id)
        total_vehicles = veh_q.count()
        active_vehicles = veh_q.filter(Vehicle.is_active.is_(True)).count()

        # 5. Live / Online Telemetry Vehicles
        live_vehicles = tracking_service.get_live_vehicles(include_stale=False)
        if uyushma_id:
            # Filter live vehicles belonging to this Uyushma's routes
            uyushma_route_ids = set(r.id for r in route_q.all())
            live_vehicles = [v for v in live_vehicles if v.route_id in uyushma_route_ids]
        online_count = len(live_vehicles)

        # 6. Active Shifts
        shift_q = db.query(DriverShift).filter(DriverShift.status == "active")
        if uyushma_id:
            shift_q = shift_q.join(DriverProfile).filter(DriverProfile.uyushma_id == uyushma_id)
        active_shifts_count = shift_q.count()

        # 7. Parkings
        pkg_q = db.query(Parking)
        if uyushma_id:
            pkg_q = pkg_q.filter(Parking.uyushma_id == uyushma_id)
        total_parkings = pkg_q.count()
        in_parking_count = sum(1 for v in live_vehicles if v.parking_id is not None)

        # 8. Clients
        client_q = db.query(User).filter(User.role == UserRole.CLIENT.value)
        total_clients = client_q.count()

        # 9. Payments & Volumes
        pay_q = db.query(Payment)
        if uyushma_id:
            pay_q = pay_q.join(Vehicle).filter(Vehicle.uyushma_id == uyushma_id)
        total_payments = pay_q.count()
        total_payment_vol = db.query(func.coalesce(func.sum(Payment.amount_uzs), 0)).scalar() or 0
        if uyushma_id:
            total_payment_vol = (
                db.query(func.coalesce(func.sum(Payment.amount_uzs), 0))
                .join(Vehicle)
                .filter(Vehicle.uyushma_id == uyushma_id)
                .scalar() or 0
            )

        # 10. Refunds
        ref_q = db.query(Refund)
        if uyushma_id:
            ref_q = ref_q.join(DriverProfile).filter(DriverProfile.uyushma_id == uyushma_id)
        total_refunds = ref_q.count()
        total_refund_vol = db.query(func.coalesce(func.sum(Refund.amount_uzs), 0)).scalar() or 0
        if uyushma_id:
            total_refund_vol = (
                db.query(func.coalesce(func.sum(Refund.amount_uzs), 0))
                .join(DriverProfile)
                .filter(DriverProfile.uyushma_id == uyushma_id)
                .scalar() or 0
            )

        # 11. Transactions
        tx_count = db.query(WalletTransaction).count()
        tx_vol = db.query(func.coalesce(func.sum(func.abs(WalletTransaction.amount_uzs)), 0)).scalar() or 0

        # 12. Cashouts
        cash_q = db.query(CashoutRequest).filter(CashoutRequest.status == "pending")
        if uyushma_id:
            cash_q = cash_q.filter(CashoutRequest.uyushma_id == uyushma_id)
        pending_cashouts = cash_q.count()
        pending_cashout_vol = (
            db.query(func.coalesce(func.sum(CashoutRequest.amount_uzs), 0))
            .filter(CashoutRequest.status == "pending")
        )
        if uyushma_id:
            pending_cashout_vol = pending_cashout_vol.filter(CashoutRequest.uyushma_id == uyushma_id)
        pending_cashout_amt = pending_cashout_vol.scalar() or 0

        return DashboardSummaryResponse(
            total_uyushmas=total_uyushmas,
            total_routes=total_routes,
            published_routes=published_routes,
            total_drivers=total_drivers,
            active_drivers=active_drivers,
            total_vehicles=total_vehicles,
            active_vehicles=active_vehicles,
            online_vehicles_count=online_count,
            active_shifts_count=active_shifts_count,
            total_parkings=total_parkings,
            vehicles_in_parking_count=in_parking_count,
            total_clients=total_clients,
            total_transactions_count=tx_count,
            total_transaction_volume_uzs=tx_vol,
            total_payments_count=total_payments,
            total_payment_volume_uzs=total_payment_vol,
            total_refunds_count=total_refunds,
            total_refund_volume_uzs=total_refund_vol,
            pending_cashouts_count=pending_cashouts,
            pending_cashout_amount_uzs=pending_cashout_amt,
        )

    # --- Vehicles CRUD, Filter & Soft-Delete ---
    def create_vehicle(
        self,
        data: VehicleCreateRequest,
        admin_user: User,
        db: Session,
    ) -> Vehicle:
        """Register vehicle enforcing mandatory internal ID and 1 driver -> 1 vehicle rule."""
        target_uyushma_id = data.uyushma_id or admin_user.uyushma_id
        if not target_uyushma_id:
            raise HTTPException(status_code=400, detail="Uyushma ID ko'rsatilishi shart")

        # Auto-generate internal_id if missing
        internal_id = data.internal_id or f"AND-V-{uuid.uuid4().hex[:6].upper()}"

        # Uniqueness check
        existing = db.query(Vehicle).filter(Vehicle.internal_id == internal_id).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"'{internal_id}' kodli transport allaqachon mavjud")

        # 1 Driver -> 1 Vehicle enforcement
        if data.driver_id is not None:
            assigned = db.query(Vehicle).filter(Vehicle.driver_id == data.driver_id).first()
            if assigned:
                raise HTTPException(
                    status_code=400,
                    detail=f"Haydovchi #{data.driver_id} allaqachon boshqa transportga ({assigned.internal_id}) biriktirilgan",
                )

        vehicle = Vehicle(
            internal_id=internal_id,
            uyushma_id=target_uyushma_id,
            driver_id=data.driver_id,
            route_id=data.route_id,
            plate_number=data.plate_number,
            model=data.model,
            color=data.color,
            capacity=data.capacity,
            is_active=data.is_active,
        )
        db.add(vehicle)
        db.commit()
        db.refresh(vehicle)

        log_audit_event(
            db=db,
            action="vehicle.create",
            actor_user_id=admin_user.id,
            actor_role=admin_user.role,
            target_type="vehicle",
            target_id=str(vehicle.id),
            changes={"internal_id": vehicle.internal_id, "uyushma_id": target_uyushma_id},
        )
        return vehicle

    def update_vehicle(
        self,
        vehicle_id: int,
        data: VehicleUpdateRequest,
        admin_user: User,
        db: Session,
    ) -> Vehicle:
        """Update vehicle attributes and reassign driver/route."""
        vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
        if not vehicle:
            raise HTTPException(status_code=404, detail="Transport vositasi topilmadi")

        changes: Dict[str, Any] = {}

        if data.driver_id is not None:
            if data.driver_id != vehicle.driver_id:
                # Enforce 1 driver -> 1 vehicle
                assigned = (
                    db.query(Vehicle)
                    .filter(Vehicle.driver_id == data.driver_id, Vehicle.id != vehicle.id)
                    .first()
                )
                if assigned:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Haydovchi #{data.driver_id} allaqachon boshqa transportga ({assigned.internal_id}) biriktirilgan",
                    )
            vehicle.driver_id = data.driver_id
            changes["driver_id"] = data.driver_id

        if data.route_id is not None:
            vehicle.route_id = data.route_id
            changes["route_id"] = data.route_id
        if data.plate_number is not None:
            vehicle.plate_number = data.plate_number
            changes["plate_number"] = data.plate_number
        if data.model is not None:
            vehicle.model = data.model
            changes["model"] = data.model
        if data.color is not None:
            vehicle.color = data.color
            changes["color"] = data.color
        if data.capacity is not None:
            vehicle.capacity = data.capacity
            changes["capacity"] = data.capacity
        if data.is_active is not None:
            vehicle.is_active = data.is_active
            changes["is_active"] = data.is_active

        db.commit()
        db.refresh(vehicle)

        log_audit_event(
            db=db,
            action="vehicle.update",
            actor_user_id=admin_user.id,
            actor_role=admin_user.role,
            target_type="vehicle",
            target_id=str(vehicle.id),
            changes=changes,
        )
        return vehicle

    def soft_delete_vehicle(
        self,
        vehicle_id: int,
        admin_user: User,
        db: Session,
    ) -> Vehicle:
        """Soft-delete / archive vehicle (sets is_active=False)."""
        vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
        if not vehicle:
            raise HTTPException(status_code=404, detail="Transport vositasi topilmadi")

        vehicle.is_active = False
        db.commit()
        db.refresh(vehicle)

        log_audit_event(
            db=db,
            action="vehicle.archive",
            actor_user_id=admin_user.id,
            actor_role=admin_user.role,
            target_type="vehicle",
            target_id=str(vehicle.id),
            changes={"is_active": False},
        )
        return vehicle

    def list_vehicles(
        self,
        uyushma_id: Optional[int],
        route_id: Optional[int],
        driver_id: Optional[int],
        is_active: Optional[bool],
        search: Optional[str],
        page: int,
        size: int,
        db: Session,
    ) -> Tuple[List[Vehicle], int]:
        """Query and filter vehicles with pagination."""
        query = db.query(Vehicle)
        if uyushma_id is not None:
            query = query.filter(Vehicle.uyushma_id == uyushma_id)
        if route_id is not None:
            query = query.filter(Vehicle.route_id == route_id)
        if driver_id is not None:
            query = query.filter(Vehicle.driver_id == driver_id)
        if is_active is not None:
            query = query.filter(Vehicle.is_active == is_active)
        if search:
            query = query.filter(
                or_(
                    Vehicle.internal_id.ilike(f"%{search}%"),
                    Vehicle.plate_number.ilike(f"%{search}%"),
                    Vehicle.model.ilike(f"%{search}%"),
                )
            )

        total = query.count()
        items = query.order_by(Vehicle.id.desc()).offset((page - 1) * size).limit(size).all()
        return items, total

    # --- Driver Management & Soft-Delete ---
    def update_driver(
        self,
        driver_id: int,
        data: DriverUpdateRequest,
        admin_user: User,
        db: Session,
    ) -> DriverProfile:
        """Update driver profile and status."""
        driver = db.query(DriverProfile).filter(DriverProfile.id == driver_id).first()
        if not driver:
            raise HTTPException(status_code=404, detail="Haydovchi topilmadi")

        changes: Dict[str, Any] = {}
        if data.full_name is not None and driver.user:
            driver.user.full_name = data.full_name
            changes["full_name"] = data.full_name
        if data.license_number is not None:
            driver.license_number = data.license_number
            changes["license_number"] = data.license_number
        if data.uyushma_id is not None:
            driver.uyushma_id = data.uyushma_id
            changes["uyushma_id"] = data.uyushma_id
        if data.is_active is not None:
            driver.is_active = data.is_active
            if driver.user:
                driver.user.is_active = data.is_active
            changes["is_active"] = data.is_active

        db.commit()
        db.refresh(driver)

        log_audit_event(
            db=db,
            action="driver.update",
            actor_user_id=admin_user.id,
            actor_role=admin_user.role,
            target_type="driver",
            target_id=str(driver.id),
            changes=changes,
        )
        return driver

    def soft_delete_driver(
        self,
        driver_id: int,
        admin_user: User,
        db: Session,
    ) -> DriverProfile:
        """Soft delete driver (deactivates driver profile & user account)."""
        driver = db.query(DriverProfile).filter(DriverProfile.id == driver_id).first()
        if not driver:
            raise HTTPException(status_code=404, detail="Haydovchi topilmadi")

        driver.is_active = False
        if driver.user:
            driver.user.is_active = False

        # Clean up any active vehicle assignment
        if driver.vehicle:
            driver.vehicle.driver_id = None

        db.commit()
        db.refresh(driver)

        log_audit_event(
            db=db,
            action="driver.archive",
            actor_user_id=admin_user.id,
            actor_role=admin_user.role,
            target_type="driver",
            target_id=str(driver.id),
            changes={"is_active": False},
        )
        return driver

    def list_drivers(
        self,
        uyushma_id: Optional[int],
        is_active: Optional[bool],
        search: Optional[str],
        page: int,
        size: int,
        db: Session,
    ) -> Tuple[List[DriverProfile], int]:
        """Query and filter drivers with pagination."""
        query = db.query(DriverProfile).join(User, DriverProfile.user_id == User.id)
        if uyushma_id is not None:
            query = query.filter(DriverProfile.uyushma_id == uyushma_id)
        if is_active is not None:
            query = query.filter(DriverProfile.is_active == is_active)
        if search:
            query = query.filter(
                or_(
                    User.full_name.ilike(f"%{search}%"),
                    User.phone.ilike(f"%{search}%"),
                    DriverProfile.license_number.ilike(f"%{search}%"),
                )
            )

        total = query.count()
        items = query.order_by(DriverProfile.id.desc()).offset((page - 1) * size).limit(size).all()
        return items, total

    # --- Tariffs (FareRules) CRUD & Soft-Delete ---
    def create_tariff(
        self,
        data: TariffCreateRequest,
        admin_user: User,
        db: Session,
    ) -> FareRule:
        """Create new fare rule / tariff."""
        target_uyushma_id = data.uyushma_id or admin_user.uyushma_id
        if not target_uyushma_id:
            raise HTTPException(status_code=400, detail="Uyushma ID talab qilinadi")

        rule = FareRule(
            uyushma_id=target_uyushma_id,
            route_id=data.route_id,
            rule_type=data.rule_type,
            base_fare_uzs=data.base_fare_uzs,
            extra_fare_per_km_uzs=data.extra_fare_per_km_uzs,
            is_active=data.is_active,
        )
        db.add(rule)
        db.commit()
        db.refresh(rule)

        log_audit_event(
            db=db,
            action="tariff.create",
            actor_user_id=admin_user.id,
            actor_role=admin_user.role,
            target_type="fare_rule",
            target_id=str(rule.id),
            changes={"base_fare_uzs": rule.base_fare_uzs, "rule_type": rule.rule_type},
        )
        return rule

    def update_tariff(
        self,
        tariff_id: int,
        data: TariffUpdateRequest,
        admin_user: User,
        db: Session,
    ) -> FareRule:
        """Update existing tariff rule."""
        rule = db.query(FareRule).filter(FareRule.id == tariff_id).first()
        if not rule:
            raise HTTPException(status_code=404, detail="Tarif topilmadi")

        changes: Dict[str, Any] = {}
        if data.rule_type is not None:
            rule.rule_type = data.rule_type
            changes["rule_type"] = data.rule_type
        if data.base_fare_uzs is not None:
            rule.base_fare_uzs = data.base_fare_uzs
            changes["base_fare_uzs"] = data.base_fare_uzs
        if data.extra_fare_per_km_uzs is not None:
            rule.extra_fare_per_km_uzs = data.extra_fare_per_km_uzs
            changes["extra_fare_per_km_uzs"] = data.extra_fare_per_km_uzs
        if data.is_active is not None:
            rule.is_active = data.is_active
            changes["is_active"] = data.is_active

        db.commit()
        db.refresh(rule)

        log_audit_event(
            db=db,
            action="tariff.update",
            actor_user_id=admin_user.id,
            actor_role=admin_user.role,
            target_type="fare_rule",
            target_id=str(rule.id),
            changes=changes,
        )
        return rule

    def soft_delete_tariff(
        self,
        tariff_id: int,
        admin_user: User,
        db: Session,
    ) -> FareRule:
        """Soft-delete / archive tariff rule."""
        rule = db.query(FareRule).filter(FareRule.id == tariff_id).first()
        if not rule:
            raise HTTPException(status_code=404, detail="Tarif topilmadi")

        rule.is_active = False
        db.commit()
        db.refresh(rule)

        log_audit_event(
            db=db,
            action="tariff.archive",
            actor_user_id=admin_user.id,
            actor_role=admin_user.role,
            target_type="fare_rule",
            target_id=str(rule.id),
            changes={"is_active": False},
        )
        return rule

    def list_tariffs(
        self,
        uyushma_id: Optional[int],
        route_id: Optional[int],
        rule_type: Optional[str],
        is_active: Optional[bool],
        page: int,
        size: int,
        db: Session,
    ) -> Tuple[List[FareRule], int]:
        """Query and filter tariffs."""
        query = db.query(FareRule)
        if uyushma_id is not None:
            query = query.filter(FareRule.uyushma_id == uyushma_id)
        if route_id is not None:
            query = query.filter(FareRule.route_id == route_id)
        if rule_type:
            query = query.filter(FareRule.rule_type == rule_type)
        if is_active is not None:
            query = query.filter(FareRule.is_active == is_active)

        total = query.count()
        items = query.order_by(FareRule.id.desc()).offset((page - 1) * size).limit(size).all()
        return items, total

    # --- Client Management ---
    def list_clients(
        self,
        search: Optional[str],
        is_active: Optional[bool],
        page: int,
        size: int,
        db: Session,
    ) -> Tuple[List[User], int]:
        """Query clients registered on the platform."""
        query = db.query(User).filter(User.role == UserRole.CLIENT.value)
        if is_active is not None:
            query = query.filter(User.is_active == is_active)
        if search:
            query = query.filter(
                or_(
                    User.full_name.ilike(f"%{search}%"),
                    User.phone.ilike(f"%{search}%"),
                )
            )

        total = query.count()
        items = query.order_by(User.id.desc()).offset((page - 1) * size).limit(size).all()
        return items, total

    def update_client(
        self,
        client_user_id: int,
        data: ClientUpdateRequest,
        admin_user: User,
        db: Session,
    ) -> User:
        """Update client status (block/unblock) and name."""
        client = db.query(User).filter(User.id == client_user_id, User.role == UserRole.CLIENT.value).first()
        if not client:
            raise HTTPException(status_code=404, detail="Mijoz topilmadi")

        changes: Dict[str, Any] = {}
        if data.full_name is not None:
            client.full_name = data.full_name
            changes["full_name"] = data.full_name
        if data.is_active is not None:
            client.is_active = data.is_active
            changes["is_active"] = data.is_active

        db.commit()
        db.refresh(client)

        log_audit_event(
            db=db,
            action="client.update",
            actor_user_id=admin_user.id,
            actor_role=admin_user.role,
            target_type="user",
            target_id=str(client.id),
            changes=changes,
        )
        return client

    # --- Shifts Monitoring ---
    def list_shifts(
        self,
        uyushma_id: Optional[int],
        route_id: Optional[int],
        driver_id: Optional[int],
        status_filter: Optional[str],
        date_from: Optional[datetime],
        date_to: Optional[datetime],
        page: int,
        size: int,
        db: Session,
    ) -> Tuple[List[DriverShift], int]:
        """Query driver shift history."""
        query = db.query(DriverShift)
        if uyushma_id:
            query = query.join(DriverProfile).filter(DriverProfile.uyushma_id == uyushma_id)
        if route_id:
            query = query.filter(DriverShift.route_id == route_id)
        if driver_id:
            query = query.filter(DriverShift.driver_id == driver_id)
        if status_filter:
            query = query.filter(DriverShift.status == status_filter)
        if date_from:
            query = query.filter(DriverShift.started_at >= date_from)
        if date_to:
            query = query.filter(DriverShift.started_at <= date_to)

        total = query.count()
        items = query.order_by(DriverShift.id.desc()).offset((page - 1) * size).limit(size).all()
        return items, total

    # --- System Settings CRUD ---
    def get_setting(self, key: str, db: Session) -> Optional[SystemSetting]:
        return db.query(SystemSetting).filter(SystemSetting.key == key).first()

    def set_setting(
        self,
        key: str,
        value: str,
        description: Optional[str],
        admin_user: User,
        db: Session,
    ) -> SystemSetting:
        setting = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        now = datetime.now(timezone.utc)
        if setting:
            setting.value = value
            if description:
                setting.description = description
            setting.updated_at = now
        else:
            setting = SystemSetting(
                key=key,
                value=value,
                description=description,
                created_at=now,
                updated_at=now,
            )
            db.add(setting)

        db.commit()
        db.refresh(setting)

        log_audit_event(
            db=db,
            action="setting.update",
            actor_user_id=admin_user.id,
            actor_role=admin_user.role,
            target_type="system_setting",
            target_id=str(setting.id),
            changes={"key": key, "value": value},
        )
        return setting

    def list_settings(self, db: Session) -> List[SystemSetting]:
        return db.query(SystemSetting).order_by(SystemSetting.key.asc()).all()

    # --- Audit Logs ---
    def list_audit_logs(
        self,
        actor_user_id: Optional[int],
        action: Optional[str],
        target_type: Optional[str],
        page: int,
        size: int,
        db: Session,
    ) -> Tuple[List[AuditLog], int]:
        query = db.query(AuditLog)
        if actor_user_id:
            query = query.filter(AuditLog.actor_user_id == actor_user_id)
        if action:
            query = query.filter(AuditLog.action.ilike(f"%{action}%"))
        if target_type:
            query = query.filter(AuditLog.target_type == target_type)

        total = query.count()
        items = query.order_by(AuditLog.id.desc()).offset((page - 1) * size).limit(size).all()
        return items, total

    # --- Live Status Overview ---
    def get_live_status_overview(
        self,
        uyushma_id: Optional[int],
        db: Session,
    ) -> LiveStatusOverviewResponse:
        vehicles = tracking_service.get_live_vehicles(include_stale=False)
        if uyushma_id:
            routes = db.query(Route.id).filter(Route.uyushma_id == uyushma_id).all()
            route_ids = set(r[0] for r in routes)
            vehicles = [v for v in vehicles if v.route_id in route_ids]

        by_route: Dict[str, int] = {}
        parking_count = 0
        for v in vehicles:
            by_route[v.route_number] = by_route.get(v.route_number, 0) + 1
            if v.parking_id is not None:
                parking_count += 1

        return LiveStatusOverviewResponse(
            online_vehicles=vehicles,
            total_online=len(vehicles),
            by_route=by_route,
            in_parking_count=parking_count,
        )


admin_service = AdminService()
