"""
Financial domain models.

Invariants (enforced by app.services.ledger_service):
- Wallet.balance_uzs is a cached projection of SUM(WalletTransaction.amount_uzs) for the wallet.
  It is only mutated together with an appended, immutable WalletTransaction row.
- WalletTransaction rows are never updated or deleted; corrections are new entries.
- Every money-moving request carries an idempotency key that is unique per ledger entry.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import BigInteger, Column, Integer, String, Boolean, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.db.types import UTCDateTime


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FareRule(Base):
    __tablename__ = "fare_rules"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    uyushma_id = Column(Integer, ForeignKey("uyushmas.id", ondelete="CASCADE"), nullable=False, index=True)
    # NULL route_id = default rule for every route of the Uyushma; a route-specific rule overrides it
    route_id = Column(Integer, ForeignKey("routes.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(150), default="Standart tarif", nullable=False)
    description = Column(String(255), nullable=True)
    rule_type = Column(String(20), default="fixed", nullable=False)  # fixed, distance, zone, time_based
    base_fare_uzs = Column(BigInteger, default=2500, nullable=False)
    extra_fare_per_km_uzs = Column(BigInteger, default=0, nullable=False)
    # Rule-type specific parameters as JSON (included_km, cross_zone_extra, peak_multiplier, peak_* hours)
    config_json = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)

    uyushma = relationship("Uyushma", back_populates="fare_rules")
    route = relationship("Route", back_populates="fare_rules")


class Wallet(Base):
    __tablename__ = "wallets"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    balance_uzs = Column(BigInteger, default=0, nullable=False)
    currency = Column(String(10), default="UZS", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)

    user = relationship("User", back_populates="wallet")
    transactions = relationship("WalletTransaction", back_populates="wallet", cascade="all, delete-orphan")


class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id", ondelete="CASCADE"), nullable=False, index=True)
    # topup, ride_payment, ride_earning, refund, refund_reversal, cashout, adjustment
    entry_type = Column(String(30), nullable=False, index=True)
    amount_uzs = Column(BigInteger, nullable=False)  # Positive = credit, negative = debit
    balance_after_uzs = Column(BigInteger, nullable=False)
    reference_type = Column(String(30), nullable=True)  # payment, refund, cashout, provider_transaction, admin
    reference_id = Column(String(64), nullable=True, index=True)
    description = Column(String(255), nullable=False)
    idempotency_key = Column(String(100), unique=True, index=True, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False, index=True)

    wallet = relationship("Wallet", back_populates="transactions")


class Payment(Base):
    """A passenger's fare payment for a concrete vehicle."""

    __tablename__ = "payments"

    id = Column(String(36), primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    reference = Column(String(20), unique=True, index=True, nullable=False)  # human readable, e.g. PAY-7F3K2Q9A
    wallet_id = Column(Integer, ForeignKey("wallets.id", ondelete="SET NULL"), nullable=True)
    client_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False, index=True)
    driver_id = Column(Integer, ForeignKey("driver_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    route_id = Column(Integer, ForeignKey("routes.id", ondelete="CASCADE"), nullable=False, index=True)
    uyushma_id = Column(Integer, ForeignKey("uyushmas.id", ondelete="CASCADE"), nullable=False, index=True)
    fare_rule_id = Column(Integer, ForeignKey("fare_rules.id", ondelete="SET NULL"), nullable=True)
    amount_uzs = Column(BigInteger, nullable=False)
    commission_uzs = Column(BigInteger, default=0, nullable=False)
    payment_method = Column(String(20), default="wallet", nullable=False)  # wallet, click
    identification_method = Column(String(20), default="manual", nullable=False)  # qr, nfc, manual
    status = Column(String(20), default="completed", nullable=False, index=True)  # completed, refunded, failed
    qr_or_nfc_code = Column(String(100), nullable=True)
    external_trans_id = Column(String(64), nullable=True, index=True)
    idempotency_key = Column(String(100), unique=True, index=True, nullable=False)
    refundable_until = Column(UTCDateTime(), nullable=True)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False, index=True)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)

    vehicle = relationship("Vehicle", back_populates="payments")
    driver = relationship("DriverProfile")
    route = relationship("Route")
    client = relationship("User", foreign_keys=[client_user_id])
    refunds = relationship("Refund", back_populates="payment", cascade="all, delete-orphan")


class Refund(Base):
    __tablename__ = "refunds"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # Full refunds only: one refund per payment (DB-level duplicate protection)
    payment_id = Column(String(36), ForeignKey("payments.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    driver_id = Column(Integer, ForeignKey("driver_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    initiated_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    amount_uzs = Column(BigInteger, nullable=False)
    reason = Column(String(255), nullable=True)
    status = Column(String(20), default="completed", nullable=False)  # completed
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)

    payment = relationship("Payment", back_populates="refunds")


class CashoutRequest(Base):
    """
    Driver asks the Uyushma to pay out accumulated earnings in cash/card.
    Lifecycle: pending -> approved -> paid | pending/approved -> rejected.
    The driver's wallet is debited (ledger entry) only when the Uyushma marks it paid;
    pending/approved amounts are reserved from the available balance.
    """

    __tablename__ = "cashout_requests"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    driver_id = Column(Integer, ForeignKey("driver_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    uyushma_id = Column(Integer, ForeignKey("uyushmas.id", ondelete="CASCADE"), nullable=False, index=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id", ondelete="SET NULL"), nullable=True)
    amount_uzs = Column(BigInteger, nullable=False)
    method = Column(String(20), default="cash", nullable=False)  # cash, card, bank
    payout_details = Column(String(255), nullable=True)
    status = Column(String(20), default="pending", nullable=False, index=True)  # pending, approved, rejected, paid
    approved_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    paid_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    processed_at = Column(UTCDateTime(), nullable=True)
    paid_at = Column(UTCDateTime(), nullable=True)
    rejection_reason = Column(String(255), nullable=True)
    payment_reference = Column(String(100), nullable=True)
    notes = Column(String(255), nullable=True)
    idempotency_key = Column(String(100), unique=True, nullable=True)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False, index=True)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)

    driver = relationship("DriverProfile")
    vehicle = relationship("Vehicle")


class ProviderTransaction(Base):
    """External payment provider transaction (e.g. Click wallet top-up)."""

    __tablename__ = "provider_transactions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    provider = Column(String(20), nullable=False, index=True)  # click, payme, uzum, humo
    purpose = Column(String(30), default="wallet_topup", nullable=False)
    merchant_trans_id = Column(String(64), unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id", ondelete="SET NULL"), nullable=True)
    amount_uzs = Column(BigInteger, nullable=False)
    # created -> prepared -> completed | cancelled | failed
    status = Column(String(20), default="created", nullable=False, index=True)
    provider_trans_id = Column(String(64), nullable=True, index=True)
    provider_paydoc_id = Column(String(64), nullable=True)
    error_code = Column(Integer, nullable=True)
    error_note = Column(String(255), nullable=True)
    is_sandbox = Column(Boolean, default=False, nullable=False)
    prepared_at = Column(UTCDateTime(), nullable=True)
    completed_at = Column(UTCDateTime(), nullable=True)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("provider", "provider_trans_id", name="uq_provider_trans_id"),
    )
