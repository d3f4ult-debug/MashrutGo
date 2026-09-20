"""
Road-routing providers used by the Route Editor (A -> waypoints -> B auto path).

The domain only depends on `BaseRoutingProvider.calculate_route`; swapping OSRM for a
self-hosted Valhalla/GraphHopper or a commercial API means adding one class here.
"""
import json
from functools import lru_cache
from typing import List, Tuple

import httpx

from app.core.config import settings
from app.services.routing.base import (
    BaseRoutingProvider,
    GeocodingResult,
    InvalidCoordinateError,
    RouteGeometryResult,
    RoutingProviderError,
)
from app.services.routing.maptiler_adapter import haversine_distance

ROAD_CURVATURE_FACTOR = 1.25
URBAN_SPEED_KMH = 32.0


def validate_coordinates(coordinates: List[Tuple[float, float]]) -> None:
    if len(coordinates) < 2:
        raise InvalidCoordinateError(
            f"At least 2 coordinates (origin and destination) are required, got {len(coordinates)}"
        )
    for idx, (lat, lng) in enumerate(coordinates):
        if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
            raise InvalidCoordinateError(f"Coordinate at index {idx} ({lat}, {lng}) is out of geographic bounds")


class GeodesicFallbackProvider(BaseRoutingProvider):
    """Straight segments with a road-curvature estimate. Labelled so the UI can warn operators."""

    name = "geodesic-fallback"

    async def calculate_route(self, coordinates: List[Tuple[float, float]], profile: str = "driving") -> RouteGeometryResult:
        validate_coordinates(coordinates)
        return build_geodesic_route(coordinates)

    async def geocode(self, query: str) -> List[GeocodingResult]:
        return []


def build_geodesic_route(coordinates: List[Tuple[float, float]], speed_kmh: float = URBAN_SPEED_KMH) -> RouteGeometryResult:
    total = 0.0
    geo_coords = []
    for i, (lat, lng) in enumerate(coordinates):
        geo_coords.append([round(lng, 6), round(lat, 6)])
        if i > 0:
            prev_lat, prev_lng = coordinates[i - 1]
            total += haversine_distance(prev_lat, prev_lng, lat, lng) * ROAD_CURVATURE_FACTOR
    distance = int(round(total))
    duration = int(round(distance / (speed_kmh * 1000.0 / 3600.0))) if distance else 0
    geojson = {"type": "LineString", "coordinates": geo_coords}
    return RouteGeometryResult(
        distance_meters=distance,
        duration_seconds=duration,
        geojson=geojson,
        polyline=json.dumps(geojson),
        provider=GeodesicFallbackProvider.name,
    )


class OSRMRoutingProvider(BaseRoutingProvider):
    """OSRM HTTP API (`/route/v1/{profile}/{lng,lat;...}`) returning real road geometry."""

    name = "osrm"

    def __init__(self, base_url: str, timeout: float = 10.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def calculate_route(self, coordinates: List[Tuple[float, float]], profile: str = "driving") -> RouteGeometryResult:
        validate_coordinates(coordinates)
        coords_param = ";".join(f"{lng:.6f},{lat:.6f}" for lat, lng in coordinates)
        url = f"{self.base_url}/route/v1/{profile}/{coords_param}"
        params = {"overview": "full", "geometries": "geojson", "steps": "false"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(url, params=params)
        except httpx.HTTPError as exc:
            raise RoutingProviderError(f"Routing provider unreachable: {exc.__class__.__name__}") from exc

        if response.status_code >= 500:
            raise RoutingProviderError(f"Routing provider error (HTTP {response.status_code})")
        try:
            data = response.json()
        except ValueError as exc:
            raise RoutingProviderError("Routing provider returned invalid JSON") from exc
        if data.get("code") != "Ok" or not data.get("routes"):
            raise RoutingProviderError(f"No road route found between the points ({data.get('code', 'unknown')})")

        route = data["routes"][0]
        geometry = route.get("geometry") or {}
        if geometry.get("type") != "LineString" or len(geometry.get("coordinates", [])) < 2:
            raise RoutingProviderError("Routing provider returned empty geometry")
        return RouteGeometryResult(
            distance_meters=int(round(route.get("distance", 0))),
            duration_seconds=int(round(route.get("duration", 0))),
            geojson=geometry,
            polyline=json.dumps(geometry),
            provider=self.name,
        )

    async def geocode(self, query: str) -> List[GeocodingResult]:
        return []


@lru_cache(maxsize=1)
def get_routing_provider() -> BaseRoutingProvider:
    if settings.routing_provider.lower() == "osrm" and settings.osrm_base_url:
        return OSRMRoutingProvider(settings.osrm_base_url, settings.routing_timeout_seconds)
    return GeodesicFallbackProvider()
