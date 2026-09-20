import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.core.roles import UserRole
from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.models.shift import DriverShift
from app.models.user import DriverProfile, User
from app.services.realtime.client_watch_service import WatchError, client_watch_service
from app.services.realtime.connection_manager import realtime_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ws", tags=["realtime"])

MAX_MESSAGE_BYTES = 8 * 1024


def _parse_routes(raw: Optional[str]) -> Optional[List[int]]:
    if not raw:
        return None
    try:
        ids = [int(r.strip()) for r in raw.split(",") if r.strip()]
    except ValueError:
        return None
    return ids[:50] or None


async def _send(websocket: WebSocket, event: str, data: Dict[str, Any]) -> None:
    await websocket.send_text(realtime_manager.envelope(event, data))


async def _handle_client_event(websocket: WebSocket, event: str, data: Dict[str, Any], default_session: Optional[str]) -> None:
    if event == "subscribe":
        routes = data.get("routes")
        ids = [int(r) for r in routes][:50] if isinstance(routes, list) else None
        realtime_manager.set_client_routes(websocket, ids)
        await _send(websocket, "subscribed", {"routes": ids})
        return

    session_id = data.get("session_id") or default_session
    db = SessionLocal()
    try:
        if event == "client.watch.start":
            watch = await client_watch_service.start_watch(
                route_id=int(data.get("route_id")), direction=data.get("direction", "outbound"),
                lat=float(data["lat"]), lng=float(data["lng"]), accuracy_meters=data.get("accuracy_meters"),
                session_id=session_id, user_id=None, db=db,
            )
            await _send(websocket, "client.watch.started", {
                "watch_id": watch.id, "session_id": watch.client_session_id,
                "status": watch.status, "expires_at": watch.expires_at.isoformat(),
            })
        elif event == "client.watch.heartbeat":
            watch = await client_watch_service.heartbeat(int(data.get("watch_id")), session_id, data.get("lat"), data.get("lng"), db)
            await _send(websocket, "client.watch.updated", {"watch_id": watch.id, "expires_at": watch.expires_at.isoformat()})
        elif event in ("client.ride.on_car", "client.ride.exited", "client.watch.stop"):
            state = {"client.ride.on_car": "on_car", "client.ride.exited": "exited", "client.watch.stop": "stopped"}[event]
            res = await client_watch_service.update_ride_state(int(data.get("watch_id")), session_id, state, db)
            await _send(websocket, "client.watch.stopped" if state != "on_car" else "client.ride.state_updated", res)
        else:
            await _send(websocket, "error", {"detail": f"Unknown event '{event}'"})
    except WatchError as exc:
        await _send(websocket, "error", {"detail": str(exc), "status": exc.status_code})
    except (TypeError, ValueError, KeyError):
        await _send(websocket, "error", {"detail": "Invalid event payload"})
    finally:
        db.close()


@router.websocket("/realtime")
async def public_realtime_stream(
    websocket: WebSocket,
    routes: Optional[str] = Query(None, description="Comma-separated route IDs to filter"),
    session_id: Optional[str] = Query(None, max_length=64),
):
    """
    Public stream: vehicle.location.updated, route.vehicle.status, parking.count.updated.
    Client -> server: "ping", {"event":"subscribe","data":{"routes":[..]}} and the client.watch.* events
    (each watch mutation requires the watch's session secret).
    """
    await realtime_manager.connect_client(websocket, _parse_routes(routes))
    try:
        while True:
            raw = await websocket.receive_text()
            if raw == "ping":
                await websocket.send_text("pong")
                continue
            if len(raw) > MAX_MESSAGE_BYTES:
                await _send(websocket, "error", {"detail": "Message too large"})
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _send(websocket, "error", {"detail": "Invalid JSON"})
                continue
            if not isinstance(msg, dict):
                await _send(websocket, "error", {"detail": "Invalid message"})
                continue
            await _handle_client_event(websocket, str(msg.get("event", "")), msg.get("data") or {}, session_id)
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # pragma: no cover - network edge cases
        logger.warning("Public WebSocket error: %s", exc)
    finally:
        realtime_manager.disconnect_client(websocket)


@router.websocket("/driver")
async def driver_realtime_stream(websocket: WebSocket, token: Optional[str] = Query(None)):
    """
    Authenticated driver channel: client.nearby.broadcast / client.nearby.removed (own route, active
    shift only), payment.received, payment.refunded, cashout.status_updated, parking.status.
    """
    payload = decode_access_token(token) if token else None
    if not payload or payload.get("role") != UserRole.DRIVER.value or not payload.get("sub"):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user_id = int(payload["sub"])
    route_id: Optional[int] = None
    snapshot: List[Dict[str, Any]] = []
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
        profile = db.query(DriverProfile).filter(DriverProfile.user_id == user_id).first() if user else None
        if not profile or not profile.is_active:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        shift = db.query(DriverShift).filter(DriverShift.driver_id == profile.id, DriverShift.status == "active").first()
        if shift:
            route_id = shift.route_id
            snapshot = client_watch_service.get_waiting_passengers(route_id, None, db)
    finally:
        db.close()

    await realtime_manager.connect_driver(websocket, user_id, route_id)
    if route_id is not None:
        await _send(websocket, "client.nearby.snapshot", {
            "route_id": route_id,
            "passengers": [
                {**p, "watch_id": str(p["watch_id"]), "waiting_since": p["waiting_since"].isoformat() if p["waiting_since"] else None}
                for p in snapshot
            ],
        })
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # pragma: no cover
        logger.warning("Driver WebSocket error: %s", exc)
    finally:
        realtime_manager.disconnect_driver(user_id, websocket)
