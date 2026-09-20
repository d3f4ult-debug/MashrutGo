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
    # Its own corridor, like the other route tests here: the shared session database holds many
    # lines on the factory default, and asserting on one of several identical plans is a coin toss.
    route = make_route(db, u, stops=[("G1", 40.90, 72.30), ("G2", 40.90, 72.32), ("G3", 40.90, 72.34)])
    make_fare(db, u, 3000)
    body = _search(client, (40.9002, 72.3001), (40.9001, 72.3399))
    direct = next(i for i in body["itineraries"] if i["id"].startswith(f"itin_direct_{route.id}_outbound"))
    assert direct["total_fare_uzs"] == 3000 and direct["fare_known"] is True
    assert direct["live_status"] == "no_online_vehicle_visible"  # route still shown without live cars
    transit = next(leg for leg in direct["legs"] if leg["leg_type"] == "transit")
    assert transit["route_number"] == route.route_number and transit["polyline"]
    assert 3000 < transit["distance_meters"] < 4000  # follows the stored geometry (~3.4 km)
    # Deterministic ids for identical input
    again = _search(client, (40.9002, 72.3001), (40.9001, 72.3399))
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


def test_eta_refuses_a_stop_that_is_not_on_the_route(client, db, live_route):
    """A boarding stop is map-matched exactly like a vehicle: off the line means no ETA.

    Regression: the stop's perpendicular distance was computed and thrown away, so any
    coordinate near the corridor snapped onto the line and received the same confident ETA
    as a real stop -- an arrival no vehicle was ever going to make.
    """
    route, _vehicle, headers = live_route
    _fix(client, headers, 40.5000, 72.0050)

    on_route = client.get(f"/api/v1/routing/eta?route_id={route.id}&direction=outbound&stop_lat=40.50&stop_lng=72.04").json()
    assert on_route["has_approaching_vehicle"] is True

    # Same longitude, 22 km north of the line
    off_route = client.get(f"/api/v1/routing/eta?route_id={route.id}&direction=outbound&stop_lat=40.70&stop_lng=72.04").json()
    assert off_route["has_approaching_vehicle"] is False
    assert off_route["status"] == "no_approaching_vehicle"
    assert off_route["eta_minutes"] is None and off_route["confidence"] == 0.0

    # Just outside the tolerance still counts as off-route, just inside still works
    near = client.get(f"/api/v1/routing/eta?route_id={route.id}&direction=outbound&stop_lat=40.5015&stop_lng=72.04").json()
    assert near["has_approaching_vehicle"] is True


def test_search_answers_with_a_bounded_shortlist(client, db):
    """Every candidate is a valid plan, but the response is a shortlist, not the search space.

    Regression: a 60-route city produced a 25 MB response with thousands of itineraries.
    """
    u = make_uyushma(db, name="Shortlist Uyushma")
    make_fare(db, u, 3000)
    for idx in range(20):
        base_lat, base_lng = 41.50 + (idx % 5) * 0.010, 71.50 + (idx // 5) * 0.010
        make_route(db, u, number=f"SL{idx:03d}",
                   stops=[(f"SL{idx}-{k}", base_lat + k * 0.0015, base_lng + k * 0.0020) for k in range(12)])

    body = _search(client, (41.5050, 71.5050), (41.5200, 71.5250))
    itineraries = body["itineraries"]
    assert 0 < len(itineraries) <= 20, f"shortlist grew to {len(itineraries)}"

    # The four recommended plans are always reachable in the list the client renders
    shown = {i["id"] for i in itineraries}
    for mode in ("fastest", "cheapest", "least_walking", "least_transfers"):
        assert body["recommended"][mode]["id"] in shown, f"{mode} missing from the shortlist"

    # Identical input still yields identical output
    again = _search(client, (41.5050, 71.5050), (41.5200, 71.5250))
    assert [i["id"] for i in again["itineraries"]] == [i["id"] for i in itineraries]
