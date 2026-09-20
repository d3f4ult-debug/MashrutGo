import uuid
from datetime import datetime, timedelta, timezone

from app.db.session import SessionLocal
from app.models.shift import LocationSnapshot
from app.services.realtime.tracking_service import tracking_service
from tests.factories import auth, make_driver, make_parking, make_route, make_uyushma


def _gps(lat, lng, seconds_ago=0, key=None, accuracy=5.0, speed=30.0):
    return {
        "lat": lat, "lng": lng, "speed_kmh": speed, "heading": 90.0, "accuracy_meters": accuracy,
        "captured_at": (datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)).isoformat(),
        "idempotency_key": key or uuid.uuid4().hex,
    }


def _live(client, route_id):
    return client.get(f"/api/v1/driver/vehicles/live?route_id={route_id}").json()


def test_shift_gps_parking_and_end(client, db):
    u = make_uyushma(db)
    route = make_route(db, u)
    parking = make_parking(db, u, 40.6600, 72.2200, radius=120)
    driver_user, _, vehicle = make_driver(db, u, route)
    headers = auth(driver_user)

    assert client.post("/api/v1/driver/gps/single", headers=headers, json=_gps(40.66, 72.22)).status_code == 409
    start = client.post("/api/v1/driver/shift/start", headers=headers, json={"direction": "outbound"})
    assert start.status_code == 201
    assert client.post("/api/v1/driver/shift/start", headers=headers, json={"direction": "outbound"}).status_code == 409
    assert client.get("/api/v1/driver/shift/current", headers=headers).json()["id"] == start.json()["id"]

    # No fix yet: vehicle is on shift but never drawn at (0,0)
    assert _live(client, route.id) == []
    assert client.post("/api/v1/driver/gps/single", headers=headers, json=_gps(0.0, 0.0)).status_code == 422

    res = client.post("/api/v1/driver/gps/single", headers=headers, json=_gps(40.6601, 72.2201, seconds_ago=40))
    assert res.status_code == 200 and res.json()["applied_to_live"] is True
    live = _live(client, route.id)
    assert len(live) == 1 and live[0]["vehicle_id"] == vehicle.internal_id and live[0]["parking_id"] == parking.id
    parkings = {p["parking_id"]: p for p in client.get("/api/v1/driver/parkings", headers=headers).json()}
    assert parkings[parking.id]["is_driver_inside"] is True and parkings[parking.id]["vehicle_count"] == 1

    # Out-of-order point is stored but does not move the marker
    old = client.post("/api/v1/driver/gps/single", headers=headers, json=_gps(40.67, 72.24, seconds_ago=44))
    assert old.json()["applied_to_live"] is False
    # Implausible jump (GPS spike) is stored but ignored for the live marker
    spike = client.post("/api/v1/driver/gps/single", headers=headers, json=_gps(40.9000, 72.9000, seconds_ago=39))
    assert spike.json()["applied_to_live"] is False
    # Leaving the geofence (~850 m in 40 s is plausible)
    assert client.post("/api/v1/driver/gps/single", headers=headers, json=_gps(40.6600, 72.2300)).json()["applied_to_live"]
    assert _live(client, route.id)[0]["parking_id"] is None
    # Duplicate key is acknowledged, not re-stored
    key = uuid.uuid4().hex
    client.post("/api/v1/driver/gps/single", headers=headers, json=_gps(40.6600, 72.2310, key=key))
    dup = client.post("/api/v1/driver/gps/single", headers=headers, json=_gps(40.6600, 72.2310, key=key))
    assert dup.json()["duplicate"] is True

    assert client.post("/api/v1/driver/shift/direction", headers=headers, json={"direction": "inbound"}).json()["direction"] == "inbound"
    end = client.post("/api/v1/driver/shift/end", headers=headers)
    assert end.status_code == 200 and end.json()["status"] == "completed"
    assert _live(client, route.id) == []
    assert client.get("/api/v1/driver/shift/current", headers=headers).json() is None


