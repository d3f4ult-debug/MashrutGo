"""
Client route watch ("Kutayapman") and ride state ("Mashinadaman" / "Tushdim").

Privacy rules:
- A client's exact GPS is sent ONLY to drivers currently serving the watched route, and only
  while the watch is `active`. `on_car`, `stopped` and `expired` immediately broadcast a removal.
- Every mutation requires the watch's session secret (`client_session_id`), which is returned
  only to the client that created the watch. Watch ids alone are not sufficient.
- Abandoned watches expire after the heartbeat timeout (background sweeper).
"""
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.shift import ClientRideState, ClientRouteWatch
from app.models.transport import Route, RouteDirection
from app.services.realtime.connection_manager import realtime_manager
from app.services.routing.eta_service import (
    extract_direction_polyline_coordinates,
    project_point_onto_polyline,
)

logger = logging.getLogger(__name__)

MIN_SESSION_ID_LENGTH = 16
ON_CAR_AUTO_EXIT_AFTER = timedelta(hours=4)
# A passenger waiting for a line stands on it, give or take a walk to the stop and a poor GPS fix.
# Anything further is not a passenger: without this check any coordinate on earth could be pushed
# onto every driver's map as a waiting-passenger pin.
MAX_DISTANCE_FROM_ROUTE_METERS = 2000.0


class WatchError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _expiry(now: datetime) -> datetime:
    return now + timedelta(seconds=settings.client_watch_heartbeat_timeout_seconds)


def _broadcast_payload(watch: ClientRouteWatch, action: str) -> Dict[str, Any]:
    return {
        "watch_id": str(watch.id),
        "route_id": watch.route_id,
        "direction": watch.direction,
        "client_lat": watch.lat,
        "client_lng": watch.lng,
        "waiting_since": watch.started_at.isoformat() if watch.started_at else None,
        "action": action,
    }


