from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, Request, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep, get_current_user
from app.models.finance import Payment
from app.models.user import User
from app.schemas.finance import (
    ClickWebhookResponse,
    TransportScanPayRequest,
    PaymentResponse,
    RefundResponse,
)
from app.services.payment.providers.click import ClickProviderAdapter
from app.services.payment.transport_payment_service import transport_payment_service

router = APIRouter(prefix="/payments", tags=["payments"])


@router.post("/webhook/click", response_model=ClickWebhookResponse)
async def click_webhook_endpoint(
    request: Request,
    db: Session = Depends(get_db_dep),
):
    """Click Merchant webhook endpoint supporting Prepare (action=0) and Complete (action=1).

    Accepts both application/x-www-form-urlencoded and application/json formats.
    Enforces signature validation, idempotency, and double-entry ledger mutation.
    """
    content_type = request.headers.get("content-type", "")
    if "application/x-www-form-urlencoded" in content_type:
        form_data = await request.form()
        payload = dict(form_data)
    else:
        try:
            payload = await request.json()
        except Exception:
            form_data = await request.form()
            payload = dict(form_data)

    click_adapter = ClickProviderAdapter()
    result = click_adapter.process_webhook(payload, db)
    return ClickWebhookResponse(**result)


@router.post("/scan-pay", response_model=PaymentResponse, status_code=status.HTTP_201_CREATED)
def scan_and_pay_endpoint(
    payload: TransportScanPayRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """Passenger pays transit fare by scanning QR/NFC or entering vehicle internal ID (e.g. AND-101).

    Resolves vehicle, assigned route and driver, calculates fare, and performs atomic
    double-entry transfer between client and driver wallets. Protected by idempotency key.
    """
    payment = transport_payment_service.process_scan_pay(
        client_user=current_user,
        vehicle_identifier=payload.vehicle_identifier,
        idempotency_key=payload.idempotency_key,
        db=db,
    )

    refunds_list = [
        RefundResponse(
            id=r.id,
            payment_id=r.payment_id,
            driver_id=r.driver_id,
            amount_uzs=r.amount_uzs,
            reason=r.reason,
            status=r.status,
            created_at=r.created_at,
        )
        for r in (payment.refunds or [])
    ]

    return PaymentResponse(
        id=payment.id,
        wallet_id=payment.wallet_id,
        client_user_id=payment.client_user_id,
        vehicle_id=payment.vehicle_id,
        vehicle_internal_id=payment.vehicle.internal_id if payment.vehicle else None,
        driver_id=payment.driver_id,
        route_id=payment.route_id,
        route_number=payment.route.route_number if payment.route else None,
        amount_uzs=payment.amount_uzs,
        payment_method=payment.payment_method,
        status=payment.status,
        qr_or_nfc_code=payment.qr_or_nfc_code,
        external_trans_id=payment.external_trans_id,
        idempotency_key=payment.idempotency_key,
        created_at=payment.created_at,
        refunds=refunds_list,
    )


@router.get("/{id}", response_model=PaymentResponse)
def get_payment_details(
    id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """Retrieve detailed payment receipt and refund status."""
    payment = db.query(Payment).filter(Payment.id == id).first()
    if not payment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"To'lov topilmadi: {id}",
        )

    # Authorization: Client, Driver, or Admin
    is_client = payment.client_user_id == current_user.id
    is_driver = current_user.driver_profile and payment.driver_id == current_user.driver_profile.id
    is_admin = current_user.role in ("super_admin", "uyushma_admin")

    if not (is_client or is_driver or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ushbu to'lov ma'lumotlarini ko'rishga ruxsat yo'q",
        )

    refunds_list = [
        RefundResponse(
            id=r.id,
            payment_id=r.payment_id,
            driver_id=r.driver_id,
            amount_uzs=r.amount_uzs,
            reason=r.reason,
            status=r.status,
            created_at=r.created_at,
        )
        for r in (payment.refunds or [])
    ]

    return PaymentResponse(
        id=payment.id,
        wallet_id=payment.wallet_id,
        client_user_id=payment.client_user_id,
        vehicle_id=payment.vehicle_id,
        vehicle_internal_id=payment.vehicle.internal_id if payment.vehicle else None,
        driver_id=payment.driver_id,
        route_id=payment.route_id,
        route_number=payment.route.route_number if payment.route else None,
        amount_uzs=payment.amount_uzs,
        payment_method=payment.payment_method,
        status=payment.status,
        qr_or_nfc_code=payment.qr_or_nfc_code,
        external_trans_id=payment.external_trans_id,
        idempotency_key=payment.idempotency_key,
        created_at=payment.created_at,
        refunds=refunds_list,
    )
