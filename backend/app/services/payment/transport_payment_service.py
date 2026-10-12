import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Tuple
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.core.config import settings
from app.models.finance import Payment, Refund, Wallet
from app.models.transport import Vehicle, Route
from app.models.user import DriverProfile, User
from app.services.audit_service import log_audit_event
from app.services.fare.fare_service import fare_service
from app.services.wallet.ledger_service import (
    wallet_ledger_service,
    InsufficientFundsError,
)

logger = logging.getLogger(__name__)


class TransportPaymentService:
    """Service handling vehicle identifier resolution, fare resolution,
    double-entry transport ride payments, driver payment visibility,
    and grace-period protected refunds.
    """

    def resolve_vehicle(self, identifier: str, db: Session) -> Vehicle:
        """Resolve vehicle by internal ID (e.g. 'AND-101'), ID, or QR code."""
        cleaned = identifier.strip()

        # 1. Exact match on internal_id (case-insensitive)
        vehicle = (
            db.query(Vehicle)
            .filter(Vehicle.internal_id.ilike(cleaned), Vehicle.is_active.is_(True))
            .first()
        )

        # 2. Match on numeric ID
        if not vehicle and cleaned.isdigit():
            vehicle = (
                db.query(Vehicle)
                .filter(Vehicle.id == int(cleaned), Vehicle.is_active.is_(True))
                .first()
            )

        # 3. Match if QR string format like "mashrutgo://vehicle/{internal_id}"
        if not vehicle and "vehicle/" in cleaned:
            extracted_id = cleaned.split("vehicle/")[-1].strip()
            vehicle = (
                db.query(Vehicle)
                .filter(Vehicle.internal_id.ilike(extracted_id), Vehicle.is_active.is_(True))
                .first()
            )

        # 4. Match on plate_number (exact or spaces-normalized)
        if not vehicle:
            vehicle = (
                db.query(Vehicle)
                .filter(Vehicle.plate_number.ilike(cleaned), Vehicle.is_active.is_(True))
                .first()
            )
            if not vehicle:
                norm = cleaned.replace(" ", "").upper()
                active_vehicles = db.query(Vehicle).filter(Vehicle.is_active.is_(True)).all()
                for v in active_vehicles:
                    if v.plate_number and v.plate_number.replace(" ", "").upper() == norm:
                        vehicle = v
                        break

        if not vehicle:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Transport vositasi topilmadi: '{identifier}'",
            )

        if not vehicle.driver_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ushbu transport hozirda faol haydovchiga biriktirilmagan",
            )

        if not vehicle.route_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ushbu transport hech qaysi marshrutga biriktirilmagan",
            )

        return vehicle

    def process_scan_pay(
        self,
        client_user: User,
        vehicle_identifier: str,
        idempotency_key: str,
        db: Session,
    ) -> Payment:
        """Execute QR/NFC/Identifier scan payment:

        1. Resolve Vehicle
        2. Resolve Driver & Wallets
        3. Resolve Fare Rule
        4. Transfer Fare from Client to Driver via Double-Entry Ledger
        5. Record Payment & Audit Trail
        """
        # Idempotency check: return existing payment if key was already processed
        existing_payment = (
            db.query(Payment)
            .filter(Payment.idempotency_key == idempotency_key)
            .first()
        )
        if existing_payment:
            logger.info(f"Scan-pay idempotent hit for key {idempotency_key}")
            return existing_payment

        # 1. Resolve Vehicle
        vehicle = self.resolve_vehicle(vehicle_identifier, db)

        # 2. Resolve Driver and driver wallet
        driver = db.query(DriverProfile).filter(DriverProfile.id == vehicle.driver_id).first()
        if not driver or not driver.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transport haydovchisi faol emas",
            )

        driver_wallet = wallet_ledger_service.get_or_create_wallet(driver.user_id, db)
        client_wallet = wallet_ledger_service.get_or_create_wallet(client_user.id, db)

        # 3. Resolve Fare
        fare_result = fare_service.calculate_fare(
            route_id=vehicle.route_id,
            uyushma_id=vehicle.uyushma_id,
            db=db,
        )
        fare_amount = fare_result.amount_uzs

        # 4. Check client balance
        if client_wallet.balance_uzs < fare_amount:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Hisobingizda mablag' yetarli emas. "
                    f"Mavjud balans: {client_wallet.balance_uzs} UZS, yo'l haqi: {fare_amount} UZS. "
                    f"Iltimos, avval hisobingizni to'ldiring."
                ),
            )

        # 5. Atomic Double-Entry Ledger Transfer
        payment_id = str(uuid.uuid4())
        route_desc = vehicle.route.route_number if vehicle.route else ""
        desc = f"Yo'l haqi: {route_desc}-marshrut ({vehicle.internal_id})"

        try:
            wallet_ledger_service.transfer(
                source_wallet_id=client_wallet.id,
                target_wallet_id=driver_wallet.id,
                amount_uzs=fare_amount,
                entry_type="ride_payment",
                idempotency_key=f"pay_{idempotency_key}",
                reference_id=payment_id,
                description=desc,
                actor_id=client_user.id,
                actor_role=client_user.role,
                db=db,
            )
        except InsufficientFundsError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )

        # 6. Persist Payment Record
        payment = Payment(
            id=payment_id,
            wallet_id=client_wallet.id,
            client_user_id=client_user.id,
            vehicle_id=vehicle.id,
            driver_id=driver.id,
            route_id=vehicle.route_id,
            amount_uzs=fare_amount,
            payment_method="wallet",
            status="completed",
            qr_or_nfc_code=vehicle_identifier,
            idempotency_key=idempotency_key,
            created_at=datetime.now(timezone.utc),
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)

        # 7. Audit Log
        log_audit_event(
            db=db,
            action="payment.scan_pay",
            actor_user_id=client_user.id,
            actor_role=client_user.role,
            target_type="payment",
            target_id=payment.id,
            changes={
                "amount_uzs": fare_amount,
                "vehicle_internal_id": vehicle.internal_id,
                "route_id": vehicle.route_id,
                "driver_id": driver.id,
            },
        )
        # 8. Notification Hook: Alert driver of received payment
        try:
            import asyncio
            from app.services.notification.hooks import notify_payment_received
            loop = asyncio.get_running_loop()
            loop.create_task(
                notify_payment_received(
                    driver_user_id=driver.user_id,
                    vehicle_internal_id=vehicle.internal_id,
                    amount_uzs=fare_amount,
                    payment_id=payment.id,
                    db=db,
                )
            )
        except Exception as e:
            logger.debug(f"Async notification hook not scheduled: {e}")

        return payment

    def get_driver_payments(
        self,
        driver_id: int,
        page: int = 1,
        size: int = 50,
        status_filter: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        db: Session = None,
    ) -> Tuple[List[Payment], int, int]:
        """Fetch payments received strictly for the authenticated driver's vehicle."""
        query = db.query(Payment).filter(Payment.driver_id == driver_id)

        if status_filter:
            query = query.filter(Payment.status == status_filter)
        if date_from:
            query = query.filter(Payment.created_at >= date_from)
        if date_to:
            query = query.filter(Payment.created_at <= date_to)

        total_count = query.count()
        total_amount = sum(p.amount_uzs for p in query.all()) if total_count > 0 else 0

        items = (
            query.order_by(Payment.created_at.desc())
            .offset((page - 1) * size)
            .limit(size)
            .all()
        )
        return items, total_count, total_amount

    def refund_payment(
        self,
        payment_id: str,
        driver: DriverProfile,
        reason: Optional[str] = None,
        is_admin: bool = False,
        db: Session = None,
    ) -> Refund:
        """Refund a passenger payment with strict authorization, duplicate protection,
        and configurable time-window enforcement.
        """
        payment = db.query(Payment).filter(Payment.id == payment_id).first()
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"To'lov topilmadi: {payment_id}",
            )

        # 1. Authorization: Driver can only refund payments received by their own vehicle
        if not is_admin and payment.driver_id != driver.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Siz faqat o'zingiz qabul qilgan to'lovlarni qaytara olasiz",
            )

        # 2. Duplicate Protection
        if payment.status == "refunded":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ushbu to'lov allaqachon qaytarilgan",
            )

        existing_refund = db.query(Refund).filter(Refund.payment_id == payment.id).first()
        if existing_refund:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ushbu to'lov uchun qaytarish amali allaqachon mavjud",
            )

        # 3. Allowed Window Enforcement
        now = datetime.now(timezone.utc)
        created_at = payment.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)

        grace_limit = timedelta(minutes=settings.refund_grace_window_minutes)
        if not is_admin and (now - created_at) > grace_limit:
            elapsed_mins = int((now - created_at).total_seconds() / 60)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"To'lovni qaytarish muddati tugagan "
                    f"(ruxsat etilgan vaqt: {settings.refund_grace_window_minutes} daqiqa, "
                    f"o'tgan vaqt: {elapsed_mins} daqiqa)"
                ),
            )

        # 4. Reverse Transfer via Double-Entry Ledger
        driver_wallet = wallet_ledger_service.get_or_create_wallet(driver.user_id, db)
        client_wallet = None
        if payment.wallet_id:
            client_wallet = db.query(Wallet).filter(Wallet.id == payment.wallet_id).first()
        elif payment.client_user_id:
            client_wallet = wallet_ledger_service.get_or_create_wallet(payment.client_user_id, db)

        if not client_wallet:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Mijoz hamyoni topilmadi, qaytarish amalga oshmadi",
            )

        try:
            wallet_ledger_service.transfer(
                source_wallet_id=driver_wallet.id,
                target_wallet_id=client_wallet.id,
                amount_uzs=payment.amount_uzs,
                entry_type="refund",
                idempotency_key=f"refund_{payment.id}",
                reference_id=payment.id,
                description=f"Yo'l haqi qaytarildi (To'lov #{payment.id[:8]})",
                actor_id=driver.user_id,
                actor_role="driver",
                db=db,
            )
        except InsufficientFundsError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Haydovchi balansida to'lovni qaytarish uchun mablag' yetarli emas",
            )

        # 5. Update Payment and Record Refund
        payment.status = "refunded"

        refund_reason = reason or "Yo'lovchi xatosi sababli qaytarildi"
        refund = Refund(
            payment_id=payment.id,
            driver_id=driver.id,
            amount_uzs=payment.amount_uzs,
            reason=refund_reason,
            status="completed",
            created_at=now,
        )
        db.add(refund)
        db.commit()
        db.refresh(refund)

        # 6. Audit Trail
        log_audit_event(
            db=db,
            action="payment.refund",
            actor_user_id=driver.user_id,
            actor_role="driver",
            target_type="payment",
            target_id=payment.id,
            changes={
                "amount_uzs": payment.amount_uzs,
                "reason": refund_reason,
                "refund_id": refund.id,
            },
        )

        # 7. Notification Hook: Alert client of refund
        try:
            import asyncio
            from app.services.notification.hooks import notify_refund_issued
            if payment.client_user_id:
                loop = asyncio.get_running_loop()
                loop.create_task(
                    notify_refund_issued(
                        client_user_id=payment.client_user_id,
                        amount_uzs=payment.amount_uzs,
                        refund_id=refund.id,
                        db=db,
                    )
                )
        except Exception as e:
            logger.debug(f"Async refund notification hook not scheduled: {e}")

        return refund


transport_payment_service = TransportPaymentService()
