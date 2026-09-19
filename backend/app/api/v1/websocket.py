import json
import logging
from typing import Optional
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from app.db.session import SessionLocal
from app.core.security import decode_access_token
from app.models.shift import DriverShift
from app.models.user import DriverProfile
from app.services.realtime.client_watch_service import client_watch_service
from app.services.realtime.connection_manager import realtime_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ws", tags=["realtime"])


@router.websocket("/realtime")
async def public_realtime_stream(
    websocket: WebSocket,
    routes: Optional[str] = Query(None, description="Comma-separated route IDs to filter"),
    session_id: Optional[str] = Query(None),
):
    """
    Public WebSocket stream for vehicle locations, route statuses, and stayanka counts.
    Also handles client-to-server events:
    - client.watch.start
    - client.watch.heartbeat
    - client.ride.on_car
    - client.ride.exited
    """
    route_ids = None
    if routes:
        try:
            route_ids = [int(r.strip()) for r in routes.split(",") if r.strip()]
        except ValueError:
            route_ids = None

    await realtime_manager.connect_client(websocket, route_ids)
    try:
        while True:
            raw_data = await websocket.receive_text()
            if raw_data == "ping":
                await websocket.send_text("pong")
                continue

            try:
                msg = json.loads(raw_data)
                event = msg.get("event")
                data = msg.get("data", {})

                db = SessionLocal()
                try:
                    if event == "client.watch.start":
                        watch = await client_watch_service.start_watch(
                            route_id=data.get("route_id"),
                            direction=data.get("direction", "outbound"),
                            lat=data.get("lat"),
                            lng=data.get("lng"),
                            accuracy_meters=data.get("accuracy_meters", 5.0),
                            session_id=session_id or data.get("session_id"),
                            user_id=None,
                            db=db,
                        )
                        resp = {
                            "event": "client.watch.started",
                            "data": {
                                "watch_id": watch.id,
                                "status": watch.status,
                                "expires_at": watch.expires_at.isoformat(),
                            },
                        }
                        await websocket.send_text(json.dumps(resp))

                    elif event == "client.watch.heartbeat":
                        watch_id = data.get("watch_id")
                        if watch_id:
                            watch = await client_watch_service.heartbeat(
                                watch_id=int(watch_id),
                                lat=data.get("lat"),
                                lng=data.get("lng"),
                                db=db,
                            )
                            resp = {
                                "event": "client.watch.heartbeat_ack",
                                "data": {"watch_id": watch_id, "active": watch is not None},
                            }
                            await websocket.send_text(json.dumps(resp))

                    elif event in ("client.ride.on_car", "client.ride.state"):
                        watch_id = data.get("watch_id")
                        state = data.get("state", "on_car")
                        if watch_id:
                            res = await client_watch_service.update_ride_state(
                                watch_id=int(watch_id),
                                state=state,
                                vehicle_id=data.get("vehicle_id"),
                                db=db,
                            )
                            resp = {"event": "client.ride.state_updated", "data": res}
                            await websocket.send_text(json.dumps(resp))

                    elif event == "client.ride.exited":
                        watch_id = data.get("watch_id")
                        if watch_id:
                            res = await client_watch_service.update_ride_state(
                                watch_id=int(watch_id),
                                state="exited",
                                vehicle_id=None,
                                db=db,
                            )
                            resp = {"event": "client.ride.completed", "data": res}
                            await websocket.send_text(json.dumps(resp))
                finally:
                    db.close()
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"event": "error", "data": {"detail": "Invalid JSON"}}))
            except Exception as e:
                logger.exception(f"Error processing client WebSocket message: {e}")
                await websocket.send_text(json.dumps({"event": "error", "data": {"detail": str(e)}}))

    except WebSocketDisconnect:
        realtime_manager.disconnect_client(websocket)
    except Exception as e:
        logger.warning(f"Public WebSocket exception: {e}")
        realtime_manager.disconnect_client(websocket)


@router.websocket("/driver")
async def driver_realtime_stream(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    """
    Authenticated WebSocket stream for drivers to receive ride states,
    waiting passenger broadcasts (client.nearby.broadcast/removed), and payment notifications.
    """
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    payload = decode_access_token(token)
    if not payload or not payload.get("sub"):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    driver_id = int(payload["sub"])
    route_id = None

    # Resolve driver's route from active shift or assigned vehicle
    db = SessionLocal()
    try:
        driver_profile = db.query(DriverProfile).filter(DriverProfile.user_id == driver_id).first()
        if driver_profile:
            active_shift = (
                db.query(DriverShift)
                .filter(DriverShift.driver_id == driver_profile.id, DriverShift.status == "active")
                .first()
            )
            if active_shift:
                route_id = active_shift.route_id
            elif driver_profile.vehicle:
                route_id = driver_profile.vehicle.route_id
    finally:
        db.close()

    await realtime_manager.connect_driver(websocket, driver_id, route_id)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        realtime_manager.disconnect_driver(driver_id)
    except Exception as e:
        logger.warning(f"Driver WebSocket exception: {e}")
        realtime_manager.disconnect_driver(driver_id)
