from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.db.types import UTCDateTime


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # Mandatory, system-wide unique identifier. Printed as QR on the vehicle.
    internal_id = Column(String(50), unique=True, index=True, nullable=False)
    uyushma_id = Column(Integer, ForeignKey("uyushmas.id", ondelete="CASCADE"), nullable=False, index=True)
    driver_id = Column(Integer, ForeignKey("driver_profiles.id", ondelete="SET NULL"), unique=True, nullable=True)  # 1 driver -> 1 vehicle
    route_id = Column(Integer, ForeignKey("routes.id", ondelete="SET NULL"), nullable=True, index=True)  # 1 vehicle -> 1 route
    plate_number = Column(String(20), nullable=True, index=True)
    model = Column(String(50), nullable=True)
    color = Column(String(30), nullable=True)
    vehicle_type = Column(String(20), nullable=True)  # damas, gazel, isuzu, bus, minibus, other
    # Optional NFC sticker UID / NDEF payload bound to this vehicle
    nfc_tag_id = Column(String(100), unique=True, nullable=True)
    capacity = Column(Integer, default=7, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)

    # Relationships
    uyushma = relationship("Uyushma", back_populates="vehicles")
    driver = relationship("DriverProfile", back_populates="vehicle")
    route = relationship("Route", back_populates="vehicles")
    shifts = relationship("DriverShift", back_populates="vehicle", cascade="all, delete-orphan")
    location_snapshots = relationship("LocationSnapshot", back_populates="vehicle", cascade="all, delete-orphan")
    payments = relationship("Payment", back_populates="vehicle")


class Route(Base):
    __tablename__ = "routes"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    uyushma_id = Column(Integer, ForeignKey("uyushmas.id", ondelete="CASCADE"), nullable=False, index=True)
    route_number = Column(String(20), index=True, nullable=False)
    name = Column(String(150), nullable=False)
    description = Column(String(500), nullable=True)
    is_published = Column(Boolean, default=False, nullable=False, index=True)
    # Soft delete: archived routes disappear from search and management lists
    is_archived = Column(Boolean, default=False, nullable=False, index=True)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("uyushma_id", "route_number", name="uq_uyushma_route_number"),
    )

    # Relationships
    uyushma = relationship("Uyushma", back_populates="routes")
    vehicles = relationship("Vehicle", back_populates="route")
    directions = relationship(
        "RouteDirection",
        back_populates="route",
        cascade="all, delete-orphan",
        order_by="RouteDirection.direction_type.desc()",
    )
    fare_rules = relationship("FareRule", back_populates="route")


class RouteDirection(Base):
    __tablename__ = "route_directions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    route_id = Column(Integer, ForeignKey("routes.id", ondelete="CASCADE"), nullable=False, index=True)
    direction_type = Column(String(20), nullable=False)  # "outbound" or "inbound"
    origin_name = Column(String(150), nullable=False)
    destination_name = Column(String(150), nullable=False)
    origin_lat = Column(Float, nullable=False)
    origin_lng = Column(Float, nullable=False)
    destination_lat = Column(Float, nullable=False)
    destination_lng = Column(Float, nullable=False)
    polyline = Column(Text, nullable=True)  # GeoJSON LineString string
    distance_meters = Column(Integer, default=0, nullable=False)
    duration_seconds = Column(Integer, default=0, nullable=False)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("route_id", "direction_type", name="uq_route_direction_type"),
    )

    # Relationships
    route = relationship("Route", back_populates="directions")
    waypoints = relationship("RouteWaypoint", back_populates="route_direction", cascade="all, delete-orphan", order_by="RouteWaypoint.order")


class RouteWaypoint(Base):
    __tablename__ = "route_waypoints"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    route_direction_id = Column(Integer, ForeignKey("route_directions.id", ondelete="CASCADE"), nullable=False, index=True)
    order = Column(Integer, nullable=False)
    name = Column(String(100), nullable=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    is_stop = Column(Boolean, default=True, nullable=False)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)

    route_direction = relationship("RouteDirection", back_populates="waypoints")


class Parking(Base):
    __tablename__ = "parkings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    uyushma_id = Column(Integer, ForeignKey("uyushmas.id", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(String(150), nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    radius_meters = Column(Integer, default=100, nullable=False)
    capacity = Column(Integer, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(UTCDateTime(), default=_utcnow, nullable=False)
    updated_at = Column(UTCDateTime(), default=_utcnow, onupdate=_utcnow, nullable=False)

    uyushma = relationship("Uyushma", back_populates="parkings")
