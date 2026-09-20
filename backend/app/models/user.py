from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.db.types import UTCDateTime
from app.core.roles import UserRole


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    phone = Column(String(20), unique=True, index=True, nullable=False)
    email = Column(String(150), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=False)
    role = Column(String(30), default=UserRole.CLIENT.value, nullable=False, index=True)
    uyushma_id = Column(Integer, ForeignKey("uyushmas.id", ondelete="SET NULL"), nullable=True, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    # Set when an administrator blocks the account (is_active is then False)
    block_reason = Column(String(255), nullable=True)
    last_active_at = Column(UTCDateTime(), nullable=True)
    # Tokens issued before this moment are rejected (password change / forced sign-out)
    password_changed_at = Column(UTCDateTime(), nullable=True)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)

    # Relationships
    client_profile = relationship("ClientProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    driver_profile = relationship("DriverProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    wallet = relationship("Wallet", back_populates="user", uselist=False, cascade="all, delete-orphan")


class ClientProfile(Base):
    __tablename__ = "client_profiles"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    preferred_language = Column(String(10), default="uz", nullable=False)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)

    user = relationship("User", back_populates="client_profile")


class DriverProfile(Base):
    __tablename__ = "driver_profiles"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    uyushma_id = Column(Integer, ForeignKey("uyushmas.id", ondelete="CASCADE"), nullable=False, index=True)
    license_number = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)

    user = relationship("User", back_populates="driver_profile")
    uyushma = relationship("Uyushma", back_populates="drivers")
    vehicle = relationship("Vehicle", back_populates="driver", uselist=False)
    shifts = relationship("DriverShift", back_populates="driver", cascade="all, delete-orphan")
