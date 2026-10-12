import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_health():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_openapi_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/openapi.json")
        assert r.status_code == 200
        data = r.json()
        assert "openapi" in data
        assert "paths" in data
        assert len(data["paths"]) >= 60


def test_contracts_openapi_file_valid():
    import json
    from pathlib import Path

    file_path = Path(__file__).resolve().parent.parent.parent / "docs" / "contracts" / "openapi.json"
    assert file_path.exists(), "docs/contracts/openapi.json file must exist for Dev2/Dev3 consumers"
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert data.get("openapi") == "3.1.0"
    assert len(data.get("paths", {})) >= 60

