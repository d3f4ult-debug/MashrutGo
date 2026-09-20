import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set

from fastapi import WebSocket

logger = logging.getLogger(__name__)

EVENT_VERSION = "1.0"


class ConnectionManager:
    """
    WebSocket connection registry and broadcaster.
    Message envelope and event names follow docs/contracts/REALTIME_EVENTS.md.
    """

    def __init__(self) -> None:
        # Public / client sockets -> subscribed route ids (None = all routes)
        self.public_clients: Dict[WebSocket, Optional[Set[int]]] = {}
        # Driver user id -> open sockets (a driver may have several tabs/devices)
        self.driver_sockets: Dict[int, Set[WebSocket]] = {}
        # Driver user id -> route id they currently serve
        self.driver_routes: Dict[int, int] = {}

    @staticmethod
    def envelope(event: str, data: Any) -> str:
        return json.dumps(
            {
                "event": event,
                "data": data,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "version": EVENT_VERSION,
            },
            ensure_ascii=False,
            default=str,
        )

    # ---------------------------------------------------------------- public clients

    async def connect_client(self, websocket: WebSocket, route_ids: Optional[List[int]] = None) -> None:
        await websocket.accept()
        self.public_clients[websocket] = set(route_ids) if route_ids else None

    def disconnect_client(self, websocket: WebSocket) -> None:
        self.public_clients.pop(websocket, None)

    def set_client_routes(self, websocket: WebSocket, route_ids: Optional[Iterable[int]]) -> None:
        if websocket in self.public_clients:
            ids = set(route_ids) if route_ids else None
            self.public_clients[websocket] = ids or None

    async def _send_public(self, event_str: str, route_id: Optional[int]) -> None:
        dead = []
        for ws, filter_routes in list(self.public_clients.items()):
            if filter_routes is not None and (route_id is None or route_id not in filter_routes):
                continue
            try:
                await ws.send_text(event_str)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect_client(ws)

    async def broadcast_vehicle_location(self, data: Dict[str, Any]) -> None:
        await self._send_public(self.envelope("vehicle.location.updated", data), data.get("route_id"))

    async def broadcast_route_status(self, data: Dict[str, Any]) -> None:
        await self._send_public(self.envelope("route.vehicle.status", data), data.get("route_id"))

    async def broadcast_parking_update(self, data: Dict[str, Any]) -> None:
        # Parkings are shared physical places: every subscriber may display them
        event_str = self.envelope("parking.count.updated", data)
        dead = []
        for ws in list(self.public_clients.keys()):
            try:
                await ws.send_text(event_str)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect_client(ws)

    # ---------------------------------------------------------------- drivers

    async def connect_driver(self, websocket: WebSocket, driver_user_id: int, route_id: Optional[int] = None) -> None:
        await websocket.accept()
        self.driver_sockets.setdefault(driver_user_id, set()).add(websocket)
        if route_id is not None:
            self.driver_routes[driver_user_id] = route_id

    def disconnect_driver(self, driver_user_id: int, websocket: Optional[WebSocket] = None) -> None:
        sockets = self.driver_sockets.get(driver_user_id)
        if sockets is None:
            return
        if websocket is not None:
            sockets.discard(websocket)
        else:
            sockets.clear()
        if not sockets:
            self.driver_sockets.pop(driver_user_id, None)
            self.driver_routes.pop(driver_user_id, None)

    def set_driver_route(self, driver_user_id: int, route_id: Optional[int]) -> None:
        if route_id is None:
            self.driver_routes.pop(driver_user_id, None)
        else:
            self.driver_routes[driver_user_id] = route_id

    async def _send_to_sockets(self, driver_user_id: int, event_str: str) -> None:
        for ws in list(self.driver_sockets.get(driver_user_id, ())):
            try:
                await ws.send_text(event_str)
            except Exception:
                self.disconnect_driver(driver_user_id, ws)

    async def send_to_driver(self, driver_user_id: int, event: str, data: Dict[str, Any]) -> None:
        await self._send_to_sockets(driver_user_id, self.envelope(event, data))

    async def broadcast_to_route_drivers(self, route_id: int, event: str, data: Dict[str, Any]) -> None:
        """Send to every connected driver currently serving `route_id`."""
        event_str = self.envelope(event, data)
        for driver_user_id, r_id in list(self.driver_routes.items()):
            if r_id == route_id:
                await self._send_to_sockets(driver_user_id, event_str)


realtime_manager = ConnectionManager()
