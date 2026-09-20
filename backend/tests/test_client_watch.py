import asyncio
from datetime import datetime, timedelta, timezone

from app.models.shift import ClientRouteWatch
from app.services.realtime.client_watch_service import client_watch_service
from tests.factories import auth, make_driver, make_route, make_uyushma


def _start(client, route_id, lat=40.7801, lng=72.3402, direction="outbound"):
    res = client.post("/api/v1/client/watch/start", json={"route_id": route_id, "direction": direction, "lat": lat, "lng": lng})
    assert res.status_code == 201, res.text
    return res.json()


def test_watch_requires_session_secret(client, db):
    route = make_route(db, make_uyushma(db))
    watch = _start(client, route.id)
    secret = watch["client_session_id"]
    assert len(secret) >= 16

    assert client.post("/api/v1/client/watch/heartbeat", json={"watch_id": watch["watch_id"]}).status_code == 422
    wrong = client.post("/api/v1/client/watch/heartbeat", json={"watch_id": watch["watch_id"], "session_id": "x" * 24})
    assert wrong.status_code == 404
    hijack = client.post("/api/v1/client/watch/stop", json={"watch_id": watch["watch_id"], "session_id": "y" * 24})
    assert hijack.status_code == 404

    hb = client.post("/api/v1/client/watch/heartbeat", json={"watch_id": watch["watch_id"], "session_id": secret, "lat": 40.7802, "lng": 72.3403})
    assert hb.status_code == 200 and hb.json()["lat"] == 40.7802


def test_unpublished_route_cannot_be_watched(client, db):
    route = make_route(db, make_uyushma(db), published=False)
    res = client.post("/api/v1/client/watch/start", json={"route_id": route.id, "lat": 40.78, "lng": 72.34})
    assert res.status_code == 404


def test_ride_lifecycle_and_driver_visibility(client, db):
    u = make_uyushma(db)
    route, other_route = make_route(db, u), make_route(db, u)
    driver_user, _, _ = make_driver(db, u, route)
    other_driver, _, _ = make_driver(db, u, other_route)
    d_headers = auth(driver_user)

    watch = _start(client, route.id)
    secret = watch["client_session_id"]

    # Only drivers with an active shift on THIS route see the exact point
    assert client.get("/api/v1/driver/passengers/waiting", headers=d_headers).status_code == 409
    client.post("/api/v1/driver/shift/start", headers=d_headers, json={"direction": "outbound"})
    client.post("/api/v1/driver/shift/start", headers=auth(other_driver), json={"direction": "outbound"})
    try:
        waiting = client.get("/api/v1/driver/passengers/waiting", headers=d_headers).json()
        assert waiting["route_id"] == route.id and [p["watch_id"] for p in waiting["passengers"]] == [watch["watch_id"]]
        assert client.get("/api/v1/driver/passengers/waiting", headers=auth(other_driver)).json()["total_waiting"] == 0

        on_car = client.post("/api/v1/client/ride/state", json={"watch_id": watch["watch_id"], "session_id": secret, "state": "on_car"})
        assert on_car.status_code == 200 and on_car.json()["state"] == "on_car"
        assert client.get("/api/v1/driver/passengers/waiting", headers=d_headers).json()["total_waiting"] == 0

        current = client.get(f"/api/v1/client/ride/current?session_id={secret}").json()
        assert current["active"] is True and current["ride_state"]["state"] == "on_car"

        exited = client.post("/api/v1/client/ride/state", json={"watch_id": watch["watch_id"], "session_id": secret, "state": "exited"})
        assert exited.json()["state"] == "exited" and exited.json()["exited_at"]
        assert client.get(f"/api/v1/client/ride/current?session_id={secret}").json()["active"] is False
        # Cannot board a finished ride
        again = client.post("/api/v1/client/ride/state", json={"watch_id": watch["watch_id"], "session_id": secret, "state": "on_car"})
        assert again.status_code == 409
    finally:
        client.post("/api/v1/driver/shift/end", headers=d_headers)
        client.post("/api/v1/driver/shift/end", headers=auth(other_driver))


def test_one_active_watch_per_session_and_expiry(client, db):
    route = make_route(db, make_uyushma(db))
    first = _start(client, route.id)
    secret = first["client_session_id"]
    second = client.post("/api/v1/client/watch/start", json={"route_id": route.id, "lat": 40.78, "lng": 72.35, "session_id": secret}).json()
    db.expire_all()
    assert db.query(ClientRouteWatch).filter(ClientRouteWatch.id == first["watch_id"]).one().status == "stopped"

    watch = db.query(ClientRouteWatch).filter(ClientRouteWatch.id == second["watch_id"]).one()
    watch.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    expired = asyncio.run(client_watch_service.sweep_expired_watches(db))
    assert second["watch_id"] in expired
    db.refresh(watch)
    assert watch.status == "expired"
