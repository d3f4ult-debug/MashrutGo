from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.orm import relationship
from app.db.base import Base


class Uyushma(Base):
    __tablename__ = "uyushmas"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(150), nullable=False)
    code = Column(String(50), unique=True, index=True, nullable=False)
    phone = Column(String(20), nullable=False)
    address = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    drivers = relationship("DriverProfile", back_populates="uyushma", cascade="all, delete-orphan")
    vehicles = relationship("Vehicle", back_populates="uyushma", cascade="all, delete-orphan")
    routes = relationship("Route", back_populates="uyushma", cascade="all, delete-orphan")
    parkings = relationship("Parking", back_populates="uyushma")
    fare_rules = relationship("FareRule", back_populates="uyushma", cascade="all, delete-orphan")
