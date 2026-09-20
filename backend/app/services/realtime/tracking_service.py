"""
Live vehicle tracking.

- GPS history is persisted in `location_snapshots` (idempotent per client key).
- The latest valid fix per vehicle is kept in memory for fast map/ETA queries and is
  rebuilt from the DB on startup (`rehydrate`), so a restart does not blank the map.
- A vehicle is only shown after its first valid fix (never at 0,0).
- Out-of-order, future-dated or very inaccurate fixes are stored as history but do not
  move the live marker.
"""
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.shift import DriverShift, LocationSnapshot
from app.models.transport import Parking, Route, Vehicle
from app.schemas.driver import (
    GPSBatchSyncRequest,
    GPSBatchSyncResponse,
    GPSPointInput,
    LiveVehicleStateResponse,
)
from app.services.realtime.connection_manager import realtime_manager
from app.services.routing.maptiler_adapter import haversine_distance

logger = logging.getLogger(__name__)

MAX_LIVE_ACCURACY_METERS = 150.0
MAX_FUTURE_SKEW = timedelta(minutes=2)
MAX_PLAUSIBLE_SPEED_KMH = 160.0


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@dataclass
class LiveVehicleState:
    vehicle_id: int
    internal_id: str
    plate_number: Optional[str]
    driver_id: int
    driver_user_id: Optional[int]
    uyushma_id: int
    shift_id: int
    route_id: int
    route_number: str
    direction: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    speed_kmh: float = 0.0
    heading: float = 0.0
    accuracy_meters: float = 0.0
    captured_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    is_stale: bool = False
    parking_id: Optional[int] = None
    parking_name: Optional[str] = None

    @property
    def has_fix(self) -> bool:
        return self.lat is not None and self.lng is not None and self.captured_at is not None

    def to_response(self) -> LiveVehicleStateResponse:
        return LiveVehicleStateResponse(
            vehicle_id=self.internal_id,
            plate_number=self.plate_number,
            route_id=self.route_id,
            route_number=self.route_number,
            direction=self.direction,
            lat=self.lat or 0.0,
            lng=self.lng or 0.0,
            speed_kmh=self.speed_kmh,
            heading=self.heading,
            accuracy_meters=self.accuracy_meters,
            captured_at=self.captured_at or _utcnow(),
            is_stale=self.is_stale,
            parking_id=self.parking_id,
            parking_name=self.parking_name,
        )


@dataclass
class IngestOutcome:
    snapshot: Optional[LocationSnapshot]
    applied_to_live: bool
    duplicate: bool = False
    rejected_reason: Optional[str] = None


PARKING_CACHE_TTL_SECONDS = 30.0


