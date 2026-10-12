import hashlib
import uuid
from datetime import datetime, timezone, timedelta
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.core.roles import UserRole
from app.core.security import create_access_token, get_password_hash
from app.db.session import SessionLocal
from app.main import app
from app.models.finance import FareRule, Payment, Refund, CashoutRequest, Wallet, WalletTransaction
from app.models.transport import Route, Vehicle
from app.models.user import DriverProfile, User
from app.models.uyushma import Uyushma
from app.services.fare.fare_service import fare_service, FareCalculationResult
from app.services.fare.fixed_engine import FixedFareEngine
from app.services.fare.distance_engine import DistanceFareEngine
from app.services.fare.zone_engine import ZoneFareEngine
from app.services.fare.base import BaseFareEngine
from app.services.payment.providers.click import (
    ClickProviderAdapter,
    CLICK_SUCCESS,
    CLICK_ERROR_SIGN_CHECK,
)
from app.services.payment.providers.registry import payment_registry
from app.services.payment.transport_payment_service import transport_payment_service
from app.services.payment.cashout_service import cashout_service
from app.services.wallet.ledger_service import (
    wallet_ledger_service,
    InsufficientFundsError,
)


@pytest.fixture
def finance_test_setup():
    """Setup test Uyushma, Route, Driver, Vehicle, Client, and Wallets."""
    db = SessionLocal()
    uid = uuid.uuid4().hex[:6]

    # 1. Uyushma
    uyushma = Uyushma(
        name=f"Andijon Test Uyushma {uid}",
        code=f"UYU-{uid}",
        phone=f"+99890{uid[:7]}",
        is_active=True,
    )
    db.add(uyushma)
    db.commit()
    db.refresh(uyushma)

    # 2. Uyushma Admin User
    admin_user = User(
        phone=f"+99893{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Uyushma Admin Test",
        role=UserRole.UYUSHMA_ADMIN.value,
        uyushma_id=uyushma.id,
    )
    db.add(admin_user)
    db.commit()
    db.refresh(admin_user)
    admin_token = create_access_token(
        subject=admin_user.id,
        role=admin_user.role,
        uyushma_id=uyushma.id,
    )

    # 3. Route
    route = Route(
        uyushma_id=uyushma.id,
        route_number=f"F-{uid[:3]}",
        name=f"Vokzal - Bozor {uid}",
        is_published=True,
    )
    db.add(route)
    db.commit()
    db.refresh(route)

    # Route-specific Fare Rule: 3000 UZS
    fare_rule = FareRule(
        uyushma_id=uyushma.id,
        route_id=route.id,
        rule_type="fixed",
        base_fare_uzs=3000,
        is_active=True,
    )
    db.add(fare_rule)
    db.commit()

    # 4. Driver 1
    driver_user1 = User(
        phone=f"+99894{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Haydovchi Shuxrat",
        role=UserRole.DRIVER.value,
        uyushma_id=uyushma.id,
    )
    db.add(driver_user1)
    db.commit()
    db.refresh(driver_user1)

    driver_profile1 = DriverProfile(
        user_id=driver_user1.id,
        uyushma_id=uyushma.id,
        license_number=f"DRV-{uid}",
    )
    db.add(driver_profile1)
    db.commit()
    db.refresh(driver_profile1)

    driver_wallet1 = wallet_ledger_service.get_or_create_wallet(driver_user1.id, db)
    driver1_token = create_access_token(
        subject=driver_user1.id,
        role=driver_user1.role,
        uyushma_id=uyushma.id,
    )

    # Vehicle for Driver 1
    internal_id1 = f"VEH-F1-{uid}"
    vehicle1 = Vehicle(
        internal_id=internal_id1,
        uyushma_id=uyushma.id,
        driver_id=driver_profile1.id,
        route_id=route.id,
        plate_number="60 777 AAA",
        model="Damas",
    )
    db.add(vehicle1)
    db.commit()
    db.refresh(vehicle1)

    # 5. Driver 2 (For cross-driver isolation tests)
    driver_user2 = User(
        phone=f"+99895{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Haydovchi Botir",
        role=UserRole.DRIVER.value,
        uyushma_id=uyushma.id,
    )
    db.add(driver_user2)
    db.commit()
    db.refresh(driver_user2)

    driver_profile2 = DriverProfile(
        user_id=driver_user2.id,
        uyushma_id=uyushma.id,
        license_number=f"DRV2-{uid}",
    )
    db.add(driver_profile2)
    db.commit()
    db.refresh(driver_profile2)

    driver2_token = create_access_token(
        subject=driver_user2.id,
        role=driver_user2.role,
        uyushma_id=uyushma.id,
    )

    # 6. Client User with pre-funded wallet
    client_user = User(
        phone=f"+99897{uuid.uuid4().hex[:7]}",
        hashed_password=get_password_hash("pass123"),
        full_name="Mijoz Sardor",
        role=UserRole.CLIENT.value,
    )
    db.add(client_user)
    db.commit()
    db.refresh(client_user)

    client_wallet = wallet_ledger_service.get_or_create_wallet(client_user.id, db)
    # Pre-credit 50,000 UZS into client wallet
    wallet_ledger_service.credit(
        wallet_id=client_wallet.id,
        amount_uzs=50000,
        entry_type="topup",
        idempotency_key=f"init_client_{uid}",
        description="Initial test deposit",
        db=db,
    )

    client_token = create_access_token(
        subject=client_user.id,
        role=client_user.role,
    )

    result_data = {
        "uyushma_id": uyushma.id,
        "admin_user_id": admin_user.id,
        "admin_token": admin_token,
        "route_id": route.id,
        "driver1_id": driver_profile1.id,
        "driver1_user_id": driver_user1.id,
        "driver1_wallet_id": driver_wallet1.id,
        "driver1_token": driver1_token,
        "driver2_id": driver_profile2.id,
        "driver2_token": driver2_token,
        "vehicle1_id": vehicle1.id,
        "vehicle1_internal_id": internal_id1,
        "client_user_id": client_user.id,
        "client_wallet_id": client_wallet.id,
        "client_token": client_token,
    }
    db.close()
    return result_data


