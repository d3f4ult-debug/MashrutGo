import asyncio
import json

import httpx
import pytest

from app.models.system import DeviceToken, Notification
from app.services.routing.base import InvalidCoordinateError, RoutingProviderError
from app.services.routing.maptiler_adapter import MapTilerAdapter, haversine_distance
from app.services.routing.providers import GeodesicFallbackProvider, OSRMRoutingProvider
from tests.factories import auth, make_route, make_user, make_uyushma


def test_haversine():
    assert 17000 < haversine_distance(40.7821, 72.3442, 40.6415, 72.2389) < 20000


def test_geodesic_provider_validates_and_labels():
    provider = GeodesicFallbackProvider()
    with pytest.raises(InvalidCoordinateError):
        asyncio.run(provider.calculate_route([(40.78, 72.34)]))
    with pytest.raises(InvalidCoordinateError):
        asyncio.run(provider.calculate_route([(95.0, 72.34), (40.75, 72.36)]))
    res = asyncio.run(provider.calculate_route([(40.78, 72.34), (40.77, 72.35)]))
    assert res.provider == "geodesic-fallback" and res.geojson["coordinates"][0] == [72.34, 40.78]


def test_osrm_provider_parses_and_reports_errors(monkeypatch):
    calls = {}

    async def fake_get(self, url, params=None):
        calls["url"] = url
        if "72.990000" in url:
            return httpx.Response(200, json={"code": "NoRoute", "routes": []})
        return httpx.Response(200, json={"code": "Ok", "routes": [{
            "distance": 1234.4, "duration": 222.6,
            "geometry": {"type": "LineString", "coordinates": [[72.34, 40.78], [72.345, 40.779], [72.35, 40.77]]}}]})

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    provider = OSRMRoutingProvider("https://osrm.example")
    res = asyncio.run(provider.calculate_route([(40.78, 72.34), (40.77, 72.35)]))
    assert calls["url"].startswith("https://osrm.example/route/v1/driving/72.340000,40.780000;")
    assert res.provider == "osrm" and res.distance_meters == 1234 and len(res.geojson["coordinates"]) == 3
    with pytest.raises(RoutingProviderError):
        asyncio.run(provider.calculate_route([(40.78, 72.34), (40.77, 72.99)]))


def test_maptiler_geocode_never_invents_results_without_key():
    assert asyncio.run(MapTilerAdapter(api_key="").geocode("Andijon")) == []


def test_geo_search_returns_real_db_stops(client, db):
    u = make_uyushma(db)
    make_route(db, u, stops=[("Qo'rg'ontepa bekati", 40.73, 72.76), ("Oraliq nuqta", 40.735, 72.765), ("Xonobod terminali", 40.74, 72.77)])
    res = client.get("/api/v1/geo/search?q=xonobod")
    assert res.status_code == 200
    names = [p["name"] for p in res.json()]
    assert "Xonobod terminali" in names and all(p["source"] == "db" for p in res.json())
    assert client.get("/api/v1/geo/search?q=a").status_code == 422


def test_device_token_registration_and_notifications(client, db):
    user = make_user(db, "client")
    other = make_user(db, "client")
    token = "fcm-" + "x" * 40
    assert client.post("/api/v1/notifications/device-token", headers=auth(user), json={"token": token, "platform": "android"}).status_code == 204
    # Same device, new account: token moves
    assert client.post("/api/v1/notifications/device-token", headers=auth(other), json={"token": token, "platform": "android"}).status_code == 204
    db.expire_all()
    assert db.query(DeviceToken).filter(DeviceToken.token == token).one().user_id == other.id

    db.add(Notification(user_id=other.id, title="Salom", body="Test", notification_type="test", data_payload=json.dumps({"route": "/wallet"})))
    db.commit()
    items = client.get("/api/v1/notifications/me", headers=auth(other)).json()
    assert items[0]["title"] == "Salom" and items[0]["data"]["route"] == "/wallet"
    assert client.post(f"/api/v1/notifications/{items[0]['id']}/read", headers=auth(other)).status_code == 204
    assert client.post(f"/api/v1/notifications/{items[0]['id']}/read", headers=auth(user)).status_code == 404


def test_payment_config_is_public_and_secret_free(client):
    body = client.get("/api/v1/wallet/config").json()
    assert body["click_configured"] is False and body["sandbox_enabled"] is True
    assert "secret" not in json.dumps(body).lower()


def test_production_refuses_insecure_defaults(monkeypatch):
    from app.core.config import DEV_SECRET_KEY, settings

    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "secret_key", DEV_SECRET_KEY)
    with pytest.raises(RuntimeError):
        settings.validate_for_runtime()
    monkeypatch.setattr(settings, "secret_key", "x" * 48)
    monkeypatch.setattr(settings, "seed_demo_data", True)
    with pytest.raises(RuntimeError):
        settings.validate_for_runtime()


def test_security_headers(client):
    res = client.get("/api/v1/health")
    assert res.headers["x-content-type-options"] == "nosniff" and res.headers["x-frame-options"] == "DENY"


def test_public_routing_endpoints_are_rate_limited(client, db):
    """A to B search walks every published line and needs no account: one address must not loop it."""
    u = make_uyushma(db, name="Throttle Uyushma")
    route = make_route(db, u)

    payload = {"origin": {"lat": 40.7802, "lng": 72.3301, "name": "A"},
               "destination": {"lat": 40.7801, "lng": 72.3699, "name": "B"},
               "preferences": {"mode": "fastest"}}
    searches = 0
    for _ in range(60):
        if client.post("/api/v1/routing/search", json=payload).status_code == 429:
            break
        searches += 1
    assert searches < 60, "route search accepted 60 unauthenticated requests from one address"

    etas = 0
    for _ in range(150):
        res = client.get(f"/api/v1/routing/eta?route_id={route.id}&direction=outbound&stop_lat=40.78&stop_lng=72.34")
        if res.status_code == 429:
            break
        etas += 1
    assert etas < 150, "ETA accepted 150 unauthenticated requests from one address"
    # Still generous enough for the client polling one route screen every 20 s
    assert etas >= 60
