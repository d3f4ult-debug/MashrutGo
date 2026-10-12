import logging
from typing import Optional
from sqlalchemy.orm import Session

from app.services.notification.notification_service import notification_service

logger = logging.getLogger(__name__)


async def notify_payment_received(
    driver_user_id: int,
    vehicle_internal_id: str,
    amount_uzs: int,
    payment_id: int,
    db: Session,
):
    """Event hook: triggered when a passenger pays fare via QR / scan & pay."""
    title = "Yangi to'lov qabul qilindi 💰"
    body = f"{vehicle_internal_id} transportiga {amount_uzs:,} so'm to'lov qabul qilindi."
    data = {
        "event": "payment.received",
        "payment_id": str(payment_id),
        "amount_uzs": str(amount_uzs),
        "vehicle_internal_id": vehicle_internal_id,
    }
    try:
        return await notification_service.send_to_user(
            user_id=driver_user_id,
            title=title,
            body=body,
            notification_type="payment.received",
            data=data,
            save_in_db=True,
            db=db,
        )
    except Exception as e:
        logger.error(f"Error in notify_payment_received hook: {e}")
        return None


async def notify_refund_issued(
    client_user_id: int,
    amount_uzs: int,
    refund_id: int,
    db: Session,
):
    """Event hook: triggered when a payment refund is processed."""
    title = "To'lov qaytarildi ↩️"
    body = f"{amount_uzs:,} so'm to'lovingiz hamyoningizga qaytarildi."
    data = {
        "event": "payment.refunded",
        "refund_id": str(refund_id),
        "amount_uzs": str(amount_uzs),
    }
    try:
        return await notification_service.send_to_user(
            user_id=client_user_id,
            title=title,
            body=body,
            notification_type="payment.refunded",
            data=data,
            save_in_db=True,
            db=db,
        )
    except Exception as e:
        logger.error(f"Error in notify_refund_issued hook: {e}")
        return None


async def notify_cashout_status(
    driver_user_id: int,
    cashout_id: int,
    amount_uzs: int,
    status: str,
    notes: Optional[str] = None,
    db: Session = None,
):
    """Event hook: triggered when Uyushma admin updates cashout request status."""
    status_uz = {
        "approved": "tasdiqlandi ✅",
        "rejected": "rad etildi ❌",
        "paid": "to'lab berildi 💵",
    }.get(status, status)

    title = "Cashout so'rovi yangilandi 🏦"
    body = f"{amount_uzs:,} so'm naqdlashtirish so'rovingiz {status_uz}."
    if notes:
        body += f" Izoh: {notes}"

    data = {
        "event": "cashout.status_updated",
        "cashout_id": str(cashout_id),
        "status": status,
        "amount_uzs": str(amount_uzs),
    }
    try:
        return await notification_service.send_to_user(
            user_id=driver_user_id,
            title=title,
            body=body,
            notification_type="cashout.status_updated",
            data=data,
            save_in_db=True,
            db=db,
        )
    except Exception as e:
        logger.error(f"Error in notify_cashout_status hook: {e}")
        return None


async def notify_arrival_alert(
    client_user_id: int,
    route_number: str,
    vehicle_internal_id: str,
    eta_minutes: int,
    db: Session,
):
    """Event hook: triggered when watched vehicle approaches destination stop."""
    title = f"Yo'nalish {route_number}: Mashrut yaqinlashmoqda 🚐"
    body = f"{vehicle_internal_id} mashrut sizning bekatga taxminan {eta_minutes} daqiqada yetib keladi."
    data = {
        "event": "watch.arrival_alert",
        "route_number": str(route_number),
        "vehicle_internal_id": vehicle_internal_id,
        "eta_minutes": str(eta_minutes),
    }
    try:
        return await notification_service.send_to_user(
            user_id=client_user_id,
            title=title,
            body=body,
            notification_type="watch.arrival_alert",
            data=data,
            save_in_db=True,
            db=db,
        )
    except Exception as e:
        logger.error(f"Error in notify_arrival_alert hook: {e}")
        return None


async def notify_shift_event(
    driver_user_id: int,
    event_type: str,
    message: str,
    db: Session,
):
    """Event hook: triggered on shift status changes or route notifications."""
    title = "Smena yangilanishi ⏱️"
    data = {"event": "shift.event", "event_type": event_type}
    try:
        return await notification_service.send_to_user(
            user_id=driver_user_id,
            title=title,
            body=message,
            notification_type="shift.event",
            data=data,
            save_in_db=True,
            db=db,
        )
    except Exception as e:
        logger.error(f"Error in notify_shift_event hook: {e}")
        return None
