import pytest
from app.services.routing.base import InvalidCoordinateError
from app.services.routing.maptiler_adapter import MapTilerAdapter, haversine_distance


def test_haversine_distance_calculation():
    """Verify haversine distance between known coordinates."""
    # Andijan station (40.7821, 72.3442) to Asaka station (40.6415, 72.2389) ~ 18 km
    dist = haversine_distance(40.7821, 72.3442, 40.6415, 72.2389)
    assert 17000 < dist < 20000  # Between 17 km and 20 km


@pytest.mark.asyncio
async def test_maptiler_adapter_coordinate_validation():
    """Adapter must raise InvalidCoordinateError if coordinates are insufficient or out of bounds."""
    adapter = MapTilerAdapter()

    # Less than 2 coordinates
    with pytest.raises(InvalidCoordinateError):
        await adapter.calculate_route([(40.78, 72.34)])

    # Out of bounds latitude
    with pytest.raises(InvalidCoordinateError):
        await adapter.calculate_route([(95.0, 72.34), (40.75, 72.36)])

    # Out of bounds longitude
    with pytest.raises(InvalidCoordinateError):
        await adapter.calculate_route([(40.78, 195.0), (40.75, 72.36)])


@pytest.mark.asyncio
async def test_maptiler_adapter_route_calculation():
    """Adapter calculates route geometry and returns valid GeoJSON LineString."""
    adapter = MapTilerAdapter()
    coords = [
        (40.7821, 72.3442),  # Andijon vokzali
        (40.7712, 72.3501),  # Yangi bozor
        (40.7554, 72.3610),  # Eski shahar
    ]
    res = await adapter.calculate_route(coords, profile="driving")

    assert res.distance_meters > 0
    assert res.duration_seconds > 0
    assert res.geojson["type"] == "LineString"
    assert len(res.geojson["coordinates"]) == 3
    # GeoJSON format is [lng, lat]
    assert res.geojson["coordinates"][0] == [72.3442, 40.7821]
    assert res.provider in ("maptiler", "maptiler-simulated")


@pytest.mark.asyncio
async def test_maptiler_adapter_geocoding():
    """Adapter returns geocoding results without crashing."""
    adapter = MapTilerAdapter()
    results = await adapter.geocode("Andijon")
    assert len(results) >= 1
    assert results[0].name != ""
    assert -90.0 <= results[0].lat <= 90.0
    assert -180.0 <= results[0].lng <= 180.0