class LiveTrackingService:
    def __init__(self) -> None:
        self._live_vehicles: Dict[int, LiveVehicleState] = {}
        # (loaded_at, [(id, name, lat, lng, radius)]) — refreshed lazily; geofences change rarely
        self._parking_cache: Tuple[float, List[Tuple[int, str, float, float, int]]] = (0.0, [])

    # ------------------------------------------------------------------ queries

    def get_state(self, vehicle_id: int) -> Optional[LiveVehicleState]:
        return self._live_vehicles.get(vehicle_id)

    def iter_states(self) -> List[LiveVehicleState]:
        return list(self._live_vehicles.values())

    def get_live_vehicles(
        self,
        route_id: Optional[int] = None,
        direction: Optional[str] = None,
        include_stale: bool = False,
        uyushma_id: Optional[int] = None,
    ) -> List[LiveVehicleStateResponse]:
        results = []
        for state in self._live_vehicles.values():
            if not state.has_fix:
                continue
            if not include_stale and state.is_stale:
                continue
            if route_id is not None and state.route_id != route_id:
                continue
            if direction is not None and state.direction != direction:
                continue
            if uyushma_id is not None and state.uyushma_id != uyushma_id:
                continue
            results.append(state.to_response())
        return results

    def online_count(self, route_id: int) -> int:
        return sum(1 for s in self._live_vehicles.values() if s.route_id == route_id and s.has_fix and not s.is_stale)

    def get_parking_vehicle_count(self, parking_id: int) -> int:
        return sum(1 for s in self._live_vehicles.values() if s.has_fix and not s.is_stale and s.parking_id == parking_id)

    def get_parking_vehicles(self, parking_id: int) -> List[LiveVehicleStateResponse]:
        return [
            s.to_response()
            for s in self._live_vehicles.values()
            if s.has_fix and not s.is_stale and s.parking_id == parking_id
        ]

    # ------------------------------------------------------------------ lifecycle

    def _new_state(self, shift: DriverShift, vehicle: Vehicle, route: Route) -> LiveVehicleState:
        driver = vehicle.driver
        return LiveVehicleState(
            vehicle_id=vehicle.id,
            internal_id=vehicle.internal_id,
            plate_number=vehicle.plate_number,
            driver_id=shift.driver_id,
            driver_user_id=driver.user_id if driver else None,
            uyushma_id=vehicle.uyushma_id,
            shift_id=shift.id,
            route_id=route.id,
            route_number=route.route_number,
            direction=shift.direction,
        )

    def register_shift_start(self, shift: DriverShift, vehicle: Vehicle, route: Route) -> None:
        """Vehicle becomes 'on shift'; it appears on maps after its first valid GPS fix."""
        self._live_vehicles[vehicle.id] = self._new_state(shift, vehicle, route)

    def register_shift_end(self, vehicle_id: int) -> Optional[LiveVehicleState]:
        return self._live_vehicles.pop(vehicle_id, None)

    def set_direction(self, vehicle_id: int, direction: str) -> None:
        state = self._live_vehicles.get(vehicle_id)
        if state:
            state.direction = direction

    def rehydrate(self, db: Session) -> int:
        """Rebuild in-memory state for active shifts from the latest stored fixes."""
        self._live_vehicles.clear()
        count = 0
        now = _utcnow()
        for shift in db.query(DriverShift).filter(DriverShift.status == "active").all():
            if not shift.vehicle or not shift.route:
                continue
            state = self._new_state(shift, shift.vehicle, shift.route)
            snap = (
                db.query(LocationSnapshot)
                .filter(LocationSnapshot.shift_id == shift.id)
                .order_by(LocationSnapshot.captured_at.desc())
                .first()
            )
            if snap:
                state.lat, state.lng = snap.lat, snap.lng
                state.speed_kmh, state.heading = snap.speed_kmh, snap.heading
                state.accuracy_meters = snap.accuracy_meters
                state.captured_at = _aware(snap.captured_at)
                state.received_at = _aware(snap.received_at)
                state.is_stale = (now - state.captured_at).total_seconds() > settings.gps_stale_threshold_seconds
                state.parking_id, state.parking_name = self._evaluate_parking_geofence(db, snap.lat, snap.lng)
            self._live_vehicles[shift.vehicle_id] = state
            count += 1
        return count

    # ------------------------------------------------------------------ ingest

    def _validate_point(self, point: GPSPointInput, now: datetime) -> Optional[str]:
        captured = _aware(point.captured_at)
        if captured > now + MAX_FUTURE_SKEW:
            return "captured_at_in_future"
        if point.lat == 0.0 and point.lng == 0.0:
            return "null_island"
        return None

    def _persist(self, db: Session, shift: DriverShift, point: GPSPointInput, now: datetime) -> Tuple[Optional[LocationSnapshot], bool]:
        if point.idempotency_key:
            # Scoped to this vehicle: another driver's key must never mask this fix
            existing = (
                db.query(LocationSnapshot)
                .filter(
                    LocationSnapshot.vehicle_id == shift.vehicle_id,
                    LocationSnapshot.idempotency_key == point.idempotency_key,
                )
                .first()
            )
            if existing:
                return existing, True
        snapshot = LocationSnapshot(
            vehicle_id=shift.vehicle_id,
            shift_id=shift.id,
            lat=point.lat,
            lng=point.lng,
            speed_kmh=point.speed_kmh,
            heading=point.heading,
            accuracy_meters=point.accuracy_meters,
            captured_at=_aware(point.captured_at),
            received_at=now,
            idempotency_key=point.idempotency_key,
        )
        db.add(snapshot)
        return snapshot, False

    def _is_newer_and_plausible(self, state: LiveVehicleState, point: GPSPointInput) -> bool:
        captured = _aware(point.captured_at)
        if state.captured_at is not None and captured <= state.captured_at:
            return False  # out of order: history only
        if point.accuracy_meters > MAX_LIVE_ACCURACY_METERS:
            return False
        if state.has_fix and state.captured_at is not None:
            dt = (captured - state.captured_at).total_seconds()
            if dt > 0:
                jump_kmh = haversine_distance(state.lat, state.lng, point.lat, point.lng) / dt * 3.6
                if jump_kmh > MAX_PLAUSIBLE_SPEED_KMH:
                    return False  # GPS spike
        return True

    async def _apply_live(self, db: Session, shift: DriverShift, point: GPSPointInput, now: datetime) -> bool:
        state = self._live_vehicles.get(shift.vehicle_id)
        if state is None or state.shift_id != shift.id:
            state = self._new_state(shift, shift.vehicle, shift.route)
            self._live_vehicles[shift.vehicle_id] = state
        if not self._is_newer_and_plausible(state, point):
            return False

        was_visible = state.has_fix and not state.is_stale
        prev_parking = state.parking_id
        captured = _aware(point.captured_at)

        state.lat, state.lng = point.lat, point.lng
        state.speed_kmh, state.heading = point.speed_kmh, point.heading
        state.accuracy_meters = point.accuracy_meters
        state.captured_at, state.received_at = captured, now
        state.is_stale = (now - captured).total_seconds() > settings.gps_stale_threshold_seconds
        state.direction = shift.direction
        state.parking_id, state.parking_name = self._evaluate_parking_geofence(db, point.lat, point.lng)

        if state.is_stale:
            return True  # replayed offline history: position kept, but not advertised as live

        await realtime_manager.broadcast_vehicle_location({
            "vehicle_id": state.internal_id,
            "plate_number": state.plate_number,
            "route_id": state.route_id,
            "route_number": state.route_number,
            "direction": state.direction,
            "lat": point.lat,
            "lng": point.lng,
            "heading": point.heading,
            "speed_kmh": point.speed_kmh,
            "accuracy_meters": point.accuracy_meters,
            "captured_at": captured.isoformat(),
            "is_stale": False,
            "parking_id": state.parking_id,
            "parking_name": state.parking_name,
        })
        if not was_visible:
            await self.broadcast_route_status(state.route_id, state.route_number)
        if state.parking_id != prev_parking:
            for pid in (state.parking_id, prev_parking):
                if pid is not None:
                    await self.broadcast_parking_count(db, pid)
            if state.driver_user_id is not None:
                await realtime_manager.send_to_driver(state.driver_user_id, "parking.status", {
                    "parking_id": state.parking_id,
                    "parking_name": state.parking_name,
                    "is_inside": state.parking_id is not None,
                })
        return True

    async def ingest_single_gps(self, db: Session, shift: DriverShift, point: GPSPointInput) -> IngestOutcome:
        now = _utcnow()
        reason = self._validate_point(point, now)
        if reason:
            return IngestOutcome(snapshot=None, applied_to_live=False, rejected_reason=reason)
        snapshot, duplicate = self._persist(db, shift, point, now)
        if duplicate:
            return IngestOutcome(snapshot=snapshot, applied_to_live=False, duplicate=True)
        shift.last_gps_at = now
        db.commit()
        applied = await self._apply_live(db, shift, point, now)
        return IngestOutcome(snapshot=snapshot, applied_to_live=applied)

    async def sync_gps_batch(self, db: Session, shift: DriverShift, batch: GPSBatchSyncRequest) -> GPSBatchSyncResponse:
        now = _utcnow()
        processed = duplicate = discarded = 0
        newest: Optional[GPSPointInput] = None

        for pt in sorted(batch.points, key=lambda p: _aware(p.captured_at)):
            if self._validate_point(pt, now):
                discarded += 1
                continue
            _, is_dup = self._persist(db, shift, pt, now)
            if is_dup:
                duplicate += 1
                continue
            processed += 1
            newest = pt

        if processed:
            shift.last_gps_at = now
        db.commit()
        # A closed shift's backlog is history only: it must never move a vehicle on the live map
        if newest is not None and shift.status == "active":
            await self._apply_live(db, shift, newest, now)

        return GPSBatchSyncResponse(
            batch_id=batch.batch_id,
            processed_count=processed,
            duplicate_count=duplicate,
            discarded_count=discarded,
            latest_captured_at=newest.captured_at if newest else None,
            server_time=now,
        )

    # ------------------------------------------------------------------ geofence & broadcasts

    def _active_parkings(self, db: Session) -> List[Tuple[int, str, float, float, int]]:
        loaded_at, cached = self._parking_cache
        now = time.monotonic()
        if cached and now - loaded_at < PARKING_CACHE_TTL_SECONDS:
            return cached
        rows = [
            (p.id, p.name, p.lat, p.lng, p.radius_meters)
            for p in db.query(Parking).filter(Parking.is_active.is_(True)).all()
        ]
        self._parking_cache = (now, rows)
        return rows

    def invalidate_parking_cache(self) -> None:
        """Called when an operator creates, edits or deactivates a stoyanka."""
        self._parking_cache = (0.0, [])

    def _evaluate_parking_geofence(self, db: Session, lat: float, lng: float) -> Tuple[Optional[int], Optional[str]]:
        best: Tuple[Optional[int], Optional[str], float] = (None, None, float("inf"))
        for parking_id, name, p_lat, p_lng, radius in self._active_parkings(db):
            dist = haversine_distance(lat, lng, p_lat, p_lng)
            if dist <= radius and dist < best[2]:
                best = (parking_id, name, dist)
        return best[0], best[1]

    async def broadcast_parking_count(self, db: Session, parking_id: int) -> None:
        parking = db.query(Parking).filter(Parking.id == parking_id).first()
        if not parking:
            return
        vehicles = self.get_parking_vehicles(parking_id)
        await realtime_manager.broadcast_parking_update({
            "parking_id": parking.id,
            "parking_name": parking.name,
            "vehicle_count": len(vehicles),
            "vehicles": [
                {"vehicle_id": v.vehicle_id, "route_number": v.route_number, "captured_at": v.captured_at.isoformat()}
                for v in vehicles
            ],
        })

    async def broadcast_route_status(self, route_id: int, route_number: str) -> None:
        count = self.online_count(route_id)
        await realtime_manager.broadcast_route_status({
            "route_id": route_id,
            "route_number": route_number,
            "online_vehicles_count": count,
            "status": "online" if count > 0 else "no_online_vehicle_visible",
            "has_live_vehicles": count > 0,
        })

    async def check_and_flag_stale_vehicles(self, db: Optional[Session] = None) -> List[int]:
        """
        Flag vehicles whose last fix is older than the stale threshold and notify subscribers.
        Stale vehicles no longer count at a stoyanka, so affected parking counts are re-broadcast.
        """
        now = _utcnow()
        threshold = settings.gps_stale_threshold_seconds
        stale_ids: List[int] = []
        affected: Dict[int, str] = {}
        parkings: set = set()
        for vehicle_id, state in self._live_vehicles.items():
            if not state.has_fix or state.is_stale or state.captured_at is None:
                continue
            if (now - state.captured_at).total_seconds() > threshold:
                state.is_stale = True
                stale_ids.append(vehicle_id)
                affected[state.route_id] = state.route_number
                if state.parking_id is not None:
                    parkings.add(state.parking_id)
        for route_id, route_number in affected.items():
            await self.broadcast_route_status(route_id, route_number)
        if db is not None:
            for parking_id in parkings:
                await self.broadcast_parking_count(db, parking_id)
        return stale_ids

    async def broadcast_current_location(self, vehicle_id: int) -> None:
        """Re-announce a visible vehicle (e.g. after a direction switch) without waiting for its next fix."""
        state = self._live_vehicles.get(vehicle_id)
        if state is None or not state.has_fix or state.is_stale:
            return
        await realtime_manager.broadcast_vehicle_location({
            "vehicle_id": state.internal_id,
            "plate_number": state.plate_number,
            "route_id": state.route_id,
            "route_number": state.route_number,
            "direction": state.direction,
            "lat": state.lat,
            "lng": state.lng,
            "heading": state.heading,
            "speed_kmh": state.speed_kmh,
            "accuracy_meters": state.accuracy_meters,
            "captured_at": state.captured_at.isoformat() if state.captured_at else None,
            "is_stale": False,
            "parking_id": state.parking_id,
            "parking_name": state.parking_name,
        })


tracking_service = LiveTrackingService()
