from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict


# --- Fare Engine Schemas ---
class FareCalculationRequest(BaseModel):
    route_id: Optional[int] = None
    uyushma_id: Optional[int] = None
    distance_km: Optional[float] = None
    zone: Optional[str] = None


class FareCalculationResponse(BaseModel):
    amount_uzs: int
    rule_type: str = "fixed"
    rule_id: Optional[int] = None
    currency: str = "UZS"
    breakdown: Dict[str, Any] = {}


# --- Wallet & Ledger Schemas ---
class WalletBalanceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    wallet_id: int
    user_id: int
    balance_uzs: int
    currency: str = "UZS"
    is_active: bool
    updated_at: datetime


class WalletTransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    wallet_id: int
    entry_type: str  # topup, ride_payment, refund, adjustment, cashout
    amount_uzs: int  # Positive for credit, negative for debit
    balance_after_uzs: int
    reference_id: Optional[str] = None
    description: str
    idempotency_key: str
    created_at: datetime


class WalletTransactionListResponse(BaseModel):
    items: List[WalletTransactionResponse]
    total: int
    page: int
    size: int
    pages: int


# --- Payment Provider & Intent Schemas ---
class TopupClickIntentRequest(BaseModel):
    amount_uzs: int = Field(..., gt=0, description="Amount in UZS to top up (minimum 1,000 UZS)")
    return_url: Optional[str] = Field(None, description="Client redirect URL after payment completion")


class TopupClickIntentResponse(BaseModel):
    payment_intent_id: str
    wallet_id: int
    amount_uzs: int
    payment_url: str
    service_id: str
    merchant_trans_id: str


# --- Click Webhook Schemas ---
class ClickWebhookRequest(BaseModel):
    click_trans_id: Any
    service_id: Any
    click_paydoc_id: Optional[Any] = None
    merchant_trans_id: str
    amount: float
    action: int  # 0: Prepare, 1: Complete
    error: int
    error_note: Optional[str] = None
    sign_time: str
    sign_string: str
    merchant_prepare_id: Optional[str] = None


class ClickWebhookResponse(BaseModel):
    click_trans_id: Any
    merchant_trans_id: str
    merchant_prepare_id: Optional[str] = None
    merchant_confirm_id: Optional[str] = None
    error: int  # 0: Success, negative codes for Click errors
    error_note: str


# --- Transport Payment (QR / NFC / Scan) ---
class TransportScanPayRequest(BaseModel):
    vehicle_identifier: str = Field(..., description="Internal ID (e.g. AND-101), numeric ID, or scanned QR/NFC code")
    idempotency_key: str = Field(..., description="Unique client transaction key preventing duplicate charges")


class RefundResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    payment_id: str
    driver_id: int
    amount_uzs: int
    reason: Optional[str] = None
    status: str
    created_at: datetime


class PaymentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    wallet_id: Optional[int] = None
    client_user_id: Optional[int] = None
    vehicle_id: int
    vehicle_internal_id: Optional[str] = None
    driver_id: int
    route_id: int
    route_number: Optional[str] = None
    amount_uzs: int
    payment_method: str
    status: str
    qr_or_nfc_code: Optional[str] = None
    external_trans_id: Optional[str] = None
    idempotency_key: str
    created_at: datetime
    refunds: List[RefundResponse] = []


class PaymentListResponse(BaseModel):
    items: List[PaymentResponse]
    total: int
    total_amount_uzs: int
    page: int
    size: int
    pages: int


# --- Refund Schemas ---
class RefundRequest(BaseModel):
    reason: Optional[str] = Field("Yo'lovchi xatosi sababli qaytarildi", description="Reason for refund")


# --- Cashout Schemas ---
class CashoutCreateRequest(BaseModel):
    amount_uzs: int = Field(..., gt=0, description="Amount in UZS to cash out from accumulated driver earnings")
    notes: Optional[str] = Field(None, description="Optional note or card details for payout")


class CashoutActionRequest(BaseModel):
    notes: Optional[str] = Field(None, description="Optional administrative notes or payout reference")


class CashoutResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    driver_id: int
    driver_name: Optional[str] = None
    uyushma_id: int
    amount_uzs: int
    status: str  # pending, approved, rejected, paid
    approved_by_user_id: Optional[int] = None
    processed_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CashoutListResponse(BaseModel):
    items: List[CashoutResponse]
    total: int
    page: int
    size: int
    pages: int
