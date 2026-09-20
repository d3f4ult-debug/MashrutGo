from tests.factories import auth, make_driver, make_route, make_uyushma, make_user, unique_phone


def test_vehicle_crud_with_generated_internal_id(client, db):
    u = make_uyushma(db)
    route = make_route(db, u)
    headers = auth(make_user(db, "uyushma_admin", u.id))

    res = client.post(f"/api/v1/uyushma/{u.id}/vehicles", headers=headers, json={"route_id": route.id})
    assert res.status_code == 201, res.text
    v = res.json()
    assert v["internal_id"].endswith("-V0001") and v["plate_number"] is None  # metadata optional
    assert v["qr_payload"] == f"mashrutgo://v/{v['internal_id']}" and v["route_number"] == route.route_number

    res2 = client.post(f"/api/v1/uyushma/{u.id}/vehicles", headers=headers,
                       json={"internal_id": "custom-77", "plate_number": "60 a 777 aa", "vehicle_type": "damas", "model": "Damas"})
    assert res2.status_code == 201 and res2.json()["internal_id"] == "CUSTOM-77" and res2.json()["plate_number"] == "60 A 777 AA"
    assert client.post(f"/api/v1/uyushma/{u.id}/vehicles", headers=headers, json={"internal_id": "CUSTOM-77"}).status_code == 409
    assert client.post(f"/api/v1/uyushma/{u.id}/vehicles", headers=headers, json={"vehicle_type": "rocket"}).status_code == 422

    upd = client.put(f"/api/v1/uyushma/{u.id}/vehicles/{v['id']}", headers=headers, json={"color": "Sariq", "route_id": None})
    assert upd.status_code == 200 and upd.json()["color"] == "Sariq" and upd.json()["route_id"] is None

    assert client.delete(f"/api/v1/uyushma/{u.id}/vehicles/{v['id']}", headers=headers).status_code == 204
    listed = {x["id"]: x for x in client.get(f"/api/v1/uyushma/{u.id}/vehicles", headers=headers).json()}
    assert listed[v["id"]]["is_active"] is False


def test_one_driver_one_vehicle_one_route_rule(client, db):
    u = make_uyushma(db)
    route_a, route_b = make_route(db, u), make_route(db, u)
    headers = auth(make_user(db, "uyushma_admin", u.id))
    _, driver1, vehicle1 = make_driver(db, u, route_a)
    _, driver2, _ = make_driver(db, u, route_a, with_vehicle=False)

    # vehicle1 already belongs to driver1
    res = client.put(f"/api/v1/uyushma/{u.id}/drivers/{driver2.id}", headers=headers, json={"vehicle_id": vehicle1.id})
    assert res.status_code == 409 and "1 Driver = 1 Vehicle" in res.json()["detail"]

    # driver1 cannot take a second vehicle
    v2 = client.post(f"/api/v1/uyushma/{u.id}/vehicles", headers=headers, json={}).json()
    res = client.put(f"/api/v1/uyushma/{u.id}/vehicles/{v2['id']}", headers=headers, json={"driver_id": driver1.id})
    assert res.status_code == 409

    # driver2 gets v2 and its route through the driver screen
    ok = client.put(f"/api/v1/uyushma/{u.id}/drivers/{driver2.id}", headers=headers, json={"vehicle_id": v2["id"], "route_id": route_b.id})
    assert ok.status_code == 200, ok.text
    assert ok.json()["vehicle_id"] == v2["id"] and ok.json()["route_id"] == route_b.id

    # route without vehicle is rejected with a clear message
    _, driver3, _ = make_driver(db, u, with_vehicle=False)
    res = client.put(f"/api/v1/uyushma/{u.id}/drivers/{driver3.id}", headers=headers, json={"route_id": route_b.id})
    assert res.status_code == 422

    # foreign route cannot be assigned
    other = make_route(db, make_uyushma(db))
    res = client.put(f"/api/v1/uyushma/{u.id}/vehicles/{v2['id']}", headers=headers, json={"route_id": other.id})
    assert res.status_code == 404