# =========================================================================
# 1. FARE ENGINE TESTS
# =========================================================================

def test_fare_engine_fixed_and_extensible():
    """Verify FixedFareEngine, DistanceFareEngine, ZoneFareEngine, and Custom extensions."""
    db = SessionLocal()
    try:
        # 1. Fixed Fare calculation with DB rule
        res_fixed = fare_service.calculate_fare(db=db)
        assert res_fixed.rule_type == "fixed"
        assert res_fixed.amount_uzs >= 2500

        # 2. Distance Fare engine directly
        dist_engine = DistanceFareEngine(default_base_uzs=2500, default_per_km_uzs=600)
        res_dist = dist_engine.calculate_fare(distance_km=5.0)
        assert res_dist.amount_uzs == 2500 + (5 * 600)
        assert res_dist.rule_type == "distance"
        assert res_dist.breakdown["distance_km"] == 5.0

        # 3. Zone Fare engine
        zone_engine = ZoneFareEngine()
        res_inner = zone_engine.calculate_fare(zone="inner_city")
        assert res_inner.amount_uzs == 2500
        res_inter = zone_engine.calculate_fare(zone="inter_district")
        assert res_inter.amount_uzs == 5000

        # 4. Custom strategy registration
        class StudentDiscountFareEngine(BaseFareEngine):
            def calculate_fare(self, **kwargs):
                return FareCalculationResult(
                    amount_uzs=1200,
                    rule_type="custom_student",
                    breakdown={"discount": "50%"},
                )

        fare_service.register_engine("student", StudentDiscountFareEngine())
        student_calc = fare_service.get_engine("student").calculate_fare()
        assert student_calc.amount_uzs == 1200
        assert student_calc.rule_type == "custom_student"
    finally:
        db.close()


# =========================================================================
# 2. WALLET LEDGER DOUBLE-ENTRY & TRANSACTION SAFETY TESTS
# =========================================================================

