import math
from typing import Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep, get_current_user
from app.models.user import User
from app.schemas.finance import (
    WalletBalanceResponse,
    WalletTransactionResponse,
    WalletTransactionListResponse,
    TopupClickIntentRequest,
    TopupClickIntentResponse,
)
from app.services.payment.providers.click import ClickProviderAdapter
from app.services.wallet.ledger_service import wallet_ledger_service

router = APIRouter(prefix="/wallet", tags=["wallet"])


@router.get("/balance", response_model=WalletBalanceResponse)
def get_my_wallet_balance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """Fetch current authenticated user's wallet balance."""
    wallet = wallet_ledger_service.get_or_create_wallet(current_user.id, db)
    return WalletBalanceResponse(
        wallet_id=wallet.id,
        user_id=wallet.user_id,
        balance_uzs=wallet.balance_uzs,
        currency=wallet.currency,
        is_active=wallet.is_active,
        updated_at=wallet.updated_at,
    )


@router.get("/transactions", response_model=WalletTransactionListResponse)
def get_my_wallet_transactions(
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(20, ge=1, le=100, description="Items per page"),
    entry_type: Optional[str] = Query(None, description="Filter by entry type (topup, ride_payment, refund, etc.)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """Fetch user's immutable double-entry ledger transactions."""
    wallet = wallet_ledger_service.get_or_create_wallet(current_user.id, db)
    items, total = wallet_ledger_service.get_transactions(
        wallet_id=wallet.id,
        page=page,
        size=size,
        entry_type=entry_type,
        db=db,
    )
    pages = math.ceil(total / size) if size > 0 else 0
    tx_responses = [
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
    ]
    return WalletTransactionListResponse(
        items=tx_responses,
        total=total,
        page=page,
        size=size,
        pages=pages,
    )


@router.post("/topup/click", response_model=TopupClickIntentResponse, status_code=status.HTTP_201_CREATED)
def create_click_topup_intent(
    payload: TopupClickIntentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """Initiate a Click top-up intent returning a signed redirect checkout URL."""
    wallet = wallet_ledger_service.get_or_create_wallet(current_user.id, db)
    click_adapter = ClickProviderAdapter()
    result = click_adapter.create_topup_intent(
        wallet_id=wallet.id,
        amount_uzs=payload.amount_uzs,
        return_url=payload.return_url,
        db=db,
    )
    return TopupClickIntentResponse(**result)
