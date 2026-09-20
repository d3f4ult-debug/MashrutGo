from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

# ---------------------------------------------------------------- wallet (client)

class WalletBalanceRead(BaseModel):
    wallet_id: int
    balance_uzs: int
    currency: str = "UZS"
    is_active: bool


class LedgerEntryRead(BaseModel):
    id: int
    entry_type: str
    amount_uzs: int
    balance_after_uzs: int
    reference_type: Optional[str] = None
    reference_id: Optional[str] = None
    description: str
    created_at: datetime


class TopupCreateRequest(BaseModel):
    amount_uzs: int = Field(..., gt=0, examples=[10000])
    provider: str = Field("click", examples=["click"])


class TopupRead(BaseModel):
    id: int
    merchant_trans_id: str
    provider: str
    amount_uzs: int
    status: str  # created, prepared, completed, cancelled, failed
    checkout_url: Optional[str] = None
    is_sandbox: bool
    error_note: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None


class PaymentConfigRead(BaseModel):
    providers: list[str]
    click_configured: bool
    sandbox_enabled: bool
    min_topup_uzs: int
    max_topup_uzs: int
    maintenance_mode: bool


# ---------------------------------------------------------------- transport payment

class ResolveVehicleRequest(BaseModel):
    identifier: str = Field(..., min_length=1, max_length=300, description="QR payload, NFC tag, plate or internal id")
    method: str = Field("manual", pattern="^(qr|nfc|manual)$")


class ResolvedVehicleRead(BaseModel):
    vehicle_id: str  # internal id (printed on the QR sticker)
    plate_number: Optional[str] = None
    model: Optional[str] = None
    route_id: int
    route_number: str
    route_name: str
    uyushma_name: str
    driver_name: str
    fare_uzs: int
    fare_rule_name: str
    is_on_shift: bool


class PayRequest(ResolveVehicleRequest):
    pass


class ClientPaymentRead(BaseModel):
    payment_id: str
    reference: str
    status: str
    amount_uzs: int
    payment_method: str
    identification_method: str
    paid_at: datetime
    vehicle: ResolvedVehicleRead
    balance_after_uzs: Optional[int] = None
    refunded_at: Optional[datetime] = None
    refund_reason: Optional[str] = None


# ---------------------------------------------------------------- driver finance

class DriverPaymentRead(BaseModel):
    id: str
    reference: str
    vehicle_id: str
    route_id: int
    amount_uzs: int
    commission_uzs: int
    net_amount_uzs: int
    fare_name: Optional[str] = None
    status: str
    payment_method: str
    identification_method: str
    created_at: datetime
    refundable: bool
    refundable_until: Optional[datetime] = None
    refund_window_minutes: int
    refund_reason: Optional[str] = None
    refunded_at: Optional[datetime] = None
    passenger_label: str


class RefundRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=255)


class DriverBalanceRead(BaseModel):
    vehicle_id: Optional[str] = None
    balance: int
    available_balance: int
    pending_cashout: int
    today_gross: int
    today_earnings: int
    total_refunded_today: int
    rides_count_today: int
    shift_earnings: int


class CashoutCreateRequest(BaseModel):
    amount_uzs: int = Field(..., gt=0, le=100_000_000)
    method: str = Field("cash", pattern="^(cash|card|bank)$")
    payout_details: Optional[str] = Field(None, max_length=255)


class CashoutRead(BaseModel):
    id: int
    driver_id: int
    driver_name: str
    driver_phone: str
    uyushma_id: int
    vehicle_id: Optional[int] = None
    vehicle_internal_id: Optional[str] = None
    vehicle_plate: Optional[str] = None
    amount_uzs: int
    method: str
    payout_details: Optional[str] = None
    status: str
    created_at: datetime
    processed_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    processed_by: Optional[str] = None
    rejection_reason: Optional[str] = None
    payment_reference: Optional[str] = None


class CashoutPaidRequest(BaseModel):
    payment_reference: str = Field(..., min_length=2, max_length=100)


# ---------------------------------------------------------------- uyushma finance

class UyushmaPaymentRead(BaseModel):
    id: str
    reference: str
    uyushma_id: int
    route_id: int
    route_number: str
    vehicle_id: int
    vehicle_internal_id: str
    vehicle_plate: Optional[str] = None
    driver_id: int
    driver_name: str
    amount_uzs: int
    commission_uzs: int
    net_amount_uzs: int
    status: str
    payment_method: str
    identification_method: str
    created_at: datetime
    refund_reason: Optional[str] = None
    refunded_at: Optional[datetime] = None
    passenger_label: str


class FinanceSummaryRead(BaseModel):
    gross_revenue: int
    total_refunds: int
    platform_commission: int
    net_revenue: int
    completed_rides_count: int
    refunded_rides_count: int
    pending_cashouts_total: int
    paid_cashouts_total: int


class WalletAdjustRequest(BaseModel):
    amount_uzs: int = Field(..., description="Positive credit or negative debit", ge=-10_000_000, le=10_000_000)
    reason: str = Field(..., min_length=3, max_length=255)
