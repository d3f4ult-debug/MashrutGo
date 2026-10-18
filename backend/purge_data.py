from app.db.session import SessionLocal
from app.models.user import User, DriverProfile, ClientProfile
from app.models.uyushma import Uyushma
from app.models.transport import Route, RouteDirection, RouteWaypoint, Vehicle, Parking
from app.models.finance import Payment, Wallet, CashoutRequest, Refund, WalletTransaction, FareRule
from app.models.shift import DriverShift
from app.core.security import get_password_hash

db = SessionLocal()
try:
    # 1. Clear finance transactions
    db.query(Payment).delete()
    db.query(CashoutRequest).delete()
    db.query(Refund).delete()
    db.query(WalletTransaction).delete()
    db.query(Wallet).delete()
    db.query(FareRule).delete()

    # 2. Clear shifts
    db.query(DriverShift).delete()

    # 3. Clear transport
    db.query(RouteWaypoint).delete()
    db.query(RouteDirection).delete()
    db.query(Vehicle).delete()
    db.query(Route).delete()
    db.query(Parking).delete()

    # 4. Clear profiles
    db.query(DriverProfile).delete()
    db.query(ClientProfile).delete()

    # 5. Clear uyushmas and non-admin users
    db.query(User).filter(User.phone != '+998901234567').delete()
    db.query(Uyushma).delete()

    # Ensure Super Admin exists with exact password Adminkeldi1
    admin_user = db.query(User).filter(User.phone == '+998901234567').first()
    if admin_user:
        admin_user.hashed_password = get_password_hash("Adminkeldi1")
        admin_user.full_name = "Super Administrator"
        admin_user.role = "super_admin"
        admin_user.is_active = True
    else:
        admin_user = User(
            phone='+998901234567',
            hashed_password=get_password_hash("Adminkeldi1"),
            full_name="Super Administrator",
            role="super_admin",
            is_active=True
        )
        db.add(admin_user)

    db.commit()
    print("Database purged cleanly!")
    print("Users count:", db.query(User).count())
    print("Uyushmas count:", db.query(Uyushma).count())
    print("Routes count:", db.query(Route).count())
    print("Clients count:", db.query(User).filter(User.role == 'client').count())
    print("Drivers count:", db.query(User).filter(User.role == 'driver').count())
finally:
    db.close()
