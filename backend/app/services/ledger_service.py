"""
Wallet ledger service — the ONLY place where wallet balances change.

Every balance mutation:
1. is performed with an atomic conditional UPDATE (`balance = balance + amount WHERE balance + amount >= 0`),
   which is race-free on both SQLite (database write lock) and PostgreSQL (row lock);
2. appends an immutable WalletTransaction with the resulting `balance_after_uzs`;
3. is keyed by a unique idempotency key, so retries never double-post.

Callers own the DB transaction (this module never commits), so a business operation such as
"ride payment" (client debit + driver credit + payment row + audit) commits or rolls back as a unit.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select, true, update
from sqlalchemy.orm import Session

from app.models.finance import Wallet, WalletTransaction
from app.models.user import User

ENTRY_TYPES = {
    "topup",
    "ride_payment",
    "ride_earning",
    "refund",
    "refund_reversal",
    "cashout",
    "adjustment",
}


class LedgerError(Exception):
    """Base ledger failure."""


class InsufficientFundsError(LedgerError):
    pass


class WalletInactiveError(LedgerError):
    pass


class IdempotencyConflictError(LedgerError):
    """Same idempotency key reused for a different wallet/amount."""


@dataclass
class ReconciliationResult:
    wallet_id: int
    cached_balance: int
    ledger_balance: int

    @property
    def is_consistent(self) -> bool:
        return self.cached_balance == self.ledger_balance


def get_or_create_wallet(db: Session, user: User) -> Wallet:
    wallet = db.query(Wallet).filter(Wallet.user_id == user.id).first()
    if wallet:
        return wallet
    wallet = Wallet(user_id=user.id, balance_uzs=0, currency="UZS", is_active=True)
    db.add(wallet)
    db.flush()
    return wallet


def find_entry(db: Session, idempotency_key: str) -> Optional[WalletTransaction]:
    return db.query(WalletTransaction).filter(WalletTransaction.idempotency_key == idempotency_key).first()


def lock_wallet(db: Session, wallet_id: int) -> None:
    """
    Serialise concurrent decisions about one wallet until the transaction ends.
    PostgreSQL: SELECT … FOR UPDATE. SQLite: a no-op UPDATE, which takes the write lock
    (other writers wait for `busy_timeout`). Without this, read-then-insert checks race.
    """
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        db.execute(select(Wallet.id).where(Wallet.id == wallet_id).with_for_update())
    else:
        db.execute(
            update(Wallet)
            .where(Wallet.id == wallet_id)
            .values(updated_at=datetime.now(timezone.utc))
            .execution_options(synchronize_session=False)
        )


def post_entry(
    db: Session,
    wallet: Wallet,
    entry_type: str,
    amount_uzs: int,
    description: str,
    idempotency_key: str,
    reference_type: Optional[str] = None,
    reference_id: Optional[str] = None,
    created_by_user_id: Optional[int] = None,
    allow_negative: bool = False,
) -> WalletTransaction:
    """Append a ledger entry and atomically move the wallet balance. Does not commit."""
    if entry_type not in ENTRY_TYPES:
        raise LedgerError(f"Unknown ledger entry type '{entry_type}'")
    if amount_uzs == 0:
        raise LedgerError("Ledger entry amount must be non-zero")

    existing = find_entry(db, idempotency_key)
    if existing:
        if existing.wallet_id != wallet.id or existing.amount_uzs != amount_uzs or existing.entry_type != entry_type:
            raise IdempotencyConflictError(f"Idempotency key '{idempotency_key}' already used for another operation")
        return existing

    guard = true() if allow_negative else (Wallet.balance_uzs + amount_uzs) >= 0
    result = db.execute(
        update(Wallet)
        .where(Wallet.id == wallet.id, Wallet.is_active.is_(True), guard)
        .values(balance_uzs=Wallet.balance_uzs + amount_uzs, updated_at=datetime.now(timezone.utc))
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        is_active = db.execute(select(Wallet.is_active).where(Wallet.id == wallet.id)).scalar_one_or_none()
        if not is_active:
            raise WalletInactiveError("Wallet is inactive")
        raise InsufficientFundsError("Insufficient wallet balance")

    new_balance = db.execute(select(Wallet.balance_uzs).where(Wallet.id == wallet.id)).scalar_one()
    db.expire(wallet, ["balance_uzs", "updated_at"])

    entry = WalletTransaction(
        wallet_id=wallet.id,
        entry_type=entry_type,
        amount_uzs=amount_uzs,
        balance_after_uzs=new_balance,
        reference_type=reference_type,
        reference_id=reference_id,
        description=description[:255],
        idempotency_key=idempotency_key,
        created_by_user_id=created_by_user_id,
    )
    db.add(entry)
    db.flush()
    return entry


def ledger_balance(db: Session, wallet_id: int) -> int:
    total = db.execute(
        select(func.coalesce(func.sum(WalletTransaction.amount_uzs), 0)).where(WalletTransaction.wallet_id == wallet_id)
    ).scalar_one()
    return int(total)


def reconcile_wallet(db: Session, wallet: Wallet) -> ReconciliationResult:
    db.refresh(wallet)
    return ReconciliationResult(
        wallet_id=wallet.id,
        cached_balance=wallet.balance_uzs,
        ledger_balance=ledger_balance(db, wallet.id),
    )
