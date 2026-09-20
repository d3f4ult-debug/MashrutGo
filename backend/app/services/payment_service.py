"""
Ride payments, refunds, driver earnings and cash-out flows.

All money movement goes through ledger_service (double-sided entries):
- ride payment : client wallet -fare (ride_payment) / driver wallet +net (ride_earning)
- refund       : driver wallet -net (refund_reversal) / client wallet +fare (refund)
- cash-out paid: driver wallet -amount (cashout)
"""
import re
import secrets
import string
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.finance import CashoutRequest, Payment, Refund, Wallet
from app.models.shift import DriverShift
from app.models.transport import Vehicle
from app.models.user import DriverProfile, User
from app.services import ledger_service
from app.services.audit_service import record_audit_event
from app.services.fare_engine import FareQuote, quote_fare
from app.services.nfc import normalize_nfc_tag
from app.services.settings_service import get_setting

LOCAL_TZ = timezone(timedelta(hours=5))
_REF_ALPHABET = string.ascii_uppercase + string.digits


class PaymentError(Exception):
    """Business rule violation with an HTTP status hint."""

    def __init__(self, message: str, status_code: int = 400, code: str = "payment_error") -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _new_reference(prefix: str) -> str:
    return f"{prefix}-" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(8))


def local_day_start_utc(now: Optional[datetime] = None) -> datetime:
    now = (now or _utcnow()).astimezone(LOCAL_TZ)
    return datetime.combine(now.date(), time.min, tzinfo=LOCAL_TZ).astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# Vehicle identification (QR / NFC / plate / internal id)
# ---------------------------------------------------------------------------

def normalize_plate(value: str) -> str:
    return re.sub(r"[^0-9A-Z]", "", value.upper())


def extract_identifier(raw: str) -> str:
    """Accept raw ids and QR payloads such as `mashrutgo://v/VEH-1` or `https://…/pay?v=VEH-1`."""
    value = raw.strip()
    if "://" in value:
        parsed = urlparse(value)
        query = parse_qs(parsed.query)
        for key in ("v", "vehicle", "vehicle_id"):
            if query.get(key):
                return query[key][0].strip()
        segments = [s for s in parsed.path.split("/") if s]
        if parsed.netloc and parsed.scheme not in ("http", "https"):
            segments = [parsed.netloc, *segments]
        if segments:
            return segments[-1].strip()
    return value


def resolve_vehicle(db: Session, raw_identifier: str) -> Vehicle:
    identifier = extract_identifier(raw_identifier)
    if not identifier or len(identifier) > 100:
        raise PaymentError("Transport identifikatori noto'g'ri", 422, "invalid_identifier")

    vehicle = db.query(Vehicle).filter(func.upper(Vehicle.internal_id) == identifier.upper()).first()
    if vehicle is None:
        vehicle = db.query(Vehicle).filter(Vehicle.nfc_tag_id == normalize_nfc_tag(identifier)).first()
    if vehicle is None:
        plate = normalize_plate(identifier)
        if len(plate) >= 5:
            candidates = db.query(Vehicle).filter(Vehicle.plate_number.isnot(None)).all()
            matches = [v for v in candidates if normalize_plate(v.plate_number or "") == plate]
            if len(matches) == 1:
                vehicle = matches[0]
    if vehicle is None or not vehicle.is_active:
        raise PaymentError("Transport topilmadi yoki faol emas", 404, "vehicle_not_found")
    if vehicle.uyushma and vehicle.uyushma.archived_at is not None:
        raise PaymentError("Transport tashuvchisi faol emas", 404, "vehicle_not_found")
    if vehicle.route is None or vehicle.route.is_archived:
        raise PaymentError("Transport yo'nalishga biriktirilmagan", 409, "vehicle_without_route")
    if vehicle.driver is None or not vehicle.driver.is_active:
        raise PaymentError("Transportga haydovchi biriktirilmagan", 409, "vehicle_without_driver")
    return vehicle


