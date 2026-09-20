from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.db.types import UTCDateTime


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Uyushma(Base):
    __tablename__ = "uyushmas"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(150), nullable=False)
    code = Column(String(50), unique=True, index=True, nullable=False)
    phone = Column(String(20), nullable=False)
    address = Column(String(255), nullable=True)
    region = Column(String(150), nullable=True)
    contact_person = Column(String(100), nullable=True)
    license_number = Column(String(60), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    # Archive is a soft-delete: data stays for finance/audit history
    archived_at = Column(UTCDateTime(), nullable=True)
    archive_reason = Column(String(255), nullable=True)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)

    # Relationships
    drivers = relationship("DriverProfile", back_populates="uyushma", cascade="all, delete-orphan")
    vehicles = relationship("Vehicle", back_populates="uyushma", cascade="all, delete-orphan")
    routes = relationship("Route", back_populates="uyushma", cascade="all, delete-orphan")
    parkings = relationship("Parking", back_populates="uyushma")
    fare_rules = relationship("FareRule", back_populates="uyushma", cascade="all, delete-orphan")
