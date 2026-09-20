import json
import uuid

from app.core.security import create_access_token
from tests.factories import auth, fund_client, make_driver, make_fare, make_route, make_uyushma, make_user


def _next_event(ws, name, limit=10):
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        if msg["event"] == name:
            return msg
    raise AssertionError(f"event {name} not received")


def test_public_ping_and_subscribe(client):
    with client.websocket_connect("/api/v1/ws/realtime?routes=1,2") as ws:
        ws.send_text("ping")
        assert ws.receive_text() == "pong"
        ws.send_text(json.dumps({"event": "subscribe", "data": {"routes": [5]}}))
        assert _next_event(ws, "subscribed")["data"]["routes"] == [5]
        ws.send_text("{bad json")
        assert _next_event(ws, "error")["version"] == "1.0"


def test_driver_socket_rejects_non_driver_tokens(client, db):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    client_user = make_user(db, "client")
    token = create_access_token(subject=client_user.id, role="client")
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/v1/ws/driver?token={token}") as ws:
            ws.receive_text()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/v1/ws/driver") as ws:
            ws.receive_text()


def test_driver_receives_waiting_passengers_and_payments(client, db):
    u = make_uyushma(db)
    route = make_route(db, u)
    make_fare(db, u, 2500)
    driver_user, _, vehicle = make_driver(db, u, route)
    headers = auth(driver_user)
    client.post("/api/v1/driver/shift/start", headers=headers, json={"direction": "outbound"})
    token = headers["Authorization"].split(" ")[1]
    try:
        with client.websocket_connect(f"/api/v1/ws/driver?token={token}") as ws:
            snapshot = _next_event(ws, "client.nearby.snapshot")
            assert snapshot["data"]["route_id"] == route.id

            watch = client.post("/api/v1/client/watch/start", json={"route_id": route.id, "lat": 40.7801, "lng": 72.341}).json()
            nearby = _next_event(ws, "client.nearby.broadcast")
            assert nearby["data"]["watch_id"] == str(watch["watch_id"]) and nearby["data"]["client_lat"] == 40.7801
            assert "client_session_id" not in json.dumps(nearby)  # the secret never reaches drivers

            client.post("/api/v1/client/ride/state", json={"watch_id": watch["watch_id"], "session_id": watch["client_session_id"], "state": "on_car"})
            removed = _next_event(ws, "client.nearby.removed")
            assert removed["data"] == {"watch_id": str(watch["watch_id"]), "reason": "on_car"}

            passenger = make_user(db, "client")
            fund_client(db, passenger, 5000)
            client.post("/api/v1/payments/pay", headers={**auth(passenger), "Idempotency-Key": uuid.uuid4().hex},
                        json={"identifier": vehicle.internal_id, "method": "qr"})
            received = _next_event(ws, "payment.received")
            assert received["data"]["payment"]["amount_uzs"] == 2500 and received["data"]["payment"]["refundable"] is True
    finally:
        client.post("/api/v1/driver/shift/end", headers=headers)


def test_public_socket_streams_vehicle_locations(client, db):
    from datetime import datetime, timezone

    u = make_uyushma(db)
    route = make_route(db, u)
    driver_user, _, vehicle = make_driver(db, u, route)
    headers = auth(driver_user)
    client.post("/api/v1/driver/shift/start", headers=headers, json={"direction": "outbound"})
    try:
        with client.websocket_connect(f"/api/v1/ws/realtime?routes={route.id}") as ws:
            client.post("/api/v1/driver/gps/single", headers=headers, json={
                "lat": 40.78, "lng": 72.345, "speed_kmh": 25, "heading": 90, "accuracy_meters": 5,
                "captured_at": datetime.now(timezone.utc).isoformat()})
            loc = _next_event(ws, "vehicle.location.updated")
            assert loc["data"]["vehicle_id"] == vehicle.internal_id and loc["data"]["route_id"] == route.id
            status = _next_event(ws, "route.vehicle.status")
            assert status["data"]["online_vehicles_count"] == 1
    finally:
        client.post("/api/v1/driver/shift/end", headers=headers)