def test_wallet_ledger_double_entry_and_idempotency(finance_test_setup):
    """
    Verify transaction-safe ledger mutations:
    - Never arbitrary random balance UPDATEs
    - Non-negative balance enforcement on debit
    - Idempotency key deduplication
    - Double-entry transfer consistency
    """
    db = SessionLocal()
    setup = finance_test_setup
    try:
        wallet1_id = setup["client_wallet_id"]
        wallet2_id = setup["driver1_wallet_id"]

        bal_start1 = wallet_ledger_service.get_balance(wallet1_id, db)
        bal_start2 = wallet_ledger_service.get_balance(wallet2_id, db)

        # 1. Insufficient funds debit rejection
        with pytest.raises(InsufficientFundsError):
            wallet_ledger_service.debit(
                wallet_id=wallet1_id,
                amount_uzs=bal_start1 + 100000,
                entry_type="ride_payment",
                idempotency_key="overdraft_attempt",
                db=db,
            )

        # Balance remains unmodified
        assert wallet_ledger_service.get_balance(wallet1_id, db) == bal_start1

        # 2. Atomic Double-Entry Transfer (Client pays Driver 3,000 UZS)
        idemp_transfer = f"transfer_key_{uuid.uuid4().hex[:8]}"
        tx_debit, tx_credit = wallet_ledger_service.transfer(
            source_wallet_id=wallet1_id,
            target_wallet_id=wallet2_id,
            amount_uzs=3000,
            entry_type="ride_payment",
            idempotency_key=idemp_transfer,
            reference_id="ref_001",
            description="Marshrut ride payment",
            db=db,
        )

        assert tx_debit.amount_uzs == -3000
        assert tx_debit.entry_type == "ride_payment"
        assert tx_credit.amount_uzs == 3000
        assert tx_credit.entry_type == "ride_payment"

        bal_after1 = wallet_ledger_service.get_balance(wallet1_id, db)
        bal_after2 = wallet_ledger_service.get_balance(wallet2_id, db)
        assert bal_after1 == bal_start1 - 3000
        assert bal_after2 == bal_start2 + 3000

        # 3. Idempotency Protection: Replaying the exact same key MUST NOT double-charge
        tx_d2, tx_c2 = wallet_ledger_service.transfer(
            source_wallet_id=wallet1_id,
            target_wallet_id=wallet2_id,
            amount_uzs=3000,
            entry_type="ride_payment",
            idempotency_key=idemp_transfer,
            db=db,
        )
        assert tx_d2.id == tx_debit.id
        assert tx_c2.id == tx_credit.id
        # Balances untouched!
        assert wallet_ledger_service.get_balance(wallet1_id, db) == bal_after1
        assert wallet_ledger_service.get_balance(wallet2_id, db) == bal_after2
    finally:
        db.close()


# =========================================================================
# 3. CLICK PAYMENT PROVIDER ADAPTER & WEBHOOK TESTS
# =========================================================================

