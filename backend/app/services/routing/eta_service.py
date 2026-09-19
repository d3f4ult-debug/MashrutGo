import json
import logging
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from app.models.shift import DriverShift, LocationSnapshot
from app.models.transport import RouteDirection, RouteWaypoint
from app.schemas.eta import ETAResponse
from app.services.realtime.tracking_service import tracking_service
from app.services.routing.maptiler_adapter import haversine_distance

logger = logging.getLogger(__name__)

EARTH_RADIUS_METERS = 6371000.0
PASS_TOLERANCE_METERS = 80.0  # Vehicle passed stop if along-route distance > stop + 80m


def extract_direction_polyline_coordinates(direction: RouteDirection) -> List[Tuple[float, float]]:
    """
    Extract ordered (lat, lng) pairs representing the route direction's polyline.
    Uses direction.polyline GeoJSON if present, otherwise constructs from origin, waypoints, and destination.
    """
    if direction.polyline:
        try:
            poly_data = json.loads(direction.polyline)
            if isinstance(poly_data, dict) and "coordinates" in poly_data:
                # GeoJSON coordinates are [lng, lat]
                coords = [(pt[1], pt[0]) for pt in poly_data["coordinates"] if len(pt) >= 2]
                if len(coords) >= 2:
                    return coords
        except Exception as e:
            logger.debug(f"Could not parse GeoJSON polyline for direction {direction.id}: {e}")

    # Fallback to origin -> ordered waypoints -> destination
    points = [(direction.origin_lat, direction.origin_lng)]
    for wp in direction.waypoints:
        points.append((wp.lat, wp.lng))
    points.append((direction.destination_lat, direction.destination_lng))
    return points


def project_point_onto_polyline(
    point_lat: float,
    point_lng: float,
    polyline_coords: List[Tuple[float, float]],
) -> Tuple[float, float, float, float]:
    """
    Project a point onto the sequence of line segments forming the polyline.
    Returns:
    - distance_along_route (meters from polyline origin to projected point)
    - perpendicular_distance (meters from point to projected point on segment)
    - projected_lat
    - projected_lng
    """
    if not polyline_coords:
        return 0.0, 0.0, point_lat, point_lng

    if len(polyline_coords) == 1:
        dist = haversine_distance(point_lat, point_lng, polyline_coords[0][0], polyline_coords[0][1])
        return 0.0, dist, polyline_coords[0][0], polyline_coords[0][1]

    # Precalculate cumulative distances at vertices
    cumulative_distances = [0.0]
    for i in range(1, len(polyline_coords)):
        seg_dist = haversine_distance(
            polyline_coords[i - 1][0], polyline_coords[i - 1][1],
            polyline_coords[i][0], polyline_coords[i][1],
        )
        cumulative_distances.append(cumulative_distances[-1] + seg_dist)

    min_perp_dist = float("inf")
    best_along_dist = 0.0
    best_proj_lat = polyline_coords[0][0]
    best_proj_lng = polyline_coords[0][1]

    for i in range(len(polyline_coords) - 1):
        a_lat, a_lng = polyline_coords[i]
        b_lat, b_lng = polyline_coords[i + 1]
        seg_len = haversine_distance(a_lat, a_lng, b_lat, b_lng)
        if seg_len < 1e-4:
            continue

        # Local equirectangular approximation in meters
        mid_lat_rad = math.radians((a_lat + b_lat) / 2.0)
        dx = (b_lng - a_lng) * math.cos(mid_lat_rad) * 111320.0
        dy = (b_lat - a_lat) * 110540.0

        p_dx = (point_lng - a_lng) * math.cos(mid_lat_rad) * 111320.0
        p_dy = (point_lat - a_lat) * 110540.0

        seg_len_sq = dx * dx + dy * dy
        if seg_len_sq <= 0:
            t = 0.0
        else:
            t = (p_dx * dx + p_dy * dy) / seg_len_sq
            t = max(0.0, min(1.0, t))

        # Projected point
        proj_lat = a_lat + t * (b_lat - a_lat)
        proj_lng = a_lng + t * (b_lng - a_lng)
        perp_dist = haversine_distance(point_lat, point_lng, proj_lat, proj_lng)

        if perp_dist < min_perp_dist:
            min_perp_dist = perp_dist
            best_along_dist = cumulative_distances[i] + t * seg_len
            best_proj_lat = proj_lat
            best_proj_lng = proj_lng

    return best_along_dist, min_perp_dist, best_proj_lat, best_proj_lng


