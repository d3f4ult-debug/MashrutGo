import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.models.shift import ClientRideState, ClientRouteWatch
from app.models.transport import Route
from app.services.realtime.connection_manager import realtime_manager

logger = logging.getLogger(__name__)

CLIENT_WATCH_EXPIRY_SECONDS = 60  # 60s without heartbeat marks watch expired


class ClientWatchService:
    """
    Manages anonymous and authenticated passenger route watch sessions,
    heartbeats, ride state transitions (waiting -> on_car -> exited),
    and driver nearby broadcasts.
    """

    def __init__(self):
        # In-memory active watches: watch_id -> dict
        self._active_watches: Dict[int, Dict[str, Any]] = {}

    async def start_watch(
        self,
        route_id: int,
        direction: str,
        lat: float,
        lng: float,
        accuracy_meters: float,
        session_id: Optional[str],
        user_id: Optional[int],
        db: Session,
    ) -> ClientRouteWatch:
        """
        Start watching a route/direction. Persists watch and initial waiting ride state,
        and broadcasts client.nearby.broadcast to active drivers on the route.
        """
        route = db.query(Route).filter(Route.id == route_id).first()
        if not route:
            raise ValueError(f"Route with id {route_id} not found")

        client_session = session_id or uuid.uuid4().hex
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=CLIENT_WATCH_EXPIRY_SECONDS)

        # 1. Create DB Watch Record
        watch = ClientRouteWatch(
            client_session_id=client_session,
            user_id=user_id,
            route_id=route_id,
            direction=direction,
            lat=lat,
            lng=lng,
            status="active",
            started_at=now,
            last_heartbeat_at=now,
            expires_at=expires_at,
        )
        db.add(watch)
        db.commit()
        db.refresh(watch)

        # 2. Create Initial Waiting Ride State
        ride_state = ClientRideState(
            client_session_id=client_session,
            user_id=user_id,
            route_id=route_id,
            state="waiting",
            created_at=now,
        )
        db.add(ride_state)
        db.commit()

        # 3. Store in Memory Cache
        self._active_watches[watch.id] = {
            "watch_id": watch.id,
            "session_id": client_session,
            "route_id": route_id,
            "direction": direction,
            "lat": lat,
            "lng": lng,
            "waiting_since": now.isoformat(),
            "expires_at": expires_at,
        }

        # 4. Broadcast to Route Drivers via WebSocket
        broadcast_payload = {
            "watch_id": str(watch.id),
            "route_id": route_id,
            "direction": direction,
            "client_lat": lat,
            "client_lng": lng,
            "waiting_since": now.isoformat(),
            "action": "active",
        }
        await realtime_manager.broadcast_to_route_drivers(
            route_id=route_id,
            event="client.nearby.broadcast",
            data=broadcast_payload,
        )

        return watch

    async def heartbeat(
        self,
        watch_id: int,
        lat: Optional[float],
        lng: Optional[float],
        db: Session,
    ) -> Optional[ClientRouteWatch]:
        """
        Extend watch session lifetime and optionally update passenger coordinates.
        """
        watch = db.query(ClientRouteWatch).filter(ClientRouteWatch.id == watch_id).first()
        if not watch or watch.status != "active":
            return None

        now = datetime.now(timezone.utc)
        watch.last_heartbeat_at = now
        watch.expires_at = now + timedelta(seconds=CLIENT_WATCH_EXPIRY_SECONDS)

        if lat is not None and lng is not None:
            watch.lat = lat
            watch.lng = lng

        db.commit()
        db.refresh(watch)

        if watch_id in self._active_watches:
            self._active_watches[watch_id]["expires_at"] = watch.expires_at
            if lat is not None and lng is not None:
                self._active_watches[watch_id]["lat"] = lat
                self._active_watches[watch_id]["lng"] = lng

        return watch

    async def update_ride_state(
        self,
        watch_id: int,
        state: str,
        vehicle_id: Optional[int],
        db: Session,
    ) -> Dict[str, Any]:
        """
        Handle passenger state transitions:
        - 'on_car' (Mashinadaman): immediately STOP broadcast to drivers (client.nearby.removed)
        - 'exited' (Tushdim): complete ride state
        - 'stopped': cancel watch
        """
        watch = db.query(ClientRouteWatch).filter(ClientRouteWatch.id == watch_id).first()
        if not watch:
            raise ValueError(f"Watch session {watch_id} not found")

        now = datetime.now(timezone.utc)

        # Query latest ride state for this session
        ride_state = (
            db.query(ClientRideState)
            .filter(ClientRideState.client_session_id == watch.client_session_id)
            .order_by(ClientRideState.id.desc())
            .first()
        )

        if state == "on_car":
            watch.status = "on_car"
            if ride_state:
                ride_state.state = "on_car"
                ride_state.boarded_at = now
                if vehicle_id:
                    ride_state.vehicle_id = vehicle_id

            # Remove from in-memory active watches
            if watch_id in self._active_watches:
                del self._active_watches[watch_id]

            # IMMEDIATE REVOCATION OF BROADCAST TO DRIVERS (Privacy & Clean Map)
            remove_payload = {
                "watch_id": str(watch.id),
                "reason": "on_car",
            }
            await realtime_manager.broadcast_to_route_drivers(
                route_id=watch.route_id,
                event="client.nearby.removed",
                data=remove_payload,
            )

        elif state == "exited":
            watch.status = "stopped"
            if ride_state:
                ride_state.state = "exited"
                ride_state.exited_at = now

            if watch_id in self._active_watches:
                del self._active_watches[watch_id]

            remove_payload = {
                "watch_id": str(watch.id),
                "reason": "exited",
            }
            await realtime_manager.broadcast_to_route_drivers(
                route_id=watch.route_id,
                event="client.nearby.removed",
                data=remove_payload,
            )

        elif state == "stopped":
            watch.status = "stopped"
            if watch_id in self._active_watches:
                del self._active_watches[watch_id]

            remove_payload = {
                "watch_id": str(watch.id),
                "reason": "cancelled",
            }
            await realtime_manager.broadcast_to_route_drivers(
                route_id=watch.route_id,
                event="client.nearby.removed",
                data=remove_payload,
            )

        db.commit()
        db.refresh(watch)
        if ride_state:
            db.refresh(ride_state)

        return {
            "watch_id": watch.id,
            "status": watch.status,
            "ride_state": ride_state.state if ride_state else None,
            "boarded_at": ride_state.boarded_at if ride_state else None,
            "exited_at": ride_state.exited_at if ride_state else None,
        }

    async def sweep_expired_watches(self, db: Session) -> List[int]:
        """
        Scan and mark abandoned watches as expired. Notifies drivers with reason 'expired'.
        """
        now = datetime.now(timezone.utc)
        expired_db = (
            db.query(ClientRouteWatch)
            .filter(
                ClientRouteWatch.status == "active",
                ClientRouteWatch.expires_at < now,
            )
            .all()
        )

        expired_ids = []
        for w in expired_db:
            w.status = "expired"
            expired_ids.append(w.id)
            if w.id in self._active_watches:
                del self._active_watches[w.id]

            remove_payload = {
                "watch_id": str(w.id),
                "reason": "expired",
            }
            await realtime_manager.broadcast_to_route_drivers(
                route_id=w.route_id,
                event="client.nearby.removed",
                data=remove_payload,
            )

        if expired_ids:
            db.commit()

        return expired_ids

    def get_waiting_passengers(
        self,
        route_id: int,
        direction: Optional[str],
        db: Session,
    ) -> List[Dict[str, Any]]:
        """
        Query current active waiting passenger pins for drivers on a route.
        """
        now = datetime.now(timezone.utc)
        query = db.query(ClientRouteWatch).filter(
            ClientRouteWatch.route_id == route_id,
            ClientRouteWatch.status == "active",
            ClientRouteWatch.expires_at >= now,
        )
        if direction:
            query = query.filter(ClientRouteWatch.direction == direction)

        results = []
        for w in query.all():
            results.append({
                "watch_id": w.id,
                "route_id": w.route_id,
                "direction": w.direction,
                "client_lat": w.lat,
                "client_lng": w.lng,
                "waiting_since": w.started_at,
                "action": "active",
            })
        return results


# Global singleton
client_watch_service = ClientWatchService()