@pytest.mark.asyncio
async def test_click_provider_flow(finance_test_setup):
    """
    Test Click top-up payment intent, Prepare (action=0),
    Complete (action=1), signature verification, and idempotency.
    """
    setup = finance_test_setup
    transport = ASGITransport(app=app)
    adapter = ClickProviderAdapter()

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Client creates Topup intent
        topup_res = await client.post(
            "/api/v1/wallet/topup/click",
            json={"amount_uzs": 25000, "return_url": "http://localhost:5173/wallet"},
            headers={"Authorization": f"Bearer {setup['client_token']}"},
        )
        assert topup_res.status_code == 201, topup_res.text
        topup_data = topup_res.json()
        assert "payment_url" in topup_data
        assert "my.click.uz" in topup_data["payment_url"]
        merchant_trans_id = topup_data["merchant_trans_id"]

        # 2. Click Prepare Step (action=0)
        import random
        click_trans_id = random.randint(10000000, 99999999)
        service_id = int(adapter._get_service_id())
        amount = 25000.0
        sign_time = "2026-10-12 12:00:00"

        # Valid MD5 sign for Prepare
        valid_sign_prep = adapter.compute_signature(
            click_trans_id=click_trans_id,
            service_id=service_id,
            merchant_trans_id=merchant_trans_id,
            amount=amount,
            action=0,
            sign_time=sign_time,
        )

        prep_payload = {
            "click_trans_id": click_trans_id,
            "service_id": service_id,
            "merchant_trans_id": merchant_trans_id,
            "amount": amount,
            "action": 0,
            "error": 0,
            "sign_time": sign_time,
            "sign_string": valid_sign_prep,
        }

        # Test invalid signature rejection
        bad_prep = dict(prep_payload, sign_string="invalid_tampered_signature")
        bad_res = await client.post("/api/v1/payments/webhook/click", json=bad_prep)
        assert bad_res.status_code == 200
        assert bad_res.json()["error"] == CLICK_ERROR_SIGN_CHECK

        # Execute valid prepare
        prep_res = await client.post("/api/v1/payments/webhook/click", json=prep_payload)
        assert prep_res.status_code == 200
        prep_data = prep_res.json()
        assert prep_data["error"] == CLICK_SUCCESS
        assert "merchant_prepare_id" in prep_data
        merchant_prepare_id = prep_data["merchant_prepare_id"]

        # 3. Click Complete Step (action=1)
        valid_sign_comp = adapter.compute_signature(
            click_trans_id=click_trans_id,
            service_id=service_id,
            merchant_trans_id=merchant_trans_id,
            merchant_prepare_id=merchant_prepare_id,
            amount=amount,
            action=1,
            sign_time=sign_time,
        )

        comp_payload = {
            "click_trans_id": click_trans_id,
            "service_id": service_id,
            "merchant_trans_id": merchant_trans_id,
            "merchant_prepare_id": merchant_prepare_id,
            "amount": amount,
            "action": 1,
            "error": 0,
            "sign_time": sign_time,
            "sign_string": valid_sign_comp,
        }

        comp_res = await client.post("/api/v1/payments/webhook/click", json=comp_payload)
        assert comp_res.status_code == 200
        comp_data = comp_res.json()
        assert comp_data["error"] == CLICK_SUCCESS
        assert "merchant_confirm_id" in comp_data

        # 4. Idempotency Check: Click retrying the exact Complete step
        comp_res_dup = await client.post("/api/v1/payments/webhook/click", json=comp_payload)
        assert comp_res_dup.status_code == 200
        assert comp_res_dup.json()["error"] == CLICK_SUCCESS
        assert "Already" in comp_res_dup.json()["error_note"]

        # 5. Verify Wallet Balance via API
        bal_res = await client.get(
            "/api/v1/wallet/balance",
            headers={"Authorization": f"Bearer {setup['client_token']}"},
        )
        assert bal_res.status_code == 200
        # Started with 50,000, added 25,000 -> 75,000
        assert bal_res.json()["balance_uzs"] >= 75000

        # 6. Verify Transaction Ledger history
        tx_res = await client.get(
            "/api/v1/wallet/transactions?entry_type=topup",
            headers={"Authorization": f"Bearer {setup['client_token']}"},
        )
        assert tx_res.status_code == 200
        items = tx_res.json()["items"]
        assert any(t["reference_id"] == str(click_trans_id) for t in items)


# =========================================================================
# 4. TRANSPORT PAYMENT (SCAN & PAY) & DRIVER ISOLATION TESTS
# =========================================================================

