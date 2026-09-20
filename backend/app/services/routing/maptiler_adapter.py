import math
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import httpx

from app.core.config import settings
from app.services.routing.base import (
    BaseRoutingProvider,
    GeocodingResult,
    RouteGeometryResult,
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
    MapTiler Cloud geocoding adapter.
    MapTiler does not offer a public road-routing API, so `calculate_route` delegates to the
    configured routing provider (see app.services.routing.providers).
    """

    def __init__(self, api_key: str = "", base_url: str = ""):
        self.api_key = api_key or settings.maptiler_api_key
        self.base_url = (base_url or settings.maptiler_base_url).rstrip("/")

    def _is_mock_mode(self) -> bool:
        """Returns True if API key is empty or a placeholder."""
        return not self.api_key or "placeholder" in self.api_key.lower()

    async def calculate_route(
        self,
        coordinates: List[Tuple[float, float]],
        profile: str = "driving",
    ) -> RouteGeometryResult:
        from app.services.routing.providers import get_routing_provider

        return await get_routing_provider().calculate_route(coordinates, profile=profile)

    async def geocode(
        self,
        query: str,
        proximity: Optional[Tuple[float, float]] = None,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        limit: int = 6,
    ) -> List[GeocodingResult]:
        """
        Geocode a free-text query with MapTiler. Returns [] when no API key is configured
        or the provider fails — callers must never receive invented coordinates.
        `proximity` is (lat, lng); `bbox` is (min_lng, min_lat, max_lng, max_lat).
        """
        query = query.strip()
        if not query or self._is_mock_mode():
            return []

        url = f"{self.base_url}/geocoding/{quote(query, safe='')}.json"
        params: Dict[str, Any] = {"key": self.api_key, "language": "uz", "limit": limit}
        if proximity:
            params["proximity"] = f"{proximity[1]},{proximity[0]}"
        if bbox:
            params["bbox"] = ",".join(str(v) for v in bbox)

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(url, params=params)
            if res.status_code != 200:
                return []
            results = []
            for feat in res.json().get("features", []):
                center = feat.get("center") or feat.get("geometry", {}).get("coordinates")
                if not center or len(center) < 2:
                    continue
                place_types = feat.get("place_type") or []
                results.append(
                    GeocodingResult(
                        name=feat.get("text") or query,
                        lat=float(center[1]),
                        lng=float(center[0]),
                        address=feat.get("place_name", ""),
                        place_type=place_types[0] if place_types else None,
                    )
                )
            return results
        except (httpx.HTTPError, ValueError):
            return []