class ETAService:
    """
    Map-Matching & Real-time ETA Engine for urban transit vehicles.
    Projects live vehicle positions onto route polylines and computes
    accurate, un-falsified ETAs to boarding stops.
    """

    @classmethod
    def calculate_eta(
        cls,
        route_id: int,
        direction_type: str,
        stop_lat: float,
        stop_lng: float,
        db: Session,
        stop_name: Optional[str] = None,
    ) -> ETAResponse:
        """
        Calculate ETA from live vehicles approaching the specified stop.
        If no vehicle is approaching, returns null without fabricating arrival times.
        """
        # 1. Fetch Route Direction
        direction = (
            db.query(RouteDirection)
            .filter(
                RouteDirection.route_id == route_id,
                RouteDirection.direction_type == direction_type,
            )
            .first()
        )
        if not direction:
            return ETAResponse(
                route_id=route_id,
                direction=direction_type,
                has_approaching_vehicle=False,
                confidence=0.0,
                status="no_approaching_vehicle",
                boarding_stop_name=stop_name,
            )

        # 2. Extract Route Geometry
        polyline = extract_direction_polyline_coordinates(direction)
        if len(polyline) < 2:
            return ETAResponse(
                route_id=route_id,
                direction=direction_type,
                has_approaching_vehicle=False,
                confidence=0.0,
                status="no_approaching_vehicle",
                boarding_stop_name=stop_name,
            )

        # 3. Project Boarding Stop onto Route
        stop_along_dist, stop_perp_dist, _, _ = project_point_onto_polyline(stop_lat, stop_lng, polyline)

        # 4. Gather Live Vehicles (In-Memory Tracking + DB Fallback)
        live_vehicles = tracking_service.get_live_vehicles(
            route_id=route_id,
            direction=direction_type,
            include_stale=False,
        )

        # DB fallback if tracking_service cache is cold
        if not live_vehicles:
            shifts = (
                db.query(DriverShift)
                .filter(
                    DriverShift.route_id == route_id,
                    DriverShift.direction == direction_type,
                    DriverShift.status == "active",
                )
                .all()
            )
            for s in shifts:
                if s.vehicle:
                    latest_snap = (
                        db.query(LocationSnapshot)
                        .filter(LocationSnapshot.vehicle_id == s.vehicle_id)
                        .order_by(LocationSnapshot.id.desc())
                        .first()
                    )
                    if latest_snap:
                        from app.schemas.driver import LiveVehicleStateResponse
                        live_vehicles.append(
                            LiveVehicleStateResponse(
                                vehicle_id=str(s.vehicle.id),
                                internal_id=s.vehicle.internal_id,
                                route_id=route_id,
                                route_number=direction.route.route_number if direction.route else "",
                                direction=direction_type,
                                lat=latest_snap.lat,
                                lng=latest_snap.lng,
                                speed_kmh=latest_snap.speed_kmh,
                                heading=latest_snap.heading,
                                accuracy_meters=latest_snap.accuracy_meters,
                                captured_at=latest_snap.captured_at,
                                is_stale=False,
                                parking_id=None,
                            )
                        )

        if not live_vehicles:
            return ETAResponse(
                route_id=route_id,
                direction=direction_type,
                has_approaching_vehicle=False,
                confidence=0.0,
                status="no_approaching_vehicle",
                boarding_stop_name=stop_name,
            )

        # 5. Evaluate Approaching Vehicles
        approaching_candidates = []
        for veh in live_vehicles:
            veh_along_dist, veh_perp_dist, _, _ = project_point_onto_polyline(veh.lat, veh.lng, polyline)

            # Check if vehicle has already passed the stop
            if veh_along_dist > stop_along_dist + PASS_TOLERANCE_METERS:
                # Vehicle has already passed boarding point on this trip
                continue

            remaining_dist = max(0.0, stop_along_dist - veh_along_dist)

            # Speed smoothing & Dwell calculation
            if veh.parking_id:
                # Vehicle is at terminal parking/stayanka: dwell 180s + nominal 25 km/h
                dwell_seconds = 180
                speed_m_per_s = 25.0 * (1000.0 / 3600.0)
                travel_seconds = remaining_dist / speed_m_per_s
                eta_sec = int(dwell_seconds + travel_seconds)
                confidence = 0.80
                status_str = "in_parking"
                effective_speed = 25.0
            else:
                raw_speed = veh.speed_kmh or 0.0
                if raw_speed >= 10.0:
                    effective_speed = 0.7 * raw_speed + 0.3 * 25.0
                    confidence = 0.95
                else:
                    # Vehicle temporarily stationary at stop or intersection
                    effective_speed = 18.0
                    confidence = 0.85

                speed_m_per_s = effective_speed * (1000.0 / 3600.0)
                eta_sec = int(remaining_dist / speed_m_per_s)
                confidence = confidence
                effective_speed = effective_speed
                if remaining_dist < 80.0:
                    status_str = "arriving_now"
                    eta_sec = max(10, eta_sec)
                else:
                    status_str = "approaching"

            approaching_candidates.append({
                "vehicle_id": getattr(veh, "internal_id", None) or veh.vehicle_id,
                "remaining_meters": int(remaining_dist),
                "eta_seconds": eta_sec,
                "eta_minutes": max(1, math.ceil(eta_sec / 60.0)),
                "confidence": confidence,
                "status": status_str,
                "speed_kmh": round(effective_speed, 1),
            })

        if not approaching_candidates:
            # All online vehicles have already passed the stop!
            # Data integrity: DO NOT RETURN FAKE ETA
            return ETAResponse(
                route_id=route_id,
                direction=direction_type,
                has_approaching_vehicle=False,
                confidence=0.0,
                status="no_approaching_vehicle",
                boarding_stop_name=stop_name,
            )

        # Select the closest approaching vehicle (minimum remaining distance)
        best = min(approaching_candidates, key=lambda c: c["remaining_meters"])

        return ETAResponse(
            route_id=route_id,
            direction=direction_type,
            has_approaching_vehicle=True,
            approaching_vehicle_id=str(best["vehicle_id"]),
            eta_seconds=best["eta_seconds"],
            eta_minutes=best["eta_minutes"],
            distance_meters=best["remaining_meters"],
            speed_kmh=best["speed_kmh"],
            confidence=best["confidence"],
            status=best["status"],
            boarding_stop_name=stop_name,
        )


eta_service = ETAService()