class ClientWatchService:
    @staticmethod
    def _assert_point_on_route(db: Session, route_id: int, direction: str, lat: float, lng: float) -> None:
        """Reject waiting points that are nowhere near the line the passenger claims to be waiting for."""
        row = (
            db.query(RouteDirection)
            .filter(RouteDirection.route_id == route_id, RouteDirection.direction_type == direction)
            .first()
        )
        if row is None:
            return  # No geometry to check against; the route itself is validated by the caller.
        polyline = extract_direction_polyline_coordinates(row)
        if len(polyline) < 2:
            return
        _, perpendicular_m, _, _ = project_point_onto_polyline(lat, lng, polyline)
        if perpendicular_m > MAX_DISTANCE_FROM_ROUTE_METERS:
            raise WatchError("Kutish nuqtasi bu yo'nalishdan juda uzoq", 422)

    def _latest_ride_state(self, db: Session, watch: ClientRouteWatch) -> Optional[ClientRideState]:
        return (
            db.query(ClientRideState)
            .filter(ClientRideState.client_session_id == watch.client_session_id)
            .order_by(ClientRideState.id.desc())
            .first()
        )

    def get_owned_watch(self, db: Session, watch_id: int, session_id: Optional[str]) -> ClientRouteWatch:
        watch = db.query(ClientRouteWatch).filter(ClientRouteWatch.id == watch_id).first()
        if not watch or not session_id or not secrets.compare_digest(watch.client_session_id, session_id):
            # Same response for "missing" and "not yours" to avoid watch-id probing
            raise WatchError("Watch session not found", 404)
        return watch

    async def _remove_from_drivers(self, watch: ClientRouteWatch, reason: str) -> None:
        await realtime_manager.broadcast_to_route_drivers(
            route_id=watch.route_id,
            event="client.nearby.removed",
            data={"watch_id": str(watch.id), "reason": reason},
        )

    async def start_watch(
        self,
        route_id: int,
        direction: str,
        lat: float,
        lng: float,
        accuracy_meters: Optional[float],
        session_id: Optional[str],
        user_id: Optional[int],
        db: Session,
    ) -> ClientRouteWatch:
        route = db.query(Route).filter(Route.id == route_id).first()
        if not route or not route.is_published or route.is_archived:
            raise WatchError(f"Route with id {route_id} not found", 404)
        if direction not in ("outbound", "inbound"):
            raise WatchError("direction must be 'outbound' or 'inbound'", 422)
        if session_id is not None and len(session_id) < MIN_SESSION_ID_LENGTH:
            raise WatchError(f"session_id must be at least {MIN_SESSION_ID_LENGTH} characters", 422)
        self._assert_point_on_route(db, route_id, direction, lat, lng)
        client_session = session_id or secrets.token_urlsafe(24)
        now = _utcnow()

        # One active watch per session: close any previous one first
        previous = (
            db.query(ClientRouteWatch)
            .filter(ClientRouteWatch.client_session_id == client_session, ClientRouteWatch.status == "active")
            .all()
        )
        for old in previous:
            old.status = "stopped"
        db.flush()

        watch = ClientRouteWatch(
            client_session_id=client_session,
            user_id=user_id,
            route_id=route_id,
            direction=direction,
            lat=lat,
            lng=lng,
            accuracy_meters=accuracy_meters,
            status="active",
            started_at=now,
            last_heartbeat_at=now,
            expires_at=_expiry(now),
        )
        db.add(watch)
        db.add(ClientRideState(client_session_id=client_session, user_id=user_id, route_id=route_id, state="waiting", created_at=now))
        db.commit()
        db.refresh(watch)

        for old in previous:
            await self._remove_from_drivers(old, "replaced")
        await realtime_manager.broadcast_to_route_drivers(
            route_id=route_id, event="client.nearby.broadcast", data=_broadcast_payload(watch, "active")
        )
        return watch

    async def heartbeat(
        self,
        watch_id: int,
        session_id: Optional[str],
        lat: Optional[float],
        lng: Optional[float],
        db: Session,
    ) -> ClientRouteWatch:
        watch = self.get_owned_watch(db, watch_id, session_id)
        if watch.status != "active":
            raise WatchError("Watch session is no longer active", 409)
        now = _utcnow()
        watch.last_heartbeat_at = now
        watch.expires_at = _expiry(now)
        moved = lat is not None and lng is not None and (lat != watch.lat or lng != watch.lng)
        if lat is not None and lng is not None:
            # A heartbeat may move the pin, so it is checked exactly like the initial position.
            self._assert_point_on_route(db, watch.route_id, watch.direction, lat, lng)
            watch.lat, watch.lng = lat, lng
        db.commit()
        db.refresh(watch)
        if moved:
            await realtime_manager.broadcast_to_route_drivers(
                route_id=watch.route_id, event="client.nearby.broadcast", data=_broadcast_payload(watch, "updated")
            )
        return watch

    async def update_ride_state(
        self,
        watch_id: int,
        session_id: Optional[str],
        state: str,
        db: Session,
        vehicle_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        watch = self.get_owned_watch(db, watch_id, session_id)
        ride = self._latest_ride_state(db, watch)
        now = _utcnow()

        if state == "on_car":
            if watch.status != "active":
                raise WatchError("Only an active watch can switch to 'on_car'", 409)
            watch.status = "on_car"
            if ride:
                ride.state = "on_car"
                ride.boarded_at = now
                if vehicle_id:
                    ride.vehicle_id = vehicle_id
            reason = "on_car"
        elif state == "exited":
            if watch.status not in ("active", "on_car"):
                raise WatchError("Ride is already finished", 409)
            watch.status = "stopped"
            if ride:
                ride.state = "exited"
                ride.exited_at = now
            reason = "exited"
        elif state == "stopped":
            if watch.status != "active":
                raise WatchError("Watch is not active", 409)
            watch.status = "stopped"
            if ride:
                ride.state = "cancelled"
                ride.exited_at = now
            reason = "cancelled"
        else:
            raise WatchError("state must be 'on_car', 'exited' or 'stopped'", 422)

        db.commit()
        db.refresh(watch)
        if ride:
            db.refresh(ride)
        # Exact GPS stops flowing to drivers immediately
        await self._remove_from_drivers(watch, reason)
        return {
            "watch_id": watch.id,
            "status": watch.status,
            "ride_state": ride.state if ride else None,
            "boarded_at": ride.boarded_at.isoformat() if ride and ride.boarded_at else None,
            "exited_at": ride.exited_at.isoformat() if ride and ride.exited_at else None,
        }

    async def sweep_expired_watches(self, db: Session) -> List[int]:
        now = _utcnow()
        expired = (
            db.query(ClientRouteWatch)
            .filter(ClientRouteWatch.status == "active", ClientRouteWatch.expires_at < now)
            .all()
        )
        for watch in expired:
            watch.status = "expired"
            ride = self._latest_ride_state(db, watch)
            if ride and ride.state == "waiting":
                ride.state = "expired"
        # Rides where the passenger forgot to press "Tushdim"
        stale_rides = (
            db.query(ClientRideState)
            .filter(ClientRideState.state == "on_car", ClientRideState.boarded_at < now - ON_CAR_AUTO_EXIT_AFTER)
            .all()
        )
        for ride in stale_rides:
            ride.state = "exited"
            ride.exited_at = now
            for watch in (
                db.query(ClientRouteWatch)
                .filter(ClientRouteWatch.client_session_id == ride.client_session_id, ClientRouteWatch.status == "on_car")
                .all()
            ):
                watch.status = "stopped"
        if expired or stale_rides:
            db.commit()
        for watch in expired:
            await self._remove_from_drivers(watch, "expired")
        return [w.id for w in expired]

    def get_waiting_passengers(self, route_id: int, direction: Optional[str], db: Session) -> List[Dict[str, Any]]:
        now = _utcnow()
        query = db.query(ClientRouteWatch).filter(
            ClientRouteWatch.route_id == route_id,
            ClientRouteWatch.status == "active",
            ClientRouteWatch.expires_at >= now,
        )
        if direction:
            query = query.filter(ClientRouteWatch.direction == direction)
        return [
            {
                "watch_id": w.id,
                "route_id": w.route_id,
                "direction": w.direction,
                "client_lat": w.lat,
                "client_lng": w.lng,
                "waiting_since": w.started_at,
                "action": "active",
            }
            for w in query.all()
        ]


client_watch_service = ClientWatchService()
