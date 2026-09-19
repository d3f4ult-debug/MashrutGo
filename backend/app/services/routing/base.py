import abc
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


class RoutingProviderError(Exception):
    """Base exception for routing and geocoding provider issues."""
    pass


class InvalidCoordinateError(RoutingProviderError):
    """Raised when provided coordinates are out of bounds or malformed."""
    pass


@dataclass
class RouteGeometryResult:
    distance_meters: int
    duration_seconds: int
    geojson: Dict[str, Any]
    polyline: str
    provider: str


@dataclass
class GeocodingResult:
    name: str
    lat: float
    lng: float
    address: str
    place_type: Optional[str] = None


class BaseRoutingProvider(abc.ABC):
    """Abstract interface for third-party map, routing, and geocoding providers."""

    @abc.abstractmethod
    async def calculate_route(
        self,
        coordinates: List[Tuple[float, float]],
        profile: str = "driving",
    ) -> RouteGeometryResult:
        """
        Calculate road path through ordered coordinates [(lat, lng), ...].
        Returns RouteGeometryResult with distance, duration, and GeoJSON LineString.
        """
        pass

    @abc.abstractmethod
    async def geocode(self, query: str) -> List[GeocodingResult]:
        """Geocode search query to geographic locations."""
        pass
