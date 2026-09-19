import pytest
from starlette.testclient import TestClient

from app.main import app
from app.core.security import create_access_token


def test_public_realtime_websocket_ping_pong():
    """Public WebSocket accepts connection and responds to ping with pong."""
    with TestClient(app) as client:
        with client.websocket_connect("/api/v1/ws/realtime?routes=1,2") as ws:
            ws.send_text("ping")
            response = ws.receive_text()
            assert response == "pong"


def test_driver_websocket_authentication():
    """Driver WebSocket requires valid JWT token."""
    with TestClient(app) as client:
        # 1. Connection without token should be rejected
        with pytest.raises(Exception):
            with client.websocket_connect("/api/v1/ws/driver"):
                pass

        # 2. Connection with valid driver token succeeds
        valid_token = create_access_token(subject=101, role="driver")
        with client.websocket_connect(f"/api/v1/ws/driver?token={valid_token}") as ws:
            ws.send_text("ping")
            res = ws.receive_text()
            assert res == "pong"


def test_websocket_client_watch_lifecycle():
    """Client can initiate route watch and transition ride states over WebSocket."""
    import json
    from app.db.session import SessionLocal
    from app.models.transport import Route
    from app.models.uyushma import Uyushma
    import uuid

    db = SessionLocal()
    uyushma = db.query(Uyushma).first()
    if not uyushma:
        uyushma = Uyushma(name="Realtime Trans", code=f"UY-WS-{uuid.uuid4().hex[:4]}", phone="+998741110011")
        db.add(uyushma)
        db.commit()
        db.refresh(uyushma)

    route = Route(
        uyushma_id=uyushma.id,
        route_number=f"WS-{uuid.uuid4().hex[:4]}",
        name="WS Test Line",
        is_published=True,
    )
    db.add(route)
    db.commit()
    db.refresh(route)
    route_id = route.id
    db.close()

    with TestClient(app) as client:
        with client.websocket_connect("/api/v1/ws/realtime") as ws:
            # 1. Start Watch over WS
            start_event = {
                "event": "client.watch.start",
                "data": {
                    "route_id": route_id,
                    "direction": "outbound",
                    "lat": 40.7820,
                    "lng": 72.3440,
                },
            }
            ws.send_text(json.dumps(start_event))
            resp_str = ws.receive_text()
            resp = json.loads(resp_str)
            assert resp["event"] == "client.watch.started"
            assert resp["data"]["status"] == "active"
            watch_id = resp["data"]["watch_id"]

            # 2. Heartbeat over WS
            hb_event = {
                "event": "client.watch.heartbeat",
                "data": {
                    "watch_id": watch_id,
                    "lat": 40.7825,
                    "lng": 72.3445,
                },
            }
            ws.send_text(json.dumps(hb_event))
            resp2 = json.loads(ws.receive_text())
            assert resp2["event"] == "client.watch.heartbeat_ack"
            assert resp2["data"]["active"] is True

            # 3. Transition to "on_car" over WS
            on_car_event = {
                "event": "client.ride.on_car",
                "data": {
                    "watch_id": watch_id,
                    "state": "on_car",
                },
            }
            ws.send_text(json.dumps(on_car_event))
            resp3 = json.loads(ws.receive_text())
            assert resp3["event"] == "client.ride.state_updated"
            assert resp3["data"]["status"] == "on_car"
