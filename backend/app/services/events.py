"""
Post-commit side effects: realtime WS events + persisted/push notifications.

Business code commits first, then calls these helpers with FastAPI BackgroundTasks so that
network I/O never runs inside a DB transaction and never delays the HTTP response.
"""
from typing import Any, Dict, Optional

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.models.finance import CashoutRequest, Payment
from app.services import notification_service
from app.services.payment_service import is_refundable, mask_client
from app.services.realtime.connection_manager import realtime_manager


def notify_user(
    background: BackgroundTasks,
    db: Session,
    user_id: int,
    title: str,
    body: str,
    notification_type: str,
    data: Optional[Dict[str, Any]] = None,
) -> None:
    notification = notification_service.create_notification(db, user_id, title, body, notification_type, data)
    db.commit()
    background.add_task(notification_service.push_to_user, notification.id)


def driver_payment_payload(payment: Payment, refund_window_minutes: int) -> Dict[str, Any]:
    label, _ = mask_client(payment)
    return {
        "id": payment.id,
        "reference": payment.reference,
        "vehicle_id": payment.vehicle.internal_id if payment.vehicle else None,
        "route_id": payment.route_id,
        "amount_uzs": payment.amount_uzs,
        "commission_uzs": payment.commission_uzs,
        "net_amount_uzs": payment.amount_uzs - (payment.commission_uzs or 0),
        "status": payment.status,
        "payment_method": payment.payment_method,
        "identification_method": payment.identification_method,
        "created_at": payment.created_at.isoformat() if payment.created_at else None,
        "refundable": is_refundable(payment),
        "refundable_until": payment.refundable_until.isoformat() if payment.refundable_until else None,
        "refund_window_minutes": refund_window_minutes,
        "passenger_label": label,
    }


def payment_received(background: BackgroundTasks, db: Session, payment: Payment, refund_window_minutes: int) -> None:
    driver_user_id = payment.driver.user_id if payment.driver else None
    if driver_user_id is None:
        return
    payload = driver_payment_payload(payment, refund_window_minutes)
    background.add_task(realtime_manager.send_to_driver, driver_user_id, "payment.received", {"payment": payload})
    notify_user(
        background,
        db,
        driver_user_id,
        "Yangi to'lov qabul qilindi",
        f"{payment.amount_uzs:,} so'm ({payment.reference})".replace(",", " "),
        "payment.received",
        {"payment_id": payment.id, "route": "/driver/payments"},
    )


def payment_refunded(background: BackgroundTasks, db: Session, payment: Payment, reason: str) -> None:
    driver_user_id = payment.driver.user_id if payment.driver else None
    if driver_user_id is not None:
        background.add_task(
            realtime_manager.send_to_driver,
            driver_user_id,
            "payment.refunded",
            {
                "payment_id": payment.id,
                "vehicle_id": payment.vehicle.internal_id if payment.vehicle else None,
                "amount_uzs": payment.amount_uzs,
                "refund_reason": reason,
                "refunded_at": payment.updated_at.isoformat() if payment.updated_at else None,
            },
        )
    if payment.client_user_id is not None:
        notify_user(
            background,
            db,
            payment.client_user_id,
            "To'lov qaytarildi",
            f"{payment.amount_uzs:,} so'm hamyoningizga qaytarildi ({payment.reference})".replace(",", " "),
            "payment.refunded",
            {"payment_id": payment.id, "route": "/wallet"},
        )


def cashout_status_changed(background: BackgroundTasks, db: Session, req: CashoutRequest) -> None:
    driver_user_id = req.driver.user_id if req.driver else None
    if driver_user_id is None:
        return
    background.add_task(
        realtime_manager.send_to_driver,
        driver_user_id,
        "cashout.status_updated",
        {"cashout_id": req.id, "status": req.status, "rejection_reason": req.rejection_reason},
    )
    titles = {
        "approved": "Pul yechish so'rovi tasdiqlandi",
        "rejected": "Pul yechish so'rovi rad etildi",
        "paid": "Pul to'lab berildi",
    }
    title = titles.get(req.status)
    if title:
        body = f"{req.amount_uzs:,} so'm".replace(",", " ")
        if req.status == "rejected" and req.rejection_reason:
            body += f" — {req.rejection_reason}"
        notify_user(background, db, driver_user_id, title, body, f"cashout.{req.status}", {"cashout_id": req.id, "route": "/driver/payments"})
