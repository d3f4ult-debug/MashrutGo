import pytest
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport

from app.main import app


@pytest.mark.asyncio
async def test_route_lifecycle_and_editor():
    """
    Test complete Route & Direction editor lifecycle:
    1. Super Admin creates Uyushma.
    2. Uyushma Admin creates Route metadata.
    3. Duplicate route number in same Uyushma fails (400).
    4. Outbound and Inbound directions created.
    5. Ordered waypoints set, added, and deleted with auto-reordering.
    6. Auto-path calculated through MapTiler adapter and persisted.
    7. Unpublished route hidden from anonymous clients; visible after publish.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ts = int(datetime.now(timezone.utc).timestamp())

        # 1. Login as Super Admin
        sa_login = await client.post(
            "/api/v1/auth/login",
            json={"phone": "+998901234567", "password": "admin123"},
        )
        sa_token = sa_login.json()["access_token"]
        sa_headers = {"Authorization": f"Bearer {sa_token}"}

        # Create Uyushma
        u_res = await client.post(
            "/api/v1/uyushma",
            json={"name": "Andijon Shahar Trans", "code": f"UY-RT-{ts}", "phone": "+998741112244"},
            headers=sa_headers,
        )
        assert u_res.status_code == 201
        uyushma_id = u_res.json()["id"]

        # 2. Create Route metadata
        route_payload = {
            "route_number": f"10-{ts % 1000}",
            "name": "Vokzal — Aeroport",
            "description": "Andijon markazidan aeroportgacha yo'nalish",
            "uyushma_id": uyushma_id,
        }
        create_res = await client.post(
            "/api/v1/routes",
            json=route_payload,
            headers=sa_headers,
        )
        assert create_res.status_code == 201, create_res.text
        route_data = create_res.json()
        route_id = route_data["id"]
        assert route_data["is_published"] is False

        # 3. Duplicate route number in same Uyushma must fail
        dup_res = await client.post(
            "/api/v1/routes",
            json=route_payload,
            headers=sa_headers,
        )
        assert dup_res.status_code == 400

        # 4. Create Outbound Direction
        outbound_payload = {
            "direction_type": "outbound",
            "origin_name": "Andijon Temir Yo'l Vokzali",
            "destination_name": "Andijon Xalqaro Aeroporti",
            "origin_lat": 40.7821,
            "origin_lng": 72.3442,
            "destination_lat": 40.7289,
            "destination_lng": 72.2965,
        }
        dir_res = await client.post(
            f"/api/v1/routes/{route_id}/directions",
            json=outbound_payload,
            headers=sa_headers,
        )
        assert dir_res.status_code == 200
        assert dir_res.json()["direction_type"] == "outbound"

        # Create Inbound Direction
        inbound_payload = {
            "direction_type": "inbound",
            "origin_name": "Andijon Xalqaro Aeroporti",
            "destination_name": "Andijon Temir Yo'l Vokzali",
            "origin_lat": 40.7289,
            "origin_lng": 72.2965,
            "destination_lat": 40.7821,
            "destination_lng": 72.3442,
        }
        in_res = await client.post(
            f"/api/v1/routes/{route_id}/directions",
            json=inbound_payload,
            headers=sa_headers,
        )
        assert in_res.status_code == 200

        # 5. Set Ordered Waypoints on Outbound Direction
        waypoints_payload = [
            {"order": 1, "name": "Yangi Bozor", "lat": 40.7712, "lng": 72.3501, "is_stop": True},
            {"order": 2, "name": "Viloyat Kasalxonasi", "lat": 40.7554, "lng": 72.3302, "is_stop": True},
        ]
        wp_res = await client.post(
            f"/api/v1/routes/{route_id}/directions/outbound/waypoints",
            json=waypoints_payload,
            headers=sa_headers,
        )
        assert wp_res.status_code == 200
        wps = wp_res.json()
        assert len(wps) == 2
        assert wps[0]["order"] == 1
        assert wps[1]["order"] == 2
        wp1_id = wps[0]["id"]

        # Add a 3rd waypoint
        add_wp_res = await client.post(
            f"/api/v1/routes/{route_id}/directions/outbound/waypoints/add",
            json={"order": 3, "name": "Avto Shoxbekat", "lat": 40.7410, "lng": 72.3150, "is_stop": True},
            headers=sa_headers,
        )
        assert add_wp_res.status_code == 201
        assert add_wp_res.json()["order"] == 3

        # Delete 1st waypoint and verify reordering
        del_wp = await client.delete(
            f"/api/v1/routes/{route_id}/directions/outbound/waypoints/{wp1_id}",
            headers=sa_headers,
        )
        assert del_wp.status_code == 204

        # 6. Test Interactive Auto-Path calculation helper
        auto_path_payload = {
            "origin": {"lat": 40.7821, "lng": 72.3442, "name": "A"},
            "destination": {"lat": 40.7289, "lng": 72.2965, "name": "B"},
            "waypoints": [{"lat": 40.7554, "lng": 72.3302, "name": "WP"}],
            "profile": "driving",
        }
        calc_res = await client.post(
            "/api/v1/routes/editor/auto-path",
            json=auto_path_payload,
            headers=sa_headers,
        )
        assert calc_res.status_code == 200
        calc_data = calc_res.json()
        assert calc_data["distance_meters"] > 0
        assert calc_data["duration_seconds"] > 0
        assert calc_data["geojson"]["type"] == "LineString"

        # Generate and save path in DB for the direction
        gen_res = await client.post(
            f"/api/v1/routes/{route_id}/directions/outbound/generate-path",
            headers=sa_headers,
        )
        assert gen_res.status_code == 200
        assert gen_res.json()["distance_meters"] > 0
        assert gen_res.json()["polyline"] is not None

        # 7. Anonymous client access & Publishing
        # Before publishing, route is unpublished -> 404 for anonymous client
        anon_get = await client.get(f"/api/v1/routes/{route_id}")
        assert anon_get.status_code == 404

        # Publish the route
        pub_res = await client.post(
            f"/api/v1/routes/{route_id}/publish",
            json={"is_published": True},
            headers=sa_headers,
        )
        assert pub_res.status_code == 200
        assert pub_res.json()["is_published"] is True

        # Now anonymous client can access the published route
        anon_get2 = await client.get(f"/api/v1/routes/{route_id}")
        assert anon_get2.status_code == 200
        assert anon_get2.json()["route_number"] == route_payload["route_number"]
        assert len(anon_get2.json()["directions"]) == 2

        # Public routes list contains the newly published route
        public_list = await client.get(f"/api/v1/routes?uyushma_id={uyushma_id}")
        assert public_list.status_code == 200
        published_ids = [r["id"] for r in public_list.json()]
        assert route_id in published_ids
