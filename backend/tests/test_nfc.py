"""NFC identification: chip UIDs match regardless of how the reader formats them."""
from tests.factories import auth, make_driver, make_fare, make_route, make_uyushma, make_user


def test_nfc_uid_matches_across_reader_formats(client, db):
    u = make_uyushma(db)
    route = make_route(db, u)
    make_fare(db, u, 2500)
    admin = make_user(db, "uyushma_admin", u.id)
    _, profile, _ = make_driver(db, u, route, with_vehicle=False)

    created = client.post(f"/api/v1/uyushma/{u.id}/vehicles", headers=auth(admin),
                          json={"plate_number": "60 N 777 FC", "nfc_tag_id": "04:a2:3b:c4:d5:e6:f7",
                                "driver_id": profile.id, "route_id": route.id})
    assert created.status_code == 201, created.text
    assert created.json()["nfc_tag_id"] == "04A23BC4D5E6F7"

    for raw in ("04A23BC4D5E6F7", "04:A2:3B:C4:D5:E6:F7", "04-a2-3b-c4-d5-e6-f7"):
        res = client.post("/api/v1/payments/resolve-vehicle", json={"identifier": raw, "method": "nfc"})
        assert res.status_code == 200, (raw, res.text)
        assert res.json()["vehicle_id"] == created.json()["internal_id"]

    dup = client.post(f"/api/v1/uyushma/{u.id}/vehicles", headers=auth(admin),
                      json={"plate_number": "60 N 778 FC", "nfc_tag_id": "04A23BC4D5E6F7"})
    assert dup.status_code == 409