def test_offline_batch_sync_is_idempotent_and_updates_live(client, db):
    u = make_uyushma(db)
    route = make_route(db, u)
    driver_user, _, _ = make_driver(db, u, route)
    headers = auth(driver_user)
    client.post("/api/v1/driver/shift/start", headers=headers, json={"direction": "outbound"})
    try:
        points = [_gps(40.78, 72.33 + i * 0.001, seconds_ago=20 - i) for i in range(5)]
        points.append({**_gps(40.78, 72.34), "captured_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()})
        payload = {"batch_id": uuid.uuid4().hex, "points": list(reversed(points))}
        res = client.post("/api/v1/driver/gps/batch", headers=headers, json=payload).json()
        assert res["processed_count"] == 5 and res["discarded_count"] == 1 and res["duplicate_count"] == 0
        live = _live(client, route.id)
        assert len(live) == 1 and abs(live[0]["lng"] - 72.334) < 1e-6  # newest valid point

        again = client.post("/api/v1/driver/gps/batch", headers=headers, json=payload).json()
        assert again["processed_count"] == 0 and again["duplicate_count"] == 5
    finally:
        client.post("/api/v1/driver/shift/end", headers=headers)


def test_finished_shift_backlog_is_accepted_as_history_only(client, db):
    """A driver who ends a shift offline still holds its tail; it must land in that shift, and
    it must never resurrect the vehicle on the live map."""
    u = make_uyushma(db)
    route = make_route(db, u)
    driver_user, _, vehicle = make_driver(db, u, route)
    headers = auth(driver_user)
    first = client.post("/api/v1/driver/shift/start", headers=headers, json={"direction": "outbound"}).json()
    client.post("/api/v1/driver/shift/end", headers=headers)
    assert _live(client, route.id) == []

    backlog = {"batch_id": uuid.uuid4().hex, "points": [_gps(40.78, 72.33, seconds_ago=30)], "shift_id": first["id"]}
    res = client.post("/api/v1/driver/gps/batch", headers=headers, json=backlog)
    assert res.status_code == 200 and res.json()["processed_count"] == 1
    assert _live(client, route.id) == [], "a closed shift's history must not move the live marker"
    stored = db.query(LocationSnapshot).filter(LocationSnapshot.shift_id == first["id"]).count()
    assert stored == 1, "the backlog belongs to the shift that recorded it"

    # Another driver's shift id is rejected, and so is an unknown one
    other_user, _, _ = make_driver(db, u, route)
    assert client.post("/api/v1/driver/gps/batch", headers=auth(other_user), json=backlog).status_code == 404

    # While a new shift runs, a backlog without a shift id belongs to the new shift
    second = client.post("/api/v1/driver/shift/start", headers=headers, json={"direction": "outbound"}).json()
    try:
        live_batch = {"batch_id": uuid.uuid4().hex, "points": [_gps(40.781, 72.331)]}
        assert client.post("/api/v1/driver/gps/batch", headers=headers, json=live_batch).status_code == 200
        assert len(_live(client, route.id)) == 1
        assert second["id"] != first["id"]
    finally:
        client.post("/api/v1/driver/shift/end", headers=headers)


def test_stale_flag_and_rehydrate(client, db):
    u = make_uyushma(db)
    route = make_route(db, u)
    driver_user, _, vehicle = make_driver(db, u, route)
    headers = auth(driver_user)
    client.post("/api/v1/driver/shift/start", headers=headers, json={"direction": "outbound"})
    try:
        client.post("/api/v1/driver/gps/single", headers=headers, json=_gps(40.78, 72.335))
        state = tracking_service.get_state(vehicle.id)
        state.captured_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        import asyncio
        stale = asyncio.run(tracking_service.check_and_flag_stale_vehicles())
        assert vehicle.id in stale and _live(client, route.id) == []

        # Restart simulation: the in-memory state is rebuilt from the DB
        session = SessionLocal()
        try:
            tracking_service.rehydrate(session)
        finally:
            session.close()
        restored = tracking_service.get_state(vehicle.id)
        assert restored is not None and restored.has_fix
    finally:
        client.post("/api/v1/driver/shift/end", headers=headers)


def test_driver_me_contains_route_geometry_and_fare(client, db):
    u = make_uyushma(db)
    route = make_route(db, u)
    from tests.factories import make_fare
    make_fare(db, u, 3000)
    driver_user, _, vehicle = make_driver(db, u, route)
    me = client.get("/api/v1/driver/me", headers=auth(driver_user)).json()
    assert me["vehicle"]["internal_id"] == vehicle.internal_id and me["fare_uzs"] == 3000
    assert len(me["route"]["directions"]) == 2 and me["gps_interval_seconds"] >= 2
