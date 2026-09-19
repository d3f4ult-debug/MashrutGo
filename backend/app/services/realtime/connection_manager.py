import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Thread-safe WebSocket connection and event broadcasting manager.
    Adheres strictly to the message envelope defined in docs/contracts/REALTIME_EVENTS.md.
    """

    def __init__(self):
        # Public / Client WebSockets: websocket -> set of route_ids (or empty for all)
        self.public_clients: Dict[WebSocket, Optional[Set[int]]] = {}
        # Driver WebSockets: driver_id -> websocket
        self.driver_sockets: Dict[int, WebSocket] = {}
        # Driver route mapping: driver_id -> route_id
        self.driver_routes: Dict[int, int] = {}

    def _create_envelope(self, event: str, data: Any) -> str:
        payload = {
            "event": event,
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": "1.0",
        }
        return json.dumps(payload)

    async def connect_client(self, websocket: WebSocket, route_ids: Optional[List[int]] = None) -> None:
        await websocket.accept()
        routes_set = set(route_ids) if route_ids else None
        self.public_clients[websocket] = routes_set

    def disconnect_client(self, websocket: WebSocket) -> None:
        if websocket in self.public_clients:
            del self.public_clients[websocket]

    async def connect_driver(self, websocket: WebSocket, driver_id: int, route_id: Optional[int] = None) -> None:
        await websocket.accept()
        self.driver_sockets[driver_id] = websocket
        if route_id is not None:
            self.driver_routes[driver_id] = route_id

    def disconnect_driver(self, driver_id: int) -> None:
        if driver_id in self.driver_sockets:
            del self.driver_sockets[driver_id]
        if driver_id in self.driver_routes:
            del self.driver_routes[driver_id]

    async def broadcast_vehicle_location(self, data: Dict[str, Any]) -> None:
        """Broadcast vehicle.location.updated to clients filtering for this route."""
        event_str = self._create_envelope("vehicle.location.updated", data)
        target_route_id = data.get("route_id")

        dead_connections = []
        for ws, filter_routes in list(self.public_clients.items()):
            if filter_routes is None or (target_route_id and target_route_id in filter_routes):
                try:
                    await ws.send_text(event_str)
                except Exception:
                    dead_connections.append(ws)

        for ws in dead_connections:
            self.disconnect_client(ws)

    async def broadcast_route_status(self, data: Dict[str, Any]) -> None:
        """Broadcast route.vehicle.status when vehicles go online/offline."""
        event_str = self._create_envelope("route.vehicle.status", data)
        dead_connections = []
        for ws in list(self.public_clients.keys()):
            try:
                await ws.send_text(event_str)
            except Exception:
                dead_connections.append(ws)

        for ws in dead_connections:
            self.disconnect_client(ws)

    async def broadcast_parking_update(self, data: Dict[str, Any]) -> None:
        """Broadcast parking.count.updated to all clients."""
        event_str = self._create_envelope("parking.count.updated", data)
        dead_connections = []
        for ws in list(self.public_clients.keys()):
            try:
                await ws.send_text(event_str)
            except Exception:
                dead_connections.append(ws)

        for ws in dead_connections:
            self.disconnect_client(ws)

    async def send_to_driver(self, driver_id: int, event: str, data: Dict[str, Any]) -> None:
        """Send message directly to a specific driver's active WebSocket connection."""
        ws = self.driver_sockets.get(driver_id)
        if ws:
            event_str = self._create_envelope(event, data)
            try:
                await ws.send_text(event_str)
            except Exception:
                self.disconnect_driver(driver_id)

    async def broadcast_to_route_drivers(self, route_id: int, event: str, data: Dict[str, Any]) -> None:
        """Broadcast to all active drivers assigned to a specific route."""
        event_str = self._create_envelope(event, data)
        for d_id, r_id in list(self.driver_routes.items()):
            if r_id == route_id:
                ws = self.driver_sockets.get(d_id)
                if ws:
                    try:
                        await ws.send_text(event_str)
                    except Exception:
                        self.disconnect_driver(d_id)


# Global singleton connection manager
realtime_manager = ConnectionManager()