@pytest.mark.asyncio
async def test_transport_scan_pay_and_driver_isolation(finance_test_setup):
    """
    Test Passenger Scan & Pay:
    - Resolves internal vehicle identifier
    - Debits client wallet & credits driver wallet
    - Driver 1 can see this payment receipt
    - Driver 2 CANNOT see Driver 1's payment receipt (Tenant/Driver isolation)
    - Duplicate idempotency protection
    """
    setup = finance_test_setup
    transport = ASGITransport(app=app)
    vehicle_identifier = setup["vehicle1_internal_id"]

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Scan and Pay
        idemp_key = f"scan_pay_{uuid.uuid4().hex[:8]}"
        pay_res = await client.post(
            "/api/v1/payments/scan-pay",
            json={
                "vehicle_identifier": vehicle_identifier,
                "idempotency_key": idemp_key,
            },
            headers={"Authorization": f"Bearer {setup['client_token']}"},
        )
        assert pay_res.status_code == 201, pay_res.text
        pay_data = pay_res.json()
        payment_id = pay_data["id"]
        assert pay_data["status"] == "completed"
        assert pay_data["amount_uzs"] == 3000  # From route fare rule
        assert pay_data["vehicle_internal_id"] == vehicle_identifier

        # 2. Duplicate protection on same idempotency key
        pay_dup = await client.post(
            "/api/v1/payments/scan-pay",
            json={
                "vehicle_identifier": vehicle_identifier,
                "idempotency_key": idemp_key,
            },
            headers={"Authorization": f"Bearer {setup['client_token']}"},
        )
        assert pay_dup.status_code == 201
        assert pay_dup.json()["id"] == payment_id  # Exact same payment record

        # 3. Driver 1 views receipts (Must see this payment)
        d1_res = await client.get(
            "/api/v1/driver/payments",
            headers={"Authorization": f"Bearer {setup['driver1_token']}"},
        )
        assert d1_res.status_code == 200
        d1_payments = d1_res.json()
        assert any(p["id"] == payment_id for p in d1_payments["items"])
        assert d1_payments["total_amount_uzs"] >= 3000

        # 4. Driver 2 views receipts (Driver Isolation: Must NOT see Driver 1's payment)
        d2_res = await client.get(
            "/api/v1/driver/payments",
            headers={"Authorization": f"Bearer {setup['driver2_token']}"},
        )
        assert d2_res.status_code == 200
        d2_payments = d2_res.json()
        assert not any(p["id"] == payment_id for p in d2_payments["items"])


# =========================================================================
# 5. REFUND & ALLOWED WINDOW TESTS
# =========================================================================

@pytest.mark.asyncio
async def test_driver_refund_and_window_enforcement(finance_test_setup):
    """
    Test payment refund:
    - Driver 1 refunds a passenger payment
    - Reverse ledger entry created (driver debited, client credited)
    - Duplicate refund prevented
    - Driver 2 unauthorized to refund Driver 1's payment
    - Expired grace window rejects refund
    """
    setup = finance_test_setup
    transport = ASGITransport(app=app)
    vehicle_identifier = setup["vehicle1_internal_id"]

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create a fresh payment
        idemp = f"pay_for_refund_{uuid.uuid4().hex[:8]}"
        pay_res = await client.post(
            "/api/v1/payments/scan-pay",
            json={"vehicle_identifier": vehicle_identifier, "idempotency_key": idemp},
            headers={"Authorization": f"Bearer {setup['client_token']}"},
        )
        assert pay_res.status_code == 201
        payment_id = pay_res.json()["id"]

        # 1. Driver 2 attempts unauthorized refund (Must return 403 Forbidden)
        unauth_refund = await client.post(
            f"/api/v1/driver/payments/{payment_id}/refund",
            json={"reason": "Hacking attempt"},
            headers={"Authorization": f"Bearer {setup['driver2_token']}"},
        )
        assert unauth_refund.status_code == 403

        # 2. Driver 1 successfully refunds payment
        refund_res = await client.post(
            f"/api/v1/driver/payments/{payment_id}/refund",
            json={"reason": "Yo'lovchi adashib to'ladi"},
            headers={"Authorization": f"Bearer {setup['driver1_token']}"},
        )
        assert refund_res.status_code == 200
        refund_data = refund_res.json()
        assert refund_data["status"] == "completed"
        assert refund_data["payment_id"] == payment_id

        # 3. Duplicate refund attempt must fail (400 Bad Request)
        dup_refund = await client.post(
            f"/api/v1/driver/payments/{payment_id}/refund",
            json={"reason": "Second refund attempt"},
            headers={"Authorization": f"Bearer {setup['driver1_token']}"},
        )
        assert dup_refund.status_code == 400

        # 4. Grace window expiration test
        # Create older payment manually in DB
        db = SessionLocal()
        old_payment = Payment(
            id=str(uuid.uuid4()),
            wallet_id=setup["client_wallet_id"],
            client_user_id=setup["client_user_id"],
            vehicle_id=setup["vehicle1_id"],
            driver_id=setup["driver1_id"],
            route_id=setup["route_id"],
            amount_uzs=3000,
            payment_method="wallet",
            status="completed",
            idempotency_key=f"old_pay_{uuid.uuid4().hex}",
            created_at=datetime.now(timezone.utc) - timedelta(minutes=45),  # 45 mins ago (> 15 mins)
        )
        db.add(old_payment)
        db.commit()
        db.refresh(old_payment)
        db.close()

        expired_refund = await client.post(
            f"/api/v1/driver/payments/{old_payment.id}/refund",
            json={"reason": "Too late"},
            headers={"Authorization": f"Bearer {setup['driver1_token']}"},
        )
        assert expired_refund.status_code == 400
        assert "muddati tugagan" in expired_refund.json()["detail"]


