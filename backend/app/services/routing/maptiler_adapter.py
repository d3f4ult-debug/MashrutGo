import json
import math
from typing import Any, Dict, List, Tuple
import httpx

from app.core.config import settings
from app.services.routing.base import (
    BaseRoutingProvider,
    GeocodingResult,
    InvalidCoordinateError,
    RouteGeometryResult,
    RoutingProviderError,
)


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great circle distance between two points in meters."""
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


class MapTilerAdapter(BaseRoutingProvider):
    """
    MapTiler Cloud routing and geocoding adapter.
    Isolates external MapTiler API and guarantees clean errors and development fallback.
    """

    def __init__(self, api_key: str = "", base_url: str = ""):
        self.api_key = api_key or settings.maptiler_api_key
        self.base_url = (base_url or settings.maptiler_base_url).rstrip("/")

    def _validate_coordinates(self, coordinates: List[Tuple[float, float]]) -> None:
        if len(coordinates) < 2:
            raise InvalidCoordinateError(
                f"At least 2 coordinates (origin and destination) are required, got {len(coordinates)}"
            )
        for idx, (lat, lng) in enumerate(coordinates):
            if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
                raise InvalidCoordinateError(
                    f"Coordinate at index {idx} ({lat}, {lng}) is out of geographic bounds"
                )

    def _is_mock_mode(self) -> bool:
        """Returns True if API key is empty or a placeholder."""
        return not self.api_key or "placeholder" in self.api_key.lower()

    def _generate_fallback_geometry(
        self,
        coordinates: List[Tuple[float, float]],
        speed_kmh: float = 32.0,
    ) -> RouteGeometryResult:
        """
        Generate geodesic simulated route geometry when MapTiler key is not configured.
        Produces accurate straight-line segments connecting origin, waypoints, and destination.
        """
        total_distance = 0.0
        geojson_coords = []

        for i in range(len(coordinates)):
            lat, lng = coordinates[i]
            geojson_coords.append([round(lng, 6), round(lat, 6)])  # GeoJSON is [lng, lat]
            if i > 0:
                prev_lat, prev_lng = coordinates[i - 1]
                # Add 1.25 road curvature factor to geodesic distance for realistic road estimate
                segment_dist = haversine_distance(prev_lat, prev_lng, lat, lng) * 1.25
                total_distance += segment_dist

        distance_meters = int(round(total_distance))
        # Urban speed ~32 km/h => ~8.88 m/s
        speed_mps = (speed_kmh * 1000.0) / 3600.0
        duration_seconds = int(round(distance_meters / speed_mps)) if speed_mps > 0 else 0

        geojson = {
            "type": "LineString",
            "coordinates": geojson_coords,
        }

        return RouteGeometryResult(
            distance_meters=distance_meters,
            duration_seconds=duration_seconds,
            geojson=geojson,
            polyline=json.dumps(geojson),
            provider="maptiler-simulated",
        )

    async def calculate_route(
        self,
        coordinates: List[Tuple[float, float]],
        profile: str = "driving",
    ) -> RouteGeometryResult:
        """
        Calculate route through coordinates [(lat, lng), ...].
        Calls MapTiler Cloud Routing API if key is set, otherwise falls back gracefully.
        """
        self._validate_coordinates(coordinates)

        if self._is_mock_mode():
            return self._generate_fallback_geometry(coordinates)

        # MapTiler expects: lng1,lat1;lng2,lat2;...;lngN,latN
        coords_param = ";".join(f"{lng},{lat}" for lat, lng in coordinates)
        url = f"{self.base_url}/routing/{profile}/{coords_param}.json"
        params = {"key": self.api_key, "overview": "full", "geometries": "geojson"}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, params=params)
                if response.status_code != 200:
                    # In development/test mode, fall back rather than failing hard
                    return self._generate_fallback_geometry(coordinates)

                data = response.json()
                routes = data.get("routes", [])
                if not routes:
                    return self._generate_fallback_geometry(coordinates)

                first_route = routes[0]
                geometry = first_route.get("geometry", {})
                distance = int(round(first_route.get("distance", 0)))
                duration = int(round(first_route.get("duration", 0)))

                return RouteGeometryResult(
                    distance_meters=distance,
                    duration_seconds=duration,
                    geojson=geometry,
                    polyline=json.dumps(geometry),
                    provider="maptiler",
                )
        except Exception:
            # Clean fallback for network error
            return self._generate_fallback_geometry(coordinates)

    async def geocode(self, query: str) -> List[GeocodingResult]:
        """Geocode query string using MapTiler Geocoding API or fallback search."""
        if not query.strip():
            return []

        if self._is_mock_mode():
            # Dev fallback for Andijan sample locations
            return [
                GeocodingResult(
                    name=query,
                    lat=40.7821,
                    lng=72.3442,
                    address=f"{query}, Andijon shahri, O'zbekiston",
                    place_type="poi",
                )
            ]

        url = f"{self.base_url}/geocoding/{query}.json"
        params = {"key": self.api_key, "language": "uz,ru,en"}

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(url, params=params)
                if res.status_code != 200:
                    return []
                data = res.json()
                features = data.get("features", [])
                results = []
                for feat in features:
                    geom = feat.get("geometry", {})
                    coords = geom.get("coordinates", [0.0, 0.0])
                    results.append(
                        GeocodingResult(
                            name=feat.get("text", query),
                            lat=coords[1],
                            lng=coords[0],
                            address=feat.get("place_name", ""),
                            place_type=feat.get("place_type", ["poi"])[0] if feat.get("place_type") else None,
                        )
                    )
                return results
        except Exception:
            return []
