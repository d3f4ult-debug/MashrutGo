import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
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


@dataclass
class LiveVehicleState:
    vehicle_id: int
    internal_id: str
    driver_id: int
    route_id: int
    route_number: str
    direction: str
    lat: float
    lng: float
    speed_kmh: float
    heading: float
    accuracy_meters: float
    captured_at: datetime
    received_at: datetime
    is_stale: bool = False
    parking_id: Optional[int] = None
    parking_name: Optional[str] = None


class LiveTrackingService:
    """
    In-memory live vehicle tracking, GPS validation, offline batch sync,
    stale vehicle timeout, and Stayanka (parking) geofence management.
    """

    def __init__(self):
        # vehicle_id -> LiveVehicleState
        self._live_vehicles: Dict[int, LiveVehicleState] = {}

    def get_live_vehicles(
        self,
        route_id: Optional[int] = None,
        direction: Optional[str] = None,
        include_stale: bool = False,
    ) -> List[LiveVehicleStateResponse]:
        """Query live vehicles from in-memory cache with optional filters."""
        results = []
        for state in self._live_vehicles.values():
            if not include_stale and state.is_stale:
                continue
            if route_id is not None and state.route_id != route_id:
                continue
            if direction is not None and state.direction != direction:
                continue

            results.append(
                LiveVehicleStateResponse(
                    vehicle_id=state.internal_id,
                    route_id=state.route_id,
                    route_number=state.route_number,
                    direction=state.direction,
                    lat=state.lat,
                    lng=state.lng,
                    speed_kmh=state.speed_kmh,
                    heading=state.heading,
                    accuracy_meters=state.accuracy_meters,
                    captured_at=state.captured_at,
                    is_stale=state.is_stale,
                    parking_id=state.parking_id,
                    parking_name=state.parking_name,
                )
            )
        return results

    def register_shift_start(self, shift: DriverShift, vehicle: Vehicle, route: Route) -> None:
        """Initialize vehicle in live state when shift begins."""
        now = datetime.now(timezone.utc)
        self._live_vehicles[vehicle.id] = LiveVehicleState(
            vehicle_id=vehicle.id,
            internal_id=vehicle.internal_id,
            driver_id=shift.driver_id,
            route_id=route.id,
            route_number=route.route_number,
            direction=shift.direction,
            lat=0.0,
            lng=0.0,
            speed_kmh=0.0,
            heading=0.0,
            accuracy_meters=0.0,
            captured_at=now,
            received_at=now,
            is_stale=False,
        )

    def register_shift_end(self, vehicle_id: int) -> None:
        """Remove vehicle from live tracking when shift ends."""
        if vehicle_id in self._live_vehicles:
            del self._live_vehicles[vehicle_id]

    async def ingest_single_gps(
        self,
        db: Session,
        shift: DriverShift,
        point: GPSPointInput,
    ) -> Optional[LocationSnapshot]:
        """Validate, store snapshot, update live state, check parking, and broadcast."""
        # 1. Geographic bounds check
        if not (-90.0 <= point.lat <= 90.0) or not (-180.0 <= point.lng <= 180.0):
            return None

        # 2. Idempotency check if key provided
        if point.idempotency_key:
            existing = (
                db.query(LocationSnapshot)
                .filter(LocationSnapshot.idempotency_key == point.idempotency_key)
                .first()
            )
            if existing:
                return existing

        now = datetime.now(timezone.utc)
        # 3. Create persistent snapshot
        snapshot = LocationSnapshot(
            vehicle_id=shift.vehicle_id,
            shift_id=shift.id,
            lat=point.lat,
            lng=point.lng,
            speed_kmh=point.speed_kmh,
            heading=point.heading,
            accuracy_meters=point.accuracy_meters,
            captured_at=point.captured_at,
            received_at=now,
            idempotency_key=point.idempotency_key,
        )
        db.add(snapshot)
        shift.last_gps_at = now
        db.commit()
        db.refresh(snapshot)

        # 4. Check & update in-memory live tracking state
        vehicle = shift.vehicle
        route = shift.route
        current_state = self._live_vehicles.get(vehicle.id)

        # Out-of-order check: only update live state if point is newer
        point_dt = point.captured_at
        if point_dt.tzinfo is None:
            point_dt = point_dt.replace(tzinfo=timezone.utc)

        if current_state:
            curr_dt = current_state.captured_at
            if curr_dt.tzinfo is None:
                curr_dt = curr_dt.replace(tzinfo=timezone.utc)
            if point_dt < curr_dt:
                # Older queued point received out-of-order; keep latest in cache
                return snapshot

        # 5. Parking Geofence evaluation
        parking_id, parking_name = self._evaluate_parking_geofence(db, point.lat, point.lng)
        prev_parking_id = current_state.parking_id if current_state else None

        self._live_vehicles[vehicle.id] = LiveVehicleState(
            vehicle_id=vehicle.id,
            internal_id=vehicle.internal_id,
            driver_id=shift.driver_id,
            route_id=route.id,
            route_number=route.route_number,
            direction=shift.direction,
            lat=point.lat,
            lng=point.lng,
            speed_kmh=point.speed_kmh,
            heading=point.heading,
            accuracy_meters=point.accuracy_meters,
            captured_at=point_dt,
            received_at=now,
            is_stale=False,
            parking_id=parking_id,
            parking_name=parking_name,
        )

        # 6. Realtime broadcasts
        # Vehicle location broadcast
        await realtime_manager.broadcast_vehicle_location({
            "vehicle_id": vehicle.internal_id,
            "route_id": route.id,
            "route_number": route.route_number,
            "direction": shift.direction,
            "lat": point.lat,
            "lng": point.lng,
            "heading": point.heading,
            "speed_kmh": point.speed_kmh,
            "accuracy_meters": point.accuracy_meters,
            "captured_at": point_dt.isoformat(),
            "is_stale": False,
        })

        # Parking count change broadcast
        if parking_id != prev_parking_id:
            if parking_id is not None:
                await self._broadcast_parking_count(db, parking_id)
            if prev_parking_id is not None:
                await self._broadcast_parking_count(db, prev_parking_id)

        return snapshot

    async def sync_gps_batch(
        self,
        db: Session,
        shift: DriverShift,
        batch: GPSBatchSyncRequest,
    ) -> GPSBatchSyncResponse:
        """Process an offline queued batch of GPS fixes with deduplication."""
        processed = 0
        duplicate = 0
        discarded = 0
        latest_point = None

        # Sort chronological
        sorted_points = sorted(batch.points, key=lambda p: p.captured_at)

        for pt in sorted_points:
            # Bounds check
            if not (-90.0 <= pt.lat <= 90.0) or not (-180.0 <= pt.lng <= 180.0):
                discarded += 1
                continue

            # Idempotency check
            if pt.idempotency_key:
                existing = (
                    db.query(LocationSnapshot)
                    .filter(LocationSnapshot.idempotency_key == pt.idempotency_key)
                    .first()
                )
                if existing:
                    duplicate += 1
                    continue

            # Ingest to DB
            snapshot = LocationSnapshot(
                vehicle_id=shift.vehicle_id,
                shift_id=shift.id,
                lat=pt.lat,
                lng=pt.lng,
                speed_kmh=pt.speed_kmh,
                heading=pt.heading,
                accuracy_meters=pt.accuracy_meters,
                captured_at=pt.captured_at,
                received_at=datetime.now(timezone.utc),
                idempotency_key=pt.idempotency_key,
            )
            db.add(snapshot)
            processed += 1
            latest_point = pt

        if processed > 0:
            shift.last_gps_at = datetime.now(timezone.utc)
            db.commit()

            # Update live state with the latest valid point from the batch
            if latest_point:
                await self.ingest_single_gps(db, shift, latest_point)

        return GPSBatchSyncResponse(
            batch_id=batch.batch_id,
            processed_count=processed,
            duplicate_count=duplicate,
            discarded_count=discarded,
            latest_captured_at=latest_point.captured_at if latest_point else None,
        )

    def _evaluate_parking_geofence(self, db: Session, lat: float, lng: float) -> Tuple[Optional[int], Optional[str]]:
        """Check if coordinates fall within any active Parking radius."""
        parkings = db.query(Parking).filter(Parking.is_active.is_(True)).all()
        for p in parkings:
            dist = haversine_distance(lat, lng, p.lat, p.lng)
            if dist <= p.radius_meters:
                return p.id, p.name
        return None, None

    def get_parking_vehicle_count(self, parking_id: int) -> int:
        """Count how many active vehicles are currently in the given parking geofence."""
        count = 0
        for state in self._live_vehicles.values():
            if not state.is_stale and state.parking_id == parking_id:
                count += 1
        return count

    def get_parking_vehicles(self, parking_id: int) -> List[LiveVehicleStateResponse]:
        """Return list of vehicles currently parked inside given parking."""
        return [
            LiveVehicleStateResponse(
                vehicle_id=s.internal_id,
                route_id=s.route_id,
                route_number=s.route_number,
                direction=s.direction,
                lat=s.lat,
                lng=s.lng,
                speed_kmh=s.speed_kmh,
                heading=s.heading,
                accuracy_meters=s.accuracy_meters,
                captured_at=s.captured_at,
                is_stale=s.is_stale,
                parking_id=s.parking_id,
                parking_name=s.parking_name,
            )
            for s in self._live_vehicles.values()
            if not s.is_stale and s.parking_id == parking_id
        ]

    async def _broadcast_parking_count(self, db: Session, parking_id: int) -> None:
        """Helper to broadcast updated parking vehicle count."""
        parking = db.query(Parking).filter(Parking.id == parking_id).first()
        if not parking:
            return
        count = self.get_parking_vehicle_count(parking_id)
        vehicles = self.get_parking_vehicles(parking_id)

        await realtime_manager.broadcast_parking_update({
            "parking_id": parking.id,
            "parking_name": parking.name,
            "vehicle_count": count,
            "vehicles": [
                {
                    "vehicle_id": v.vehicle_id,
                    "route_number": v.route_number,
                    "captured_at": v.captured_at.isoformat(),
                }
                for v in vehicles
            ],
        })

    async def check_and_flag_stale_vehicles(self) -> List[int]:
        """
        Identify vehicles that haven't sent a GPS ping within stale threshold,
        flag them as is_stale = True, and broadcast route status.
        """
        now = datetime.now(timezone.utc)
        threshold = settings.gps_stale_threshold_seconds
        stale_vehicle_ids = []

        affected_routes = set()

        for v_id, state in list(self._live_vehicles.items()):
            state_dt = state.captured_at
            if state_dt.tzinfo is None:
                state_dt = state_dt.replace(tzinfo=timezone.utc)

            elapsed = (now - state_dt).total_seconds()
            if elapsed > threshold and not state.is_stale:
                state.is_stale = True
                stale_vehicle_ids.append(v_id)
                affected_routes.add((state.route_id, state.route_number))

        # Broadcast route.vehicle.status for affected routes
        for r_id, r_num in affected_routes:
            active_count = sum(
                1 for s in self._live_vehicles.values()
                if s.route_id == r_id and not s.is_stale
            )
            await realtime_manager.broadcast_route_status({
                "route_id": r_id,
                "route_number": r_num,
                "online_vehicles_count": active_count,
                "status": "online" if active_count > 0 else "no_online_vehicle_visible",
                "has_live_vehicles": active_count > 0,
            })

        return stale_vehicle_ids


# Global singleton tracking service
tracking_service = LiveTrackingService()
