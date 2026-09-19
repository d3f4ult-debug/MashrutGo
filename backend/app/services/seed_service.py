from sqlalchemy.orm import Session
from app.core.roles import UserRole
from app.core.security import get_password_hash
from app.models.user import User
from app.models.uyushma import Uyushma
from app.models.finance import FareRule, Wallet


def seed_initial_data(db: Session) -> None:
    """Seed base administrative data if not present."""
    # 1. Super Admin
    super_admin = db.query(User).filter(User.phone == "+998901234567").first()
    if not super_admin:
        super_admin = User(
            phone="+998901234567",
            hashed_password=get_password_hash("admin123"),
            full_name="Super Administrator",
            role=UserRole.SUPER_ADMIN.value,
            is_active=True,
        )
        db.add(super_admin)
        db.commit()
        db.refresh(super_admin)

    # 2. Default Uyushma
    default_uyushma = db.query(Uyushma).filter(Uyushma.code == "AND-01").first()
    if not default_uyushma:
        default_uyushma = Uyushma(
            name="Andijon Shahar Yo'lovchi Tashish Uyushmasi",
            code="AND-01",
            phone="+998742230001",
            address="Andijon shahar, Navoiy shoh ko'chasi, 1",
            is_active=True,
        )
        db.add(default_uyushma)
        db.commit()
        db.refresh(default_uyushma)

        # Base Fare Rule for this Uyushma
        base_fare = FareRule(
            uyushma_id=default_uyushma.id,
            rule_type="fixed",
            base_fare_uzs=2500,
            is_active=True,
        )
        db.add(base_fare)
        db.commit()

    # 3. Uyushma Admin User
    uyushma_admin = db.query(User).filter(User.phone == "+998901234568").first()
    if not uyushma_admin:
        uyushma_admin = User(
            phone="+998901234568",
            hashed_password=get_password_hash("uyushma123"),
            full_name="Andijon Avtotrans Dispetcher",
            role=UserRole.UYUSHMA_ADMIN.value,
            uyushma_id=default_uyushma.id,
            is_active=True,
        )
        db.add(uyushma_admin)
        db.commit()