def vehicle_fare(db: Session, vehicle: Vehicle) -> FareQuote:
    quote = quote_fare(db, vehicle.uyushma_id, vehicle.route_id)
    if quote is None:
        raise PaymentError("Ushbu yo'nalish uchun tarif belgilanmagan", 409, "fare_not_configured")
    return quote


def is_vehicle_on_shift(db: Session, vehicle: Vehicle) -> bool:
    return (
        db.query(DriverShift.id)
        .filter(DriverShift.vehicle_id == vehicle.id, DriverShift.status == "active")
        .first()
        is not None
    )


# ---------------------------------------------------------------------------
# Ride payment
# ---------------------------------------------------------------------------

@dataclass
class PaymentResult:
    payment: Payment
    replayed: bool


def pay_ride(
    db: Session,
    client: User,
    raw_identifier: str,
    idempotency_key: str,
    identification_method: str = "manual",
) -> PaymentResult:
    existing = db.query(Payment).filter(Payment.idempotency_key == idempotency_key).first()
    if existing:
        if existing.client_user_id != client.id:
            raise PaymentError("Idempotency key conflict", 409, "idempotency_conflict")
        return PaymentResult(existing, replayed=True)

    if get_setting(db, "maintenance_mode"):
        raise PaymentError("Tizim texnik xizmat rejimida. To'lovlar vaqtincha to'xtatilgan.", 503, "maintenance")

    vehicle = resolve_vehicle(db, raw_identifier)
    quote = vehicle_fare(db, vehicle)
    driver_profile: DriverProfile = vehicle.driver
    driver_user = driver_profile.user

    commission_pct = float(get_setting(db, "platform_commission_percent"))
    commission = int(round(quote.amount_uzs * commission_pct / 100.0))
    net = quote.amount_uzs - commission
    window_min = int(get_setting(db, "refund_window_minutes"))
    now = _utcnow()

    client_wallet = ledger_service.get_or_create_wallet(db, client)
    driver_wallet = ledger_service.get_or_create_wallet(db, driver_user)
    payment = Payment(
        reference=_new_reference("PAY"),
        wallet_id=client_wallet.id,
        client_user_id=client.id,
        vehicle_id=vehicle.id,
        driver_id=driver_profile.id,
        route_id=vehicle.route_id,
        uyushma_id=vehicle.uyushma_id,
        fare_rule_id=quote.rule_id,
        amount_uzs=quote.amount_uzs,
        commission_uzs=commission,
        payment_method="wallet",
        identification_method=identification_method,
        status="completed",
        qr_or_nfc_code=raw_identifier[:100] if identification_method in ("qr", "nfc") else None,
        idempotency_key=idempotency_key,
        refundable_until=now + timedelta(minutes=window_min),
    )
    db.add(payment)
    db.flush()

    route_number = vehicle.route.route_number
    try:
        ledger_service.post_entry(
            db,
            client_wallet,
            entry_type="ride_payment",
            amount_uzs=-quote.amount_uzs,
            description=f"{route_number}-yo'nalish yo'l haqi ({vehicle.plate_number or vehicle.internal_id})",
            idempotency_key=f"pay:{payment.id}:debit",
            reference_type="payment",
            reference_id=payment.reference,
            created_by_user_id=client.id,
        )
        if net > 0:
            ledger_service.post_entry(
                db,
                driver_wallet,
                entry_type="ride_earning",
                amount_uzs=net,
                description=f"Yo'l haqi tushumi {payment.reference}",
                idempotency_key=f"pay:{payment.id}:credit",
                reference_type="payment",
                reference_id=payment.reference,
            )
    except ledger_service.InsufficientFundsError as exc:
        db.rollback()
        raise PaymentError("Hamyonda mablag' yetarli emas", 402, "insufficient_funds") from exc
    except ledger_service.WalletInactiveError as exc:
        db.rollback()
        raise PaymentError("Hamyon faol emas", 403, "wallet_inactive") from exc

    record_audit_event(
        db,
        action="payment.completed",
        actor_user_id=client.id,
        actor_role=client.role,
        target_type="payment",
        target_id=payment.reference,
        uyushma_id=vehicle.uyushma_id,
        changes={"amount_uzs": quote.amount_uzs, "vehicle": vehicle.internal_id, "method": identification_method},
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        replay = db.query(Payment).filter(Payment.idempotency_key == idempotency_key).first()
        if replay and replay.client_user_id == client.id:
            return PaymentResult(replay, replayed=True)
        raise PaymentError("To'lovni saqlab bo'lmadi, qayta urinib ko'ring", 409, "conflict")
    db.refresh(payment)
    return PaymentResult(payment, replayed=False)


def is_refundable(payment: Payment, now: Optional[datetime] = None) -> bool:
    deadline = _as_aware(payment.refundable_until)
    return payment.status == "completed" and deadline is not None and (now or _utcnow()) <= deadline


def refund_payment(db: Session, driver: DriverProfile, actor: User, payment_id: str, reason: str) -> Payment:
    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    own_vehicle_id = driver.vehicle.id if driver.vehicle else None
    # Drivers only ever see their own vehicle's payments: foreign ids look like "not found"
    if payment is None or payment.driver_id != driver.id or payment.vehicle_id != own_vehicle_id:
        raise PaymentError("To'lov topilmadi", 404, "payment_not_found")
    if payment.status == "refunded":
        raise PaymentError("Ushbu to'lov allaqachon qaytarilgan", 409, "already_refunded")
    if payment.status != "completed":
        raise PaymentError("Faqat muvaffaqiyatli to'lovni qaytarish mumkin", 409, "not_refundable")
    if not is_refundable(payment):
        raise PaymentError("Qaytarish muddati tugagan. Uyushma administratoriga murojaat qiling.", 409, "refund_window_expired")

    net = payment.amount_uzs - (payment.commission_uzs or 0)
    driver_wallet = ledger_service.get_or_create_wallet(db, actor)
    # Serialise refunds of this driver's payments; re-read the payment inside the lock
    ledger_service.lock_wallet(db, driver_wallet.id)
    db.refresh(payment)
    if payment.status == "refunded":
        raise PaymentError("Ushbu to'lov allaqachon qaytarilgan", 409, "already_refunded")
    client_wallet = db.query(Wallet).filter(Wallet.id == payment.wallet_id).first()
    if client_wallet is None:
        raise PaymentError("Yo'lovchi hamyoni topilmadi", 409, "client_wallet_missing")

    reserved = reserved_cashout_total(db, driver.id)
    driver_wallet_balance = db.query(Wallet.balance_uzs).filter(Wallet.id == driver_wallet.id).scalar() or 0
    if driver_wallet_balance - reserved < net:
        raise PaymentError("Qaytarish uchun balansingizda yetarli mablag' yo'q (kutilayotgan pul yechish so'rovlari hisobga olingan)", 409, "insufficient_driver_balance")

    try:
        if net > 0:
            ledger_service.post_entry(
                db,
                driver_wallet,
                entry_type="refund_reversal",
                amount_uzs=-net,
                description=f"Qaytarildi {payment.reference}: {reason}",
                idempotency_key=f"refund:{payment.id}:debit",
                reference_type="refund",
                reference_id=payment.reference,
                created_by_user_id=actor.id,
            )
        ledger_service.post_entry(
            db,
            client_wallet,
            entry_type="refund",
            amount_uzs=payment.amount_uzs,
            description=f"To'lov qaytarildi {payment.reference}",
            idempotency_key=f"refund:{payment.id}:credit",
            reference_type="refund",
            reference_id=payment.reference,
            created_by_user_id=actor.id,
        )
    except ledger_service.InsufficientFundsError as exc:
        db.rollback()
        raise PaymentError("Qaytarish uchun balansingizda yetarli mablag' yo'q", 409, "insufficient_driver_balance") from exc
    except IntegrityError as exc:
        # A concurrent refund of the same payment won the race (unique ledger idempotency key)
        db.rollback()
        raise PaymentError("Ushbu to'lov allaqachon qaytarilgan", 409, "already_refunded") from exc
    except ledger_service.LedgerError as exc:
        db.rollback()
        raise PaymentError("Qaytarishni amalga oshirib bo'lmadi", 409, "refund_failed") from exc

    db.add(Refund(payment_id=payment.id, driver_id=driver.id, initiated_by_user_id=actor.id, amount_uzs=payment.amount_uzs, reason=reason))
    payment.status = "refunded"
    record_audit_event(
        db,
        action="payment.refunded",
        actor_user_id=actor.id,
        actor_role=actor.role,
        target_type="payment",
        target_id=payment.reference,
        uyushma_id=payment.uyushma_id,
        reason=reason,
        changes={"amount_uzs": payment.amount_uzs},
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise PaymentError("Ushbu to'lov allaqachon qaytarilgan", 409, "already_refunded") from exc
    db.refresh(payment)
    return payment


def payment_refund(payment: Payment) -> Optional[Refund]:
    return payment.refunds[0] if payment.refunds else None


# ---------------------------------------------------------------------------
# Driver earnings & cash-out
# ---------------------------------------------------------------------------

def reserved_cashout_total(db: Session, driver_id: int) -> int:
    total = (
        db.query(func.coalesce(func.sum(CashoutRequest.amount_uzs), 0))
        .filter(CashoutRequest.driver_id == driver_id, CashoutRequest.status.in_(("pending", "approved")))
        .scalar()
    )
    return int(total or 0)


def available_driver_balance(db: Session, driver: DriverProfile, wallet: Wallet) -> int:
    """Balance minus the amounts already reserved by pending/approved cash-outs. Never commits,
    so the caller can hold a wallet lock across the check and the insert."""
    balance = int(db.query(Wallet.balance_uzs).filter(Wallet.id == wallet.id).scalar() or 0)
    return max(0, balance - reserved_cashout_total(db, driver.id))


def driver_balance_summary(db: Session, driver: DriverProfile) -> dict:
    wallet = ledger_service.get_or_create_wallet(db, driver.user)
    db.commit()
    balance = int(db.query(Wallet.balance_uzs).filter(Wallet.id == wallet.id).scalar() or 0)
    reserved = reserved_cashout_total(db, driver.id)
    day_start = local_day_start_utc()

    today = db.query(Payment).filter(Payment.driver_id == driver.id, Payment.created_at >= day_start).all()
    completed_today = [p for p in today if p.status == "completed"]
    refunded_today = [p for p in today if p.status == "refunded"]

    shift = (
        db.query(DriverShift)
        .filter(DriverShift.driver_id == driver.id, DriverShift.status == "active")
        .first()
    )
    shift_earnings = 0
    if shift is not None:
        shift_start = _as_aware(shift.started_at)
        shift_earnings = sum(
            p.amount_uzs - (p.commission_uzs or 0)
            for p in db.query(Payment)
            .filter(Payment.driver_id == driver.id, Payment.status == "completed", Payment.created_at >= shift_start)
            .all()
        )

    return {
        "vehicle_id": driver.vehicle.internal_id if driver.vehicle else None,
        "balance": balance,
        "available_balance": max(0, balance - reserved),
        "pending_cashout": reserved,
        "today_gross": sum(p.amount_uzs for p in completed_today),
        "today_earnings": sum(p.amount_uzs - (p.commission_uzs or 0) for p in completed_today),
        "total_refunded_today": sum(p.amount_uzs for p in refunded_today),
        "rides_count_today": len(completed_today),
        "shift_earnings": shift_earnings,
    }


def request_cashout(
    db: Session,
    driver: DriverProfile,
    amount_uzs: int,
    method: str,
    payout_details: Optional[str],
    idempotency_key: Optional[str],
) -> CashoutRequest:
    if idempotency_key:
        existing = db.query(CashoutRequest).filter(CashoutRequest.idempotency_key == idempotency_key).first()
        if existing:
            if existing.driver_id != driver.id or existing.amount_uzs != amount_uzs:
                raise PaymentError("Idempotency key conflict", 409, "idempotency_conflict")
            return existing

    # Lock the wallet first and keep the lock until commit: the check below and the insert must
    # not race another request (driver_balance_summary commits, so it cannot be used here).
    wallet = ledger_service.get_or_create_wallet(db, driver.user)
    ledger_service.lock_wallet(db, wallet.id)
    if amount_uzs > available_driver_balance(db, driver, wallet):
        db.rollback()
        raise PaymentError("Yetarli mablag' mavjud emas", 409, "insufficient_funds")

    req = CashoutRequest(
        driver_id=driver.id,
        uyushma_id=driver.uyushma_id,
        vehicle_id=driver.vehicle.id if driver.vehicle else None,
        amount_uzs=amount_uzs,
        method=method,
        payout_details=payout_details,
        status="pending",
        idempotency_key=idempotency_key,
    )
    db.add(req)
    db.flush()
    record_audit_event(
        db,
        action="cashout.requested",
        actor_user_id=driver.user_id,
        actor_role="driver",
        target_type="cashout",
        target_id=req.id,
        uyushma_id=driver.uyushma_id,
        changes={"amount_uzs": amount_uzs, "method": method},
    )
    db.commit()
    db.refresh(req)
    return req


def _load_cashout(db: Session, uyushma_id: int, cashout_id: int) -> CashoutRequest:
    req = (
        db.query(CashoutRequest)
        .filter(CashoutRequest.id == cashout_id, CashoutRequest.uyushma_id == uyushma_id)
        .first()
    )
    if req is None:
        raise PaymentError("Pul yechish so'rovi topilmadi", 404, "cashout_not_found")
    return req


def approve_cashout(db: Session, uyushma_id: int, cashout_id: int, actor: User) -> CashoutRequest:
    req = _load_cashout(db, uyushma_id, cashout_id)
    if req.status != "pending":
        raise PaymentError(f"So'rov holati '{req.status}' — tasdiqlab bo'lmaydi", 409, "invalid_state")
    req.status = "approved"
    req.approved_by_user_id = actor.id
    req.processed_at = _utcnow()
    record_audit_event(db, action="cashout.approved", actor_user_id=actor.id, actor_role=actor.role,
                       target_type="cashout", target_id=req.id, uyushma_id=uyushma_id,
                       changes={"amount_uzs": req.amount_uzs})
    db.commit()
    db.refresh(req)
    return req


def reject_cashout(db: Session, uyushma_id: int, cashout_id: int, actor: User, reason: str) -> CashoutRequest:
    req = _load_cashout(db, uyushma_id, cashout_id)
    if req.status not in ("pending", "approved"):
        raise PaymentError(f"So'rov holati '{req.status}' — rad etib bo'lmaydi", 409, "invalid_state")
    req.status = "rejected"
    req.rejection_reason = reason
    req.approved_by_user_id = actor.id
    req.processed_at = _utcnow()
    record_audit_event(db, action="cashout.rejected", actor_user_id=actor.id, actor_role=actor.role,
                       target_type="cashout", target_id=req.id, uyushma_id=uyushma_id, reason=reason,
                       changes={"amount_uzs": req.amount_uzs})
    db.commit()
    db.refresh(req)
    return req


def mark_cashout_paid(db: Session, uyushma_id: int, cashout_id: int, actor: User, payment_reference: str) -> CashoutRequest:
    req = _load_cashout(db, uyushma_id, cashout_id)
    if req.status == "paid":
        return req
    if req.status != "approved":
        raise PaymentError("Faqat tasdiqlangan so'rovni to'langan deb belgilash mumkin", 409, "invalid_state")
    driver = db.query(DriverProfile).filter(DriverProfile.id == req.driver_id).first()
    if driver is None:
        raise PaymentError("Haydovchi topilmadi", 404, "driver_not_found")
    wallet = ledger_service.get_or_create_wallet(db, driver.user)
    ledger_service.lock_wallet(db, wallet.id)
    db.refresh(req)
    if req.status == "paid":
        return req
    try:
        ledger_service.post_entry(
            db,
            wallet,
            entry_type="cashout",
            amount_uzs=-req.amount_uzs,
            description=f"Naqd/karta orqali to'lab berildi (#{req.id}, {payment_reference})",
            idempotency_key=f"cashout:{req.id}:paid",
            reference_type="cashout",
            reference_id=str(req.id),
            created_by_user_id=actor.id,
        )
    except ledger_service.InsufficientFundsError as exc:
        db.rollback()
        raise PaymentError("Haydovchi balansida yetarli mablag' yo'q", 409, "insufficient_funds") from exc
    except IntegrityError:
        # Another operator marked the same request paid a moment ago: converge, do not double-pay
        db.rollback()
        req = _load_cashout(db, uyushma_id, cashout_id)
        if req.status == "paid":
            return req
        raise PaymentError("So'rovni to'langan deb belgilab bo'lmadi", 409, "invalid_state") from None
    except ledger_service.LedgerError as exc:
        db.rollback()
        raise PaymentError("To'lovni amalga oshirib bo'lmadi", 409, "cashout_failed") from exc
    req.status = "paid"
    req.paid_by_user_id = actor.id
    req.paid_at = _utcnow()
    req.payment_reference = payment_reference
    record_audit_event(db, action="cashout.paid", actor_user_id=actor.id, actor_role=actor.role,
                       target_type="cashout", target_id=req.id, uyushma_id=uyushma_id,
                       changes={"amount_uzs": req.amount_uzs, "payment_reference": payment_reference})
    db.commit()
    db.refresh(req)
    return req


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def finance_summary(db: Session, uyushma_id: int, since: Optional[datetime] = None, until: Optional[datetime] = None) -> dict:
    """Aggregated in SQL: this runs over the whole payment history of a tenant."""
    filters = [Payment.uyushma_id == uyushma_id]
    if since is not None:
        filters.append(Payment.created_at >= since)
    if until is not None:
        filters.append(Payment.created_at <= until)

    rows = (
        db.query(
            Payment.status,
            func.coalesce(func.sum(Payment.amount_uzs), 0),
            func.coalesce(func.sum(Payment.commission_uzs), 0),
            func.count(Payment.id),
        )
        .filter(*filters)
        .group_by(Payment.status)
        .all()
    )
    by_status = {status: (int(amount), int(commission), int(count)) for status, amount, commission, count in rows}
    completed_amount, commission, completed_count = by_status.get("completed", (0, 0, 0))
    refunded_amount, _, refunded_count = by_status.get("refunded", (0, 0, 0))

    cash_rows = (
        db.query(CashoutRequest.status, func.coalesce(func.sum(CashoutRequest.amount_uzs), 0))
        .filter(CashoutRequest.uyushma_id == uyushma_id)
        .group_by(CashoutRequest.status)
        .all()
    )
    cashouts = {status: int(total) for status, total in cash_rows}

    return {
        # Gross = money actually collected in the period (refunded rides are reported separately)
        "gross_revenue": completed_amount,
        "total_refunds": refunded_amount,
        "platform_commission": commission,
        "net_revenue": completed_amount - commission,
        "completed_rides_count": completed_count,
        "refunded_rides_count": refunded_count,
        "pending_cashouts_total": cashouts.get("pending", 0) + cashouts.get("approved", 0),
        "paid_cashouts_total": cashouts.get("paid", 0),
    }


def mask_client(payment: Payment) -> Tuple[str, Optional[str]]:
    """Drivers/operators never see passenger PII: return a stable pseudonymous label."""
    if payment.client_user_id is None:
        return "Mijoz", None
    return f"Mijoz #{payment.client_user_id:04d}", None