def test_assignment_locked_during_active_shift(client, db):
    u = make_uyushma(db)
    route = make_route(db, u)
    headers = auth(make_user(db, "uyushma_admin", u.id))
    driver_user, driver, vehicle = make_driver(db, u, route)
    assert client.post("/api/v1/driver/shift/start", headers=auth(driver_user), json={"direction": "outbound"}).status_code == 201
    try:
        res = client.put(f"/api/v1/uyushma/{u.id}/vehicles/{vehicle.id}", headers=headers, json={"route_id": None})
        assert res.status_code == 409
        assert client.delete(f"/api/v1/uyushma/{u.id}/drivers/{driver.id}", headers=headers).status_code == 409
    finally:
        client.post("/api/v1/driver/shift/end", headers=auth(driver_user))


def test_driver_account_lifecycle(client, db):
    u = make_uyushma(db)
    route = make_route(db, u)
    headers = auth(make_user(db, "uyushma_admin", u.id))
    vehicle = client.post(f"/api/v1/uyushma/{u.id}/vehicles", headers=headers, json={"route_id": route.id}).json()
    phone = unique_phone()
    res = client.post(f"/api/v1/uyushma/{u.id}/drivers", headers=headers, json={
        "phone": phone, "password": "driver-pass", "full_name": "Jasur Saidov", "vehicle_id": vehicle["id"],
    })
    assert res.status_code == 201, res.text
    driver = res.json()
    assert driver["vehicle_internal_id"] == vehicle["internal_id"] and driver["route_number"] == route.route_number

    login = client.post("/api/v1/auth/login", json={"phone": phone, "password": "driver-pass"})
    assert login.status_code == 200
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {login.json()['access_token']}"}).json()
    assert me["vehicle_id"] == vehicle["id"] and me["route_id"] == route.id

    assert client.post(f"/api/v1/uyushma/{u.id}/drivers", headers=headers,
                       json={"phone": phone, "password": "driver-pass", "full_name": "Dup"}).status_code == 409

    assert client.delete(f"/api/v1/uyushma/{u.id}/drivers/{driver['id']}", headers=headers).status_code == 204
    assert client.post("/api/v1/auth/login", json={"phone": phone, "password": "driver-pass"}).status_code == 403
    freed = {v["id"]: v for v in client.get(f"/api/v1/uyushma/{u.id}/vehicles", headers=headers).json()}[vehicle["id"]]
    assert freed["driver_id"] is None


def test_parkings_and_fares_crud(client, db):
    u = make_uyushma(db)
    route = make_route(db, u)
    headers = auth(make_user(db, "uyushma_admin", u.id))

    p = client.post(f"/api/v1/uyushma/{u.id}/parkings", headers=headers,
                    json={"name": "Vokzal stoyankasi", "lat": 40.78, "lng": 72.33, "radius_meters": 120, "capacity": 10})
    assert p.status_code == 201
    upd = client.put(f"/api/v1/uyushma/{u.id}/parkings/{p.json()['id']}", headers=headers, json={"radius_meters": 200})
    assert upd.json()["radius_meters"] == 200
    assert client.post(f"/api/v1/uyushma/{u.id}/parkings", headers=headers,
                       json={"name": "X", "lat": 40.78, "lng": 72.33, "radius_meters": 5}).status_code == 422

    types = client.get(f"/api/v1/uyushma/{u.id}/fares/types", headers=headers).json()["rule_types"]
    assert set(types) == {"fixed", "distance", "zone", "time_based"}
    fare = client.post(f"/api/v1/uyushma/{u.id}/fares", headers=headers, json={
        "name": "Tungi tarif", "rule_type": "time_based", "base_fare_uzs": 3000, "route_id": route.id,
        "config": {"peak_multiplier": 1.5, "peak_start_hour": 7, "peak_end_hour": 10},
    })
    assert fare.status_code == 201, fare.text
    assert fare.json()["route_number"] == route.route_number and fare.json()["config"]["peak_multiplier"] == 1.5
    bad = client.post(f"/api/v1/uyushma/{u.id}/fares", headers=headers,
                      json={"name": "Bad", "rule_type": "fixed", "base_fare_uzs": 1000, "config": {"hack": 1}})
    assert bad.status_code == 422
    assert client.delete(f"/api/v1/uyushma/{u.id}/fares/{fare.json()['id']}", headers=headers).status_code == 204
    fares = client.get(f"/api/v1/uyushma/{u.id}/fares", headers=headers).json()
    assert fares[0]["is_active"] is False
