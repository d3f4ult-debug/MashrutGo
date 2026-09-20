"""Operations-facing realtime signals and route-editor geometry checks."""
import json
import uuid
from datetime import datetime, timezone

from tests.factories import auth, make_driver, make_parking, make_route, make_uyushma, make_user


def _next_event(ws, name, limit=12):
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        if msg["event"] == name:
            return msg["data"]
    raise AssertionError(f"event {name} not received")


def _gps(lat, lng):
    return {"lat": lat, "lng": lng, "speed_kmh": 20, "heading": 90, "accuracy_meters": 5,
            "captured_at": datetime.now(timezone.utc).isoformat(), "idempotency_key": str(uuid.uuid4())}


def test_shift_start_and_direction_switch_are_announced(client, db):
    u = make_uyushma(db)
    route = make_route(db, u)
    parking = make_parking(db, u, 40.8123, 72.4123, radius=150)  # away from other tests' stoyankas
    driver_user, _, vehicle = make_driver(db, u, route)
    headers = auth(driver_user)
    try:
        with client.websocket_connect(f"/api/v1/ws/realtime?routes={route.id}") as ws:
            assert client.post("/api/v1/driver/shift/start", headers=headers, json={"direction": "outbound"}).status_code == 201
            status = _next_event(ws, "route.vehicle.status")
            assert status["route_id"] == route.id

            assert client.post("/api/v1/driver/gps/single", headers=headers, json=_gps(40.8124, 72.4124)).status_code == 200
            loc = _next_event(ws, "vehicle.location.updated")
            assert loc["vehicle_id"] == vehicle.internal_id
            assert loc["parking_id"] == parking.id and loc["parking_name"] == parking.name

            assert client.post("/api/v1/driver/shift/direction", headers=headers, json={"direction": "inbound"}).status_code == 200
            again = _next_event(ws, "vehicle.location.updated")
            assert again["direction"] == "inbound"

        fleet = client.get("/api/v1/operations/live-fleet", headers=auth(make_user(db, "uyushma_admin", u.id))).json()
        mine = next(v for v in fleet if v["vehicle_id"] == vehicle.internal_id)
        assert mine["route_name"] == route.name and mine["direction"] == "inbound"
    finally:
        client.post("/api/v1/driver/shift/end", headers=headers)


def _save(client, headers, route_id, **overrides):
    body = {
        "origin_name": "A", "destination_name": "B",
        "origin_lat": 40.78, "origin_lng": 72.33, "destination_lat": 40.78, "destination_lng": 72.35,
        "waypoints": [],
        "geojson": {"type": "LineString", "coordinates": [[72.33, 40.78], [72.34, 40.78], [72.35, 40.78]]},
        "distance_meters": 1700, "duration_seconds": 300,
    }
    body.update(overrides)
    return client.put(f"/api/v1/routes/{route_id}/directions/outbound", headers=headers, json=body)


def test_direction_geometry_must_match_its_endpoints(client, db):
    u = make_uyushma(db)
    headers = auth(make_user(db, "uyushma_admin", u.id))
    route_id = client.post("/api/v1/routes", headers=headers, json={"route_number": "G1", "name": "Geometriya"}).json()["id"]

    far = {"type": "LineString", "coordinates": [[72.40, 40.70], [72.41, 40.71]]}
    assert _save(client, headers, route_id, geojson=far).status_code == 422

    # An implausible distance is replaced by the length of the drawn line (~1.7 km)
    res = _save(client, headers, route_id, distance_meters=90_000, duration_seconds=0)
    assert res.status_code == 200
    assert 1500 < res.json()["distance_meters"] < 1900
    assert res.json()["duration_seconds"] > 0

    too_many = [{"name": f"W{i}", "lat": 40.78, "lng": 72.33 + i * 1e-4} for i in range(101)]
    assert _save(client, headers, route_id, waypoints=too_many).status_code == 422


def test_legacy_direction_upsert_rejects_invalid_polyline(client, db):
    u = make_uyushma(db)
    headers = auth(make_user(db, "uyushma_admin", u.id))
    route_id = client.post("/api/v1/routes", headers=headers, json={"route_number": "G2", "name": "Eski API"}).json()["id"]
    body = {
        "direction_type": "outbound", "origin_name": "A", "destination_name": "B",
        "origin_lat": 40.78, "origin_lng": 72.33, "destination_lat": 40.78, "destination_lng": 72.35,
        "polyline": "not-json",
    }
    assert client.post(f"/api/v1/routes/{route_id}/directions", headers=headers, json=body).status_code == 422
    dup = client.post("/api/v1/routes", headers=headers, json={"route_number": "G2", "name": "Takror"})
    assert dup.status_code == 409 and "allaqachon mavjud" in dup.json()["detail"]
