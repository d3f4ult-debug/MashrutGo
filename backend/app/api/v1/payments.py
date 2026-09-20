"""Client wallet, Click top-up, transport fare payments and provider webhooks."""
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep, get_optional_current_user, require_client
from app.core.config import settings
from app.models.finance import Payment, ProviderTransaction, Wallet, WalletTransaction
from app.models.user import User
from app.schemas.finance import (
    ClientPaymentRead,
    LedgerEntryRead,
    PaymentConfigRead,
    PayRequest,
    ResolvedVehicleRead,
    ResolveVehicleRequest,
    TopupCreateRequest,
    TopupRead,
    WalletBalanceRead,
)
from app.services import events, ledger_service, payment_service
from app.services.audit_service import client_ip, record_audit_event
from app.services.payments.base import supported_providers
from app.services.payments.click_provider import ACTION_COMPLETE, ACTION_PREPARE, ClickProvider
from app.services.payments.topup_service import TopupError, create_topup, handle_click_webhook, sandbox_complete
from app.services.rate_limit import limit_by_ip, vehicle_lookup_limiter
from app.services.settings_service import get_setting

wallet_router = APIRouter(prefix="/wallet", tags=["wallet"])
payments_router = APIRouter(prefix="/payments", tags=["payments"])


def _payment_error(exc: payment_service.PaymentError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


# ------------------------------------------------------------------------------
# Wallet
# ------------------------------------------------------------------------------


@wallet_router.get("/balance", response_model=WalletBalanceRead)
def wallet_balance(current_user: User = Depends(require_client), db: Session = Depends(get_db_dep)):
    wallet = ledger_service.get_or_create_wallet(db, current_user)
    db.commit()
    db.refresh(wallet)
    return WalletBalanceRead(wallet_id=wallet.id, balance_uzs=wallet.balance_uzs, currency=wallet.currency, is_active=wallet.is_active)


@wallet_router.get("/transactions", response_model=List[LedgerEntryRead])
def wallet_transactions(
    limit: int = Query(50, ge=1, le=200),
    before_id: Optional[int] = Query(None, ge=1),
    current_user: User = Depends(require_client),
    db: Session = Depends(get_db_dep),
):
    """Immutable ledger history, newest first (keyset pagination via `before_id`)."""
    wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
    if not wallet:
        return []
    q = db.query(WalletTransaction).filter(WalletTransaction.wallet_id == wallet.id)
    if before_id:
        q = q.filter(WalletTransaction.id < before_id)
    return [LedgerEntryRead.model_validate(r, from_attributes=True) for r in q.order_by(WalletTransaction.id.desc()).limit(limit).all()]


def _topup_read(tx: ProviderTransaction, checkout_url: Optional[str] = None) -> TopupRead:
    return TopupRead(
        id=tx.id, merchant_trans_id=tx.merchant_trans_id, provider=tx.provider, amount_uzs=tx.amount_uzs,
        status=tx.status, checkout_url=checkout_url, is_sandbox=tx.is_sandbox, error_note=tx.error_note,
        created_at=tx.created_at, completed_at=tx.completed_at,
    )


@wallet_router.get("/config", response_model=PaymentConfigRead)
def payment_config(db: Session = Depends(get_db_dep)):
    """Public: which payment options the UI may offer (no secrets)."""
    return PaymentConfigRead(
        providers=supported_providers(),
        click_configured=settings.click_configured,
        sandbox_enabled=settings.sandbox_payments_enabled,
        min_topup_uzs=int(get_setting(db, "min_topup_uzs")),
        max_topup_uzs=int(get_setting(db, "max_topup_uzs")),
        maintenance_mode=bool(get_setting(db, "maintenance_mode")),
    )


@wallet_router.post("/topup", response_model=TopupRead, status_code=status.HTTP_201_CREATED)
def create_wallet_topup(
    payload: TopupCreateRequest,
    request: Request,
    current_user: User = Depends(require_client),
    db: Session = Depends(get_db_dep),
):
    """
    Create a Click top-up order and return the Click checkout URL.
    The wallet is credited only after Click's signed Complete callback.
    """
    if payload.provider != "click":
        raise HTTPException(status_code=422, detail="Hozircha faqat Click qo'llab-quvvatlanadi")
    if get_setting(db, "maintenance_mode"):
        raise HTTPException(status_code=503, detail="Tizim texnik xizmat rejimida")
    min_amount, max_amount = int(get_setting(db, "min_topup_uzs")), int(get_setting(db, "max_topup_uzs"))
    if not min_amount <= payload.amount_uzs <= max_amount:
        raise HTTPException(status_code=422, detail=f"Summa {min_amount:,} – {max_amount:,} so'm oralig'ida bo'lishi kerak".replace(",", " "))

    provider = ClickProvider()
    sandbox = not provider.is_configured()
    if sandbox and not settings.sandbox_payments_enabled:
        raise HTTPException(status_code=503, detail="Click to'lov tizimi hali sozlanmagan")

    tx = create_topup(db, current_user, payload.amount_uzs, sandbox=sandbox)
    record_audit_event(db, action="wallet.topup.created", actor_user_id=current_user.id, actor_role=current_user.role,
                       target_type="provider_transaction", target_id=tx.merchant_trans_id,
                       changes={"amount_uzs": payload.amount_uzs, "sandbox": sandbox}, ip_address=client_ip(request))
    db.commit()
    db.refresh(tx)
    checkout_url = None if sandbox else provider.build_checkout_url(tx, f"{settings.public_web_url.rstrip('/')}/wallet?topup={tx.id}")
    return _topup_read(tx, checkout_url)


def _own_topup(db: Session, user: User, topup_id: int) -> ProviderTransaction:
    tx = db.query(ProviderTransaction).filter(ProviderTransaction.id == topup_id, ProviderTransaction.user_id == user.id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Top-up not found")
    return tx


@wallet_router.get("/topup/{topup_id}", response_model=TopupRead)
def get_topup(topup_id: int, current_user: User = Depends(require_client), db: Session = Depends(get_db_dep)):
    """Poll top-up status after returning from Click."""
    return _topup_read(_own_topup(db, current_user, topup_id))


@wallet_router.post("/topup/{topup_id}/sandbox-complete", response_model=TopupRead)
def complete_sandbox_topup(topup_id: int, current_user: User = Depends(require_client), db: Session = Depends(get_db_dep)):
    """
    DEVELOPMENT ONLY (PAYMENTS_SANDBOX=true, never in production): finish a sandbox order through
    the same prepare/complete state machine and ledger posting that real Click callbacks use.
    """
    if not settings.sandbox_payments_enabled:
        raise HTTPException(status_code=404, detail="Not found")
    tx = _own_topup(db, current_user, topup_id)
    try:
        tx = sandbox_complete(db, tx)
    except TopupError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _topup_read(tx)


# ------------------------------------------------------------------------------
# Transport payment
# ------------------------------------------------------------------------------


def _resolved_read(db: Session, vehicle) -> ResolvedVehicleRead:
    quote = payment_service.vehicle_fare(db, vehicle)
    driver_name = vehicle.driver.user.full_name if vehicle.driver and vehicle.driver.user else ""
    # Passengers see only the driver's first name
    first_name = driver_name.split(" ")[0] if driver_name else ""
    return ResolvedVehicleRead(
        vehicle_id=vehicle.internal_id,
        plate_number=vehicle.plate_number,
        model=vehicle.model,
        route_id=vehicle.route_id,
        route_number=vehicle.route.route_number,
        route_name=vehicle.route.name,
        uyushma_name=vehicle.uyushma.name,
        driver_name=first_name,
        fare_uzs=quote.amount_uzs,
        fare_rule_name=quote.rule_name,
        is_on_shift=payment_service.is_vehicle_on_shift(db, vehicle),
    )


@payments_router.post("/resolve-vehicle", response_model=ResolvedVehicleRead)
def resolve_vehicle(
    payload: ResolveVehicleRequest,
    request: Request,
    db: Session = Depends(get_db_dep),
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Identify the vehicle from a QR payload, NFC tag, plate or internal id and quote the fare.

    Open to anonymous passengers (they scan before signing in), so it is rate limited and answers
    anonymous callers with a single generic error — the detailed reasons would otherwise let
    anyone enumerate the fleet of every Uyushma.
    """
    if current_user is None:
        limit_by_ip(vehicle_lookup_limiter, request, "Juda ko'p so'rov. Birozdan so'ng qayta urinib ko'ring.")
    try:
        vehicle = payment_service.resolve_vehicle(db, payload.identifier)
        return _resolved_read(db, vehicle)
    except payment_service.PaymentError as exc:
        if current_user is None and exc.status_code in (404, 409):
            raise HTTPException(status_code=404, detail="Transport topilmadi yoki to'lovga tayyor emas") from exc
        raise _payment_error(exc) from exc


def _client_payment_read(db: Session, payment: Payment, balance_after: Optional[int] = None) -> ClientPaymentRead:
    refund = payment_service.payment_refund(payment)
    vehicle = payment.vehicle
    driver_name = payment.driver.user.full_name.split(" ")[0] if payment.driver and payment.driver.user else ""
    return ClientPaymentRead(
        payment_id=payment.id,
        reference=payment.reference,
        status=payment.status,
        amount_uzs=payment.amount_uzs,
        payment_method=payment.payment_method,
        identification_method=payment.identification_method,
        paid_at=payment.created_at,
        vehicle=ResolvedVehicleRead(
            vehicle_id=vehicle.internal_id,
            plate_number=vehicle.plate_number,
            model=vehicle.model,
            route_id=payment.route_id,
            route_number=payment.route.route_number if payment.route else "",
            route_name=payment.route.name if payment.route else "",
            uyushma_name=vehicle.uyushma.name if vehicle.uyushma else "",
            driver_name=driver_name,
            fare_uzs=payment.amount_uzs,
            fare_rule_name="",
            is_on_shift=False,
        ),
        balance_after_uzs=balance_after,
        refunded_at=refund.created_at if refund else None,
        refund_reason=refund.reason if refund else None,
    )


@payments_router.post("/pay", response_model=ClientPaymentRead, status_code=status.HTTP_201_CREATED)
def pay_fare(
    payload: PayRequest,
    background: BackgroundTasks,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=8, max_length=80),
    current_user: User = Depends(require_client),
    db: Session = Depends(get_db_dep),
):
    """
    Pay the fare from the wallet. `Idempotency-Key` makes retries safe: the same key always
    returns the original payment and never charges twice.
    """
    try:
        result = payment_service.pay_ride(
            db, current_user, payload.identifier, f"client:{current_user.id}:{idempotency_key}", payload.method
        )
    except payment_service.PaymentError as exc:
        raise _payment_error(exc) from exc
    wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
    if not result.replayed:
        events.payment_received(background, db, result.payment, int(get_setting(db, "refund_window_minutes")))
    return _client_payment_read(db, result.payment, wallet.balance_uzs if wallet else None)


@payments_router.get("/my", response_model=List[ClientPaymentRead])
def my_payments(
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_client),
    db: Session = Depends(get_db_dep),
):
    rows = (
        db.query(Payment)
        .filter(Payment.client_user_id == current_user.id)
        .order_by(Payment.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_client_payment_read(db, p) for p in rows]


# ------------------------------------------------------------------------------
# Click SHOP API callbacks (called by Click servers, authenticated by MD5 signature)
# ------------------------------------------------------------------------------


async def _click_form(request: Request) -> dict:
    form = await request.form()
    return {k: v for k, v in form.items() if isinstance(v, str)}


@payments_router.post("/webhook/click/prepare")
async def click_prepare(request: Request, db: Session = Depends(get_db_dep)):
    return handle_click_webhook(db, await _click_form(request), ACTION_PREPARE)


@payments_router.post("/webhook/click/complete")
async def click_complete(request: Request, db: Session = Depends(get_db_dep)):
    return handle_click_webhook(db, await _click_form(request), ACTION_COMPLETE)
