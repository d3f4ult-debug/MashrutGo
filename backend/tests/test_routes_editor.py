from tests.factories import auth, make_uyushma, make_user

LINE = {"type": "LineString", "coordinates": [[72.33, 40.78], [72.34, 40.781], [72.35, 40.782]]}


def _direction(name_a="Vokzal", name_b="Bozor", geojson=LINE, waypoints=None):
    return {
        "origin_name": name_a, "destination_name": name_b,
        "origin_lat": 40.78, "origin_lng": 72.33, "destination_lat": 40.782, "destination_lng": 72.35,
        "waypoints": waypoints if waypoints is not None else [{"name": "Oraliq", "lat": 40.781, "lng": 72.34}],
        "geojson": geojson, "distance_meters": 1800, "duration_seconds": 300,
    }


def test_route_editor_full_lifecycle(client, db):
    u = make_uyushma(db)
    headers = auth(make_user(db, "uyushma_admin", u.id))

    res = client.post("/api/v1/routes", headers=headers, json={"route_number": "12", "name": "Vokzal — Bozor"})
    assert res.status_code == 201, res.text
    route_id = res.json()["id"]
    assert res.json()["uyushma_id"] == u.id and res.json()["is_published"] is False
    assert client.post("/api/v1/routes", headers=headers, json={"route_number": "12", "name": "Dup"}).status_code == 409

    # Publishing needs both directions with geometry
    assert client.post(f"/api/v1/routes/{route_id}/publish", headers=headers, json={"is_published": True}).status_code == 409

    out = client.put(f"/api/v1/routes/{route_id}/directions/outbound", headers=headers, json=_direction())
    assert out.status_code == 200, out.text
    assert len(out.json()["waypoints"]) == 1 and out.json()["distance_meters"] == 1800
    assert client.post(f"/api/v1/routes/{route_id}/publish", headers=headers, json={"is_published": True}).status_code == 409

    inbound = _direction("Bozor", "Vokzal", waypoints=[{"name": "Boshqa ko'cha", "lat": 40.7805, "lng": 72.345}, {"name": "Yana", "lat": 40.7801, "lng": 72.338}])
    res_in = client.put(f"/api/v1/routes/{route_id}/directions/inbound", headers=headers, json=inbound)
    assert res_in.status_code == 200 and [w["order"] for w in res_in.json()["waypoints"]] == [1, 2]

    # Re-saving replaces waypoints atomically (reorder/delete)
    res_out2 = client.put(f"/api/v1/routes/{route_id}/directions/outbound", headers=headers, json=_direction(waypoints=[]))
    assert res_out2.json()["waypoints"] == []

    assert client.get(f"/api/v1/routes/{route_id}").status_code == 404  # draft hidden from public
    pub = client.post(f"/api/v1/routes/{route_id}/publish", headers=headers, json={"is_published": True})
    assert pub.status_code == 200 and pub.json()["is_published"] is True

    public = client.get(f"/api/v1/routes/{route_id}")
    assert public.status_code == 200
    detail = public.json()
    assert {d["direction_type"] for d in detail["directions"]} == {"outbound", "inbound"}
    assert detail["uyushma_name"] == u.name and detail["online_vehicles_count"] == 0

    summary = client.get(f"/api/v1/uyushma/{u.id}/routes", headers=headers).json()
    assert summary[0]["directions"][0]["has_geometry"] is True

    # Soft archive
    assert client.delete(f"/api/v1/routes/{route_id}", headers=headers).status_code == 204
    assert client.get(f"/api/v1/routes/{route_id}").status_code == 404
    assert route_id not in {r["id"] for r in client.get("/api/v1/routes").json()}


def test_direction_validation(client, db):
    u = make_uyushma(db)
    headers = auth(make_user(db, "uyushma_admin", u.id))
    route_id = client.post("/api/v1/routes", headers=headers, json={"route_number": "Z1", "name": "Validate"}).json()["id"]
    assert client.put(f"/api/v1/routes/{route_id}/directions/sideways", headers=headers, json=_direction()).status_code == 422
    bad_geo = _direction(geojson={"type": "LineString", "coordinates": [[500, 40]]})
    assert client.put(f"/api/v1/routes/{route_id}/directions/outbound", headers=headers, json=bad_geo).status_code == 422


def test_auto_path_preview_with_geodesic_provider_warns(client, db):
    u = make_uyushma(db)
    headers = auth(make_user(db, "uyushma_admin", u.id))
    res = client.post("/api/v1/routes/editor/auto-path", headers=headers, json={
        "origin": {"lat": 40.78, "lng": 72.33}, "destination": {"lat": 40.77, "lng": 72.36},
        "waypoints": [{"lat": 40.775, "lng": 72.345}],
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["provider"] == "geodesic-fallback" and body["warning"]
    assert body["geojson"]["coordinates"][0] == [72.33, 40.78] and len(body["geojson"]["coordinates"]) == 3
    assert body["distance_meters"] > 0

    assert client.post("/api/v1/routes/editor/auto-path", json={
        "origin": {"lat": 40.78, "lng": 72.33}, "destination": {"lat": 40.77, "lng": 72.36}}).status_code == 401


def test_generate_path_persists_geometry(client, db):
    u = make_uyushma(db)
    headers = auth(make_user(db, "uyushma_admin", u.id))
    route_id = client.post("/api/v1/routes", headers=headers, json={"route_number": "G1", "name": "Gen"}).json()["id"]
    client.put(f"/api/v1/routes/{route_id}/directions/outbound", headers=headers, json=_direction(geojson=None))
    res = client.post(f"/api/v1/routes/{route_id}/directions/outbound/generate-path", headers=headers)
    assert res.status_code == 200 and res.json()["polyline"]
