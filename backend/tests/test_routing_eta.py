from datetime import datetime, timezone

import pytest

from app.services.realtime.tracking_service import tracking_service
from app.services.routing.eta_service import eta_service, project_point_onto_polyline
from tests.factories import auth, make_driver, make_fare, make_route, make_uyushma


def test_projection_geometry():
    line = [(40.78, 72.34), (40.78, 72.35)]
    along, perp, lat, lng = project_point_onto_polyline(40.78045, 72.345, line)
    assert 400 < along < 450 and 40 < perp < 60 and abs(lat - 40.78) < 1e-4
    assert project_point_onto_polyline(40.78, 72.339, line)[0] == 0.0


def _search(client, origin, dest, mode="fastest"):
    res = client.post("/api/v1/routing/search", json={"origin": {"lat": origin[0], "lng": origin[1], "name": "A"},
                                                      "destination": {"lat": dest[0], "lng": dest[1], "name": "B"},
                                                      "preferences": {"mode": mode}})
    assert res.status_code == 200, res.text
    return res.json()


def test_walking_baseline_is_always_present(client):
    body = _search(client, (40.70, 72.20), (40.701, 72.201))
    walk = [i for i in body["itineraries"] if i["id"] == "itin_walk"]
    assert walk and walk[0]["total_fare_uzs"] == 0 and walk[0]["live_status"] == "not_applicable"
    assert walk[0]["legs"][0]["live_status"] is None


def test_direct_transit_uses_fare_engine_and_geometry(client, db):
    u = make_uyushma(db)
    route = make_route(db, u)
    make_fare(db, u, 3000)
    body = _search(client, (40.7802, 72.3301), (40.7801, 72.3699))
    direct = next(i for i in body["itineraries"] if i["id"].startswith(f"itin_direct_{route.id}_outbound"))
    assert direct["total_fare_uzs"] == 3000 and direct["fare_known"] is True
    assert direct["live_status"] == "no_online_vehicle_visible"  # route still shown without live cars
    transit = next(l for l in direct["legs"] if l["leg_type"] == "transit")
    assert transit["route_number"] == route.route_number and transit["polyline"]
    assert 3000 < transit["distance_meters"] < 4000  # follows the stored geometry (~3.4 km)
    # Deterministic ids for identical input
    again = _search(client, (40.7802, 72.3301), (40.7801, 72.3699))
    assert [i["id"] for i in again["itineraries"]] == [i["id"] for i in body["itineraries"]]


def test_unknown_fare_is_flagged_not_invented(client, db):
    u = make_uyushma(db)
    route = make_route(db, u, stops=[("P1", 40.60, 72.10), ("P2", 40.60, 72.12), ("P3", 40.60, 72.14)])
    body = _search(client, (40.6001, 72.1001), (40.6001, 72.1399))
    direct = next(i for i in body["itineraries"] if i["id"].startswith(f"itin_direct_{route.id}"))
    assert direct["fare_known"] is False and direct["total_fare_uzs"] == 0


@pytest.fixture
def live_route(client, db):
    u = make_uyushma(db)
    route = make_route(db, u, stops=[("S1", 40.50, 72.00), ("S2", 40.50, 72.02), ("S3", 40.50, 72.04), ("S4", 40.50, 72.06)])
    make_fare(db, u, 2500)
    driver_user, _, vehicle = make_driver(db, u, route)
    headers = auth(driver_user)
    client.post("/api/v1/driver/shift/start", headers=headers, json={"direction": "outbound"})
    yield route, vehicle, headers
    client.post("/api/v1/driver/shift/end", headers=headers)


def _fix(client, headers, lat, lng, speed=30.0):
    client.post("/api/v1/driver/gps/single", headers=headers, json={
        "lat": lat, "lng": lng, "speed_kmh": speed, "heading": 90, "accuracy_meters": 5,
        "captured_at": datetime.now(timezone.utc).isoformat(),
    })


def test_eta_for_approaching_vehicle_and_none_after_passing(client, db, live_route):
    route, vehicle, headers = live_route
    _fix(client, headers, 40.5000, 72.0050)
    eta = client.get(f"/api/v1/routing/eta?route_id={route.id}&direction=outbound&stop_lat=40.50&stop_lng=72.04").json()
    assert eta["has_approaching_vehicle"] is True and eta["approaching_vehicle_id"] == vehicle.internal_id
    assert eta["eta_minutes"] >= 1 and 2500 < eta["distance_meters"] < 3200 and eta["plate_number"] == vehicle.plate_number

    state = tracking_service.get_state(vehicle.id)
    state.lng = 72.0550  # the vehicle has passed the stop
    eta2 = client.get(f"/api/v1/routing/eta?route_id={route.id}&direction=outbound&stop_lat=40.50&stop_lng=72.04").json()
    assert eta2["has_approaching_vehicle"] is False and eta2["eta_minutes"] is None and eta2["status"] == "no_approaching_vehicle"

    # Routing uses the live vehicle in 'fastest' costs
    body = _search(client, (40.5001, 72.0401), (40.5001, 72.0599))
    direct = next(i for i in body["itineraries"] if i["id"].startswith(f"itin_direct_{route.id}_outbound"))
    assert direct["online_vehicles_count"] == 1


def test_eta_ignores_off_route_and_stale_vehicles(client, db, live_route):
    route, vehicle, headers = live_route
    _fix(client, headers, 40.52, 72.01)  # ~2 km off the line
    eta = client.get(f"/api/v1/routing/eta?route_id={route.id}&direction=outbound&stop_lat=40.50&stop_lng=72.04").json()
    assert eta["has_approaching_vehicle"] is False
    db_session = db
    res = eta_service.calculate_eta(route.id, "inbound", 40.50, 72.04, db_session)
    assert res.has_approaching_vehicle is False
    assert tracking_service.get_state(vehicle.id) is not None
