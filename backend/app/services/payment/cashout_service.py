import logging
from datetime import datetime, timezone
from typing import Optional, List, Tuple
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.models.finance import CashoutRequest
from app.models.user import DriverProfile, User
from app.services.audit_service import log_audit_event
from app.services.wallet.ledger_service import (
    wallet_ledger_service,
    InsufficientFundsError,
)

logger = logging.getLogger(__name__)


class CashoutService:
    """Driver Cashout Request and Uyushma Approval/Payout ledger workflow."""

    def _trigger_cashout_notification(self, req: CashoutRequest, notes: Optional[str], db: Session):
        try:
            import asyncio
            from app.models.user import DriverProfile
            from app.services.notification.hooks import notify_cashout_status
            driver = db.query(DriverProfile).filter(DriverProfile.id == req.driver_id).first()
            if driver and driver.user_id:
                loop = asyncio.get_running_loop()
                loop.create_task(
                    notify_cashout_status(
                        driver_user_id=driver.user_id,
                        cashout_id=req.id,
                        amount_uzs=req.amount_uzs,
                        status=req.status,
                        notes=notes,
                        db=db,
                    )
                )
        except Exception as e:
            logger.debug(f"Async cashout notification hook not scheduled: {e}")

    def create_cashout_request(
        self,
        driver: DriverProfile,
        amount_uzs: int,
        notes: Optional[str] = None,
        db: Session = None,
    ) -> CashoutRequest:
        """Driver requests cashout of accumulated earnings."""
        if amount_uzs <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Yechib olinadigan mablag' miqdori noldan katta bo'lishi lozim",
            )

        # Verify driver has sufficient wallet balance
        driver_wallet = wallet_ledger_service.get_or_create_wallet(driver.user_id, db)
        if driver_wallet.balance_uzs < amount_uzs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Hisobingizda yetarli mablag' mavjud emas. "
                    f"Mavjud balans: {driver_wallet.balance_uzs} UZS, so'ralgan: {amount_uzs} UZS"
                ),
            )

        now = datetime.now(timezone.utc)
        req = CashoutRequest(
            driver_id=driver.id,
            uyushma_id=driver.uyushma_id,
            amount_uzs=amount_uzs,
            status="pending",
            notes=notes,
            created_at=now,
            updated_at=now,
        )
        db.add(req)
        db.commit()
        db.refresh(req)

        # Audit Log
        log_audit_event(
            db=db,
            action="cashout.requested",
            actor_user_id=driver.user_id,
            actor_role="driver",
            target_type="cashout_request",
            target_id=str(req.id),
            changes={"amount_uzs": amount_uzs, "notes": notes},
        )
        return req

    def approve_cashout_request(
        self,
        cashout_id: int,
        admin_user: User,
        notes: Optional[str] = None,
        db: Session = None,
    ) -> CashoutRequest:
        """Uyushma admin approves cashout request."""
        req = db.query(CashoutRequest).filter(CashoutRequest.id == cashout_id).first()
        if not req:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Cashout so'rovi topilmadi: #{cashout_id}",
            )

        if req.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"So'rov allaqachon '{req.status}' holatida",
            )

        now = datetime.now(timezone.utc)
        req.status = "approved"
        req.approved_by_user_id = admin_user.id
        req.processed_at = now
        if notes:
            req.notes = f"{req.notes or ''} [Approve: {notes}]".strip()
        req.updated_at = now

        db.commit()
        db.refresh(req)

        log_audit_event(
            db=db,
            action="cashout.approved",
            actor_user_id=admin_user.id,
            actor_role=admin_user.role,
            target_type="cashout_request",
            target_id=str(req.id),
            changes={"status": "approved", "notes": notes},
        )
        self._trigger_cashout_notification(req, notes, db)
        return req

    def reject_cashout_request(
        self,
        cashout_id: int,
        admin_user: User,
        notes: Optional[str] = None,
        db: Session = None,
    ) -> CashoutRequest:
        """Uyushma admin rejects cashout request."""
        req = db.query(CashoutRequest).filter(CashoutRequest.id == cashout_id).first()
        if not req:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Cashout so'rovi topilmadi: #{cashout_id}",
            )

        if req.status == "paid":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="To'lab berilgan so'rovni rad etib bo'lmaydi",
            )

        now = datetime.now(timezone.utc)
        req.status = "rejected"
        req.approved_by_user_id = admin_user.id
        req.processed_at = now
        if notes:
            req.notes = f"{req.notes or ''} [Rad sababi: {notes}]".strip()
        req.updated_at = now

        db.commit()
        db.refresh(req)

        log_audit_event(
            db=db,
            action="cashout.rejected",
            actor_user_id=admin_user.id,
            actor_role=admin_user.role,
            target_type="cashout_request",
            target_id=str(req.id),
            changes={"status": "rejected", "notes": notes},
        )
        self._trigger_cashout_notification(req, notes, db)
        return req

    def mark_cashout_paid(
        self,
        cashout_id: int,
        admin_user: User,
        notes: Optional[str] = None,
        db: Session = None,
    ) -> CashoutRequest:
        """Uyushma admin executes payout: debits driver wallet via double-entry ledger and marks paid."""
        req = db.query(CashoutRequest).filter(CashoutRequest.id == cashout_id).first()
        if not req:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Cashout so'rovi topilmadi: #{cashout_id}",
            )

        if req.status == "paid":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ushbu so'rov allaqachon to'lab berilgan",
            )

        if req.status == "rejected":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Rad etilgan so'rovga to'lov qilib bo'lmaydi",
            )

        driver = db.query(DriverProfile).filter(DriverProfile.id == req.driver_id).first()
        if not driver:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Haydovchi profili topilmadi",
            )

        driver_wallet = wallet_ledger_service.get_or_create_wallet(driver.user_id, db)

        # Debit driver wallet via double-entry ledger
        try:
            wallet_ledger_service.debit(
                wallet_id=driver_wallet.id,
                amount_uzs=req.amount_uzs,
                entry_type="cashout",
                idempotency_key=f"cashout_payout_{req.id}",
                reference_id=str(req.id),
                description=f"Naqd pul to'landi (Cashout #{req.id})",
                actor_id=admin_user.id,
                actor_role=admin_user.role,
                db=db,
            )
        except InsufficientFundsError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Haydovchi balansida yetarli mablag' qolmagan",
            )

        now = datetime.now(timezone.utc)
        req.status = "paid"
        req.approved_by_user_id = admin_user.id
        req.processed_at = now
        if notes:
            req.notes = f"{req.notes or ''} [Paid: {notes}]".strip()
        req.updated_at = now

        db.commit()
        db.refresh(req)

        log_audit_event(
            db=db,
            action="cashout.paid",
            actor_user_id=admin_user.id,
            actor_role=admin_user.role,
            target_type="cashout_request",
            target_id=str(req.id),
            changes={"status": "paid", "amount_uzs": req.amount_uzs, "notes": notes},
        )
        self._trigger_cashout_notification(req, notes, db)
        return req

    def list_driver_cashouts(self, driver_id: int, db: Session) -> List[CashoutRequest]:
        """Fetch cashout requests submitted by a specific driver."""
        return (
            db.query(CashoutRequest)
            .filter(CashoutRequest.driver_id == driver_id)
            .order_by(CashoutRequest.created_at.desc())
            .all()
        )

    def list_uyushma_cashouts(
        self,
        uyushma_id: Optional[int],
        status_filter: Optional[str] = None,
        page: int = 1,
        size: int = 50,
        db: Session = None,
    ) -> Tuple[List[CashoutRequest], int]:
        """Fetch cashouts within Uyushma tenant."""
        query = db.query(CashoutRequest)
        if uyushma_id is not None:
            query = query.filter(CashoutRequest.uyushma_id == uyushma_id)
        if status_filter:
            query = query.filter(CashoutRequest.status == status_filter)

        total = query.count()
        items = (
            query.order_by(CashoutRequest.created_at.desc())
            .offset((page - 1) * size)
            .limit(size)
            .all()
        )
        return items, total


cashout_service = CashoutService()
