from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base


class DriverShift(Base):
    __tablename__ = "driver_shifts"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    driver_id = Column(Integer, ForeignKey("driver_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False, index=True)
    route_id = Column(Integer, ForeignKey("routes.id", ondelete="CASCADE"), nullable=False, index=True)
    direction = Column(String(20), default="outbound", nullable=False)
    status = Column(String(20), default="active", nullable=False, index=True)  # active, completed, cancelled
    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    last_gps_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    driver = relationship("DriverProfile", back_populates="shifts")
    vehicle = relationship("Vehicle", back_populates="shifts")
    route = relationship("Route")
    snapshots = relationship("LocationSnapshot", back_populates="shift", cascade="all, delete-orphan")


class LocationSnapshot(Base):
    __tablename__ = "location_snapshots"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False, index=True)
    shift_id = Column(Integer, ForeignKey("driver_shifts.id", ondelete="SET NULL"), nullable=True, index=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    speed_kmh = Column(Float, default=0.0, nullable=False)
    heading = Column(Float, default=0.0, nullable=False)
    accuracy_meters = Column(Float, default=0.0, nullable=False)
    captured_at = Column(DateTime(timezone=True), nullable=False, index=True)
    received_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    idempotency_key = Column(String(64), unique=True, index=True, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    vehicle = relationship("Vehicle", back_populates="location_snapshots")
    shift = relationship("DriverShift", back_populates="snapshots")


class ClientRouteWatch(Base):
    __tablename__ = "client_route_watches"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    client_session_id = Column(String(64), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    route_id = Column(Integer, ForeignKey("routes.id", ondelete="CASCADE"), nullable=False, index=True)
    direction = Column(String(20), default="outbound", nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    status = Column(String(20), default="active", nullable=False, index=True)  # active, on_car, stopped, expired
    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    last_heartbeat_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class ClientRideState(Base):
    __tablename__ = "client_ride_states"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    client_session_id = Column(String(64), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    route_id = Column(Integer, ForeignKey("routes.id", ondelete="SET NULL"), nullable=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id", ondelete="SET NULL"), nullable=True)
    state = Column(String(20), default="waiting", nullable=False, index=True)  # waiting, on_car, exited
    boarded_at = Column(DateTime(timezone=True), nullable=True)
    exited_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