# =========================================================================
# 6. CASHOUT FLOW (REQUEST -> APPROVE -> PAID LEDGER)
# =========================================================================

@pytest.mark.asyncio
async def test_cashout_workflow(finance_test_setup):
    """
    Test Driver Cashout flow:
    1. Driver requests cashout of earnings
    2. Uyushma admin inspects cashout requests (tenant isolated)
    3. Uyushma admin approves cashout request
    4. Uyushma admin marks paid -> debits driver wallet via double-entry ledger
    """
    setup = finance_test_setup
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Pre-deposit 20,000 UZS into Driver 1 wallet
        db = SessionLocal()
        wallet_ledger_service.credit(
            wallet_id=setup["driver1_wallet_id"],
            amount_uzs=20000,
            entry_type="ride_payment",
            idempotency_key=f"pre_cashout_credit_{uuid.uuid4().hex[:6]}",
            description="Ride earnings",
            db=db,
        )
        db.close()

        # 1. Driver requests cashout of 15,000 UZS
        req_res = await client.post(
            "/api/v1/driver/cashout/request",
            json={"amount_uzs": 15000, "notes": "Karta: 8600 0000 0000 1111"},
            headers={"Authorization": f"Bearer {setup['driver1_token']}"},
        )
        assert req_res.status_code == 201, req_res.text
        cashout_data = req_res.json()
        cashout_id = cashout_data["id"]
        assert cashout_data["status"] == "pending"

        # Overdraft cashout attempt (more than remaining balance) must fail
        overdraft_res = await client.post(
            "/api/v1/driver/cashout/request",
            json={"amount_uzs": 999999},
            headers={"Authorization": f"Bearer {setup['driver1_token']}"},
        )
        assert overdraft_res.status_code == 400

        # 2. Uyushma Admin lists cashout requests
        list_res = await client.get(
            "/api/v1/uyushma/cashouts?status=pending",
            headers={"Authorization": f"Bearer {setup['admin_token']}"},
        )
        assert list_res.status_code == 200
        items = list_res.json()["items"]
        assert any(c["id"] == cashout_id for c in items)

        # 3. Uyushma Admin approves request
        approve_res = await client.post(
            f"/api/v1/uyushma/cashout/{cashout_id}/approve",
            json={"notes": "Tasdiqlandi, to'lovga berildi"},
            headers={"Authorization": f"Bearer {setup['admin_token']}"},
        )
        assert approve_res.status_code == 200
        assert approve_res.json()["status"] == "approved"

        # 4. Uyushma Admin executes payout (Marks Paid and debits driver wallet via ledger)
        pay_res = await client.post(
            f"/api/v1/uyushma/cashout/{cashout_id}/pay",
            json={"notes": "Kassadan naqd berildi"},
            headers={"Authorization": f"Bearer {setup['admin_token']}"},
        )
        assert pay_res.status_code == 200
        assert pay_res.json()["status"] == "paid"

        # 5. Verify Driver's wallet ledger was debited with entry_type='cashout'
        db = SessionLocal()
        tx = (
            db.query(WalletTransaction)
            .filter(
                WalletTransaction.wallet_id == setup["driver1_wallet_id"],
                WalletTransaction.entry_type == "cashout",
                WalletTransaction.reference_id == str(cashout_id),
            )
            .first()
        )
        assert tx is not None
        assert tx.amount_uzs == -15000
        db.close()
