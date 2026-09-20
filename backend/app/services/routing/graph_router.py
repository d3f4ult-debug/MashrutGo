import json
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session, selectinload

from app.models.transport import Route, RouteDirection
from app.schemas.routing import (
    CoordinateInput,
    Itinerary,
    ItineraryLeg,
    RouteSearchRequest,
    RouteSearchResponse,
)
from app.services.fare_engine import quote_fare
from app.services.realtime.tracking_service import tracking_service
from app.services.routing.eta_service import (
    eta_service,
    extract_direction_polyline_coordinates,
    project_point_onto_polyline,
)
from app.services.routing.maptiler_adapter import haversine_distance

WALKING_SPEED_M_PER_MIN = 75.0  # ~4.5 km/h
TRANSIT_SPEED_M_PER_MIN = 400.0  # ~24 km/h urban average incl. stops
ROAD_CURVATURE_FACTOR = 1.25

# Passengers do walk to reach transit -- the product deliberately allows 1-3 km and always keeps
# the walking-only baseline -- but a line whose nearest stop is further away than this cannot be
# one half of a sensible transfer plan.
TRANSFER_ACCESS_WALK_LIMIT_METERS = 3000.0
# The transfer search compares pairs of lines, so its cost is quadratic in how many lines it
# considers. Ranking lines by how close they come to the origin (resp. the destination) and
# keeping the nearest few turns an all-pairs scan over every line in the city into a scan over
# the handful that could plausibly serve this trip, without dropping a plan a passenger would
# actually pick.
MAX_TRANSFER_ENDPOINT_CANDIDATES = 12
# A journey planner answers with a shortlist. Returning every candidate it generated produced a
# 25 MB response in a 60-route city; the four recommended plans are always kept.
MAX_ITINERARIES = 15


class StopPoint:
    def __init__(self, name: str, lat: float, lng: float, order: int, is_stop: bool = True):
        self.name = name
        self.lat = lat
        self.lng = lng
        self.order = order
        self.is_stop = is_stop


class GraphRouter:
    """
    Multi-modal graph routing engine supporting walking connectors,
    transit segments, transfers, live vehicle awareness, and multi-criteria optimization.
    """

    @classmethod
    def search(cls, db: Session, request: RouteSearchRequest) -> RouteSearchResponse:
        origin = request.origin
        destination = request.destination
        preferences = request.preferences

        # 1. Direct Walking-only Itinerary (Always valid baseline, 0 UZS fare)
        walking_itinerary = cls._build_direct_walking_itinerary(origin, destination)
        candidates: List[Itinerary] = [walking_itinerary]

        # 2. Published routes with directions, waypoints, fare quotes and live vehicle status
        # Eager-load directions and their waypoints: lazy loading here is ~14 queries per route
        routes = (
            db.query(Route)
            .options(selectinload(Route.directions).selectinload(RouteDirection.waypoints))
            .filter(Route.is_published.is_(True), Route.is_archived.is_(False))
            .all()
        )
        fare_cache: Dict[Tuple[int, int], object] = {}

        route_directions_data = []
        for route in routes:
            # Fare from the Uyushma's tariff engine; unknown fares are flagged, never invented
            cache_key = (route.uyushma_id, route.id)
            if cache_key not in fare_cache:
                fare_cache[cache_key] = quote_fare(db, route.uyushma_id, route.id)
            quote = fare_cache[cache_key]
            base_fare = quote.amount_uzs if quote else 0

            online_count = tracking_service.online_count(route.id)
            has_live = online_count > 0
            # Without live data we cannot know the wait: use a conservative planning buffer
            wait_time_mins = 5 if has_live else 10
            live_status = "online_vehicles_visible" if has_live else "no_online_vehicle_visible"
            confidence = 0.95 if has_live else 0.50

            for direction in route.directions:
                stops = cls._extract_direction_stops(direction)
                if len(stops) >= 2:
                    route_directions_data.append({
                        "route": route,
                        "direction": direction,
                        "stops": stops,
                        "fare_uzs": base_fare,
                        "fare_known": quote is not None,
                        "has_live": has_live,
                        "online_count": online_count,
                        "wait_time_mins": wait_time_mins,
                        "live_status": live_status,
                        "confidence": confidence,
                    })

        # 3. Direct Transit Itineraries (0 transfers)
        direct_transit = cls._find_direct_transit_itineraries(origin, destination, route_directions_data, db)
        candidates.extend(direct_transit)

        # 4. 1-Transfer Transit Itineraries
        transfer_transit = cls._find_transfer_transit_itineraries(origin, destination, route_directions_data, db)
        candidates.extend(transfer_transit)

        # 5. Multi-criteria Evaluation & Ranking
        recommended, ranked_itineraries = cls._evaluate_multi_criteria(candidates, preferences)

        return RouteSearchResponse(
            origin=origin,
            destination=destination,
            recommended=recommended,
            itineraries=ranked_itineraries,
        )

    @staticmethod
    def _extract_direction_stops(direction: RouteDirection) -> List[StopPoint]:
        """Convert origin, ordered waypoints, and destination into a unified stop sequence."""
        stops = [
            StopPoint(name=direction.origin_name, lat=direction.origin_lat, lng=direction.origin_lng, order=0)
        ]
        for wp in direction.waypoints:
            stops.append(StopPoint(name=wp.name or f"Bekat {wp.order}", lat=wp.lat, lng=wp.lng, order=wp.order, is_stop=wp.is_stop))
        stops.append(
            StopPoint(
                name=direction.destination_name,
                lat=direction.destination_lat,
                lng=direction.destination_lng,
                order=len(stops),
            )
        )
        return stops

    @staticmethod
    def _transit_speed(direction: RouteDirection) -> float:
        """Metres per minute: the direction's own average (from the routing provider) or ~24 km/h."""
        if direction.distance_meters and direction.duration_seconds:
            speed = direction.distance_meters / (direction.duration_seconds / 60.0)
            if 150.0 <= speed <= 1000.0:
                return speed
        return TRANSIT_SPEED_M_PER_MIN

    @staticmethod
    def _nearest_stop(
        stops: List["StopPoint"],
        lat: float,
        lng: float,
        indices: range,
    ) -> Tuple[int, float]:
        """Index of the stop within `indices` closest to (lat, lng), and the walk to it in metres."""
        best_idx = min(indices, key=lambda i: haversine_distance(lat, lng, stops[i].lat, stops[i].lng))
        walk_m = haversine_distance(lat, lng, stops[best_idx].lat, stops[best_idx].lng) * ROAD_CURVATURE_FACTOR
        return best_idx, walk_m

    @staticmethod
    def _transit_segment(
        direction: RouteDirection,
        stops: List["StopPoint"],
        board_idx: int,
        alight_idx: int,
    ) -> Tuple[List[List[float]], int]:
        """
        Coordinates ([lng, lat]) and length of the ride between two stops, cut out of the
        direction's road geometry. Falls back to the stop chain when no geometry is stored.
        """
        polyline = extract_direction_polyline_coordinates(direction)
        board, alight = stops[board_idx], stops[alight_idx]
        if len(polyline) >= 2:
            start_along, _, s_lat, s_lng = project_point_onto_polyline(board.lat, board.lng, polyline)
            end_along, _, e_lat, e_lng = project_point_onto_polyline(alight.lat, alight.lng, polyline)
            if end_along > start_along:
                coords: List[List[float]] = [[s_lng, s_lat]]
                travelled = 0.0
                for k in range(1, len(polyline)):
                    seg = haversine_distance(polyline[k - 1][0], polyline[k - 1][1], polyline[k][0], polyline[k][1])
                    travelled += seg
                    if start_along < travelled < end_along:
                        coords.append([polyline[k][1], polyline[k][0]])
                coords.append([e_lng, e_lat])
                return coords, int(round(end_along - start_along))

        coords = []
        dist = 0.0
        for idx in range(board_idx, alight_idx + 1):
            coords.append([stops[idx].lng, stops[idx].lat])
            if idx > board_idx:
                dist += haversine_distance(stops[idx - 1].lat, stops[idx - 1].lng, stops[idx].lat, stops[idx].lng) * ROAD_CURVATURE_FACTOR
        return coords, int(round(dist))

    @classmethod
    def _build_direct_walking_itinerary(
        cls,
        origin: CoordinateInput,
        destination: CoordinateInput,
    ) -> Itinerary:
        """Construct direct walking itinerary connecting origin to destination."""
        dist_m = int(round(haversine_distance(origin.lat, origin.lng, destination.lat, destination.lng) * ROAD_CURVATURE_FACTOR))
        duration_mins = max(1, int(round(dist_m / WALKING_SPEED_M_PER_MIN)))

        leg = ItineraryLeg(
            leg_type="walking",
            origin_name=origin.name or "Boshlang'ich nuqta",
            origin_coord=origin,
            destination_name=destination.name or "Yetib borish manzili",
            destination_coord=destination,
            distance_meters=dist_m,
            duration_minutes=duration_mins,
            fare_uzs=0,
            polyline=json.dumps({
                "type": "LineString",
                "coordinates": [[origin.lng, origin.lat], [destination.lng, destination.lat]],
            }),
            live_status=None,
        )

        return Itinerary(
            id="itin_walk",
            mode_classification="cheapest",
            mode_tags=["cheapest", "least_transfers"],
            total_duration_minutes=duration_mins,
            total_distance_meters=dist_m,
            walking_distance_meters=dist_m,
            walking_duration_minutes=duration_mins,
            transit_duration_minutes=0,
            wait_duration_minutes=0,
            transfers_count=0,
            total_fare_uzs=0,
            live_status="not_applicable",
            live_confidence=1.0,
            legs=[leg],
        )

    @classmethod
    def _find_direct_transit_itineraries(
        cls,
        origin: CoordinateInput,
        destination: CoordinateInput,
        route_directions: List[Dict[str, Any]],
        db: Session,
    ) -> List[Itinerary]:
        """Find single-vehicle transit routes with walking connectors."""
        results = []

        direct_walk_dist = haversine_distance(origin.lat, origin.lng, destination.lat, destination.lng)

        for item in route_directions:
            stops: List[StopPoint] = item["stops"]
            route: Route = item["route"]
            direction: RouteDirection = item["direction"]
            fare_uzs = item["fare_uzs"]
            wait_mins = item["wait_time_mins"]
            live_status = item["live_status"]
            confidence = item["confidence"]

            best_candidate = None
            best_walking = float("inf")

            # Evaluate every stop pair (board_idx < alight_idx)
            for i in range(len(stops)):
                board_stop = stops[i]
                walk_to_board_m = int(round(haversine_distance(origin.lat, origin.lng, board_stop.lat, board_stop.lng) * ROAD_CURVATURE_FACTOR))

                for j in range(i + 1, len(stops)):
                    alight_stop = stops[j]
                    walk_from_alight_m = int(round(haversine_distance(alight_stop.lat, alight_stop.lng, destination.lat, destination.lng) * ROAD_CURVATURE_FACTOR))

                    total_walk_m = walk_to_board_m + walk_from_alight_m

                    # Only consider if transit actually takes the passenger closer than pure walking
                    if total_walk_m < direct_walk_dist * 1.5 and total_walk_m < best_walking:
                        best_walking = total_walk_m

                        # Transit segment follows the stored road geometry of the direction
                        transit_coords, transit_dist_m = cls._transit_segment(direction, stops, i, j)
                        transit_duration_mins = max(2, int(round(transit_dist_m / cls._transit_speed(direction))))
                        walk_to_board_mins = int(round(walk_to_board_m / WALKING_SPEED_M_PER_MIN))
                        walk_from_alight_mins = int(round(walk_from_alight_m / WALKING_SPEED_M_PER_MIN))

                        # Map-matched ETA from live approaching vehicles
                        eta = eta_service.calculate_eta(
                            route_id=route.id,
                            direction_type=direction.direction_type,
                            stop_lat=board_stop.lat,
                            stop_lng=board_stop.lng,
                            db=db,
                            stop_name=board_stop.name,
                            direction=direction,
                        )
                        if eta.has_approaching_vehicle:
                            actual_wait_mins = max(1, eta.eta_minutes or 1)
                            actual_live_status = "online_vehicles_visible"
                            actual_confidence = max(confidence, eta.confidence)
                        else:
                            actual_wait_mins = wait_mins
                            actual_live_status = live_status
                            actual_confidence = confidence

                        total_duration_mins = walk_to_board_mins + actual_wait_mins + transit_duration_mins + walk_from_alight_mins

                        legs = [
                            ItineraryLeg(
                                leg_type="walking",
                                origin_name=origin.name or "Boshlang'ich nuqta",
                                origin_coord=origin,
                                destination_name=board_stop.name,
                                destination_coord=CoordinateInput(lat=board_stop.lat, lng=board_stop.lng, name=board_stop.name),
                                distance_meters=walk_to_board_m,
                                duration_minutes=walk_to_board_mins,
                                fare_uzs=0,
                                polyline=json.dumps({
                                    "type": "LineString",
                                    "coordinates": [[origin.lng, origin.lat], [board_stop.lng, board_stop.lat]],
                                }),
                                live_status=None,
                            ),
                            ItineraryLeg(
                                leg_type="transit",
                                route_id=route.id,
                                route_number=route.route_number,
                                route_name=route.name,
                                direction_type=direction.direction_type,
                                origin_name=board_stop.name,
                                origin_coord=CoordinateInput(lat=board_stop.lat, lng=board_stop.lng, name=board_stop.name),
                                destination_name=alight_stop.name,
                                destination_coord=CoordinateInput(lat=alight_stop.lat, lng=alight_stop.lng, name=alight_stop.name),
                                distance_meters=transit_dist_m,
                                duration_minutes=transit_duration_mins,
                                fare_uzs=fare_uzs,
                                fare_known=item["fare_known"],
                                stops_count=j - i,
                                polyline=json.dumps({"type": "LineString", "coordinates": transit_coords}),
                                live_status=actual_live_status,
                            ),
                            ItineraryLeg(
                                leg_type="walking",
                                origin_name=alight_stop.name,
                                origin_coord=CoordinateInput(lat=alight_stop.lat, lng=alight_stop.lng, name=alight_stop.name),
                                destination_name=destination.name or "Yetib borish manzili",
                                destination_coord=destination,
                                distance_meters=walk_from_alight_m,
                                duration_minutes=walk_from_alight_mins,
                                fare_uzs=0,
                                polyline=json.dumps({
                                    "type": "LineString",
                                    "coordinates": [[alight_stop.lng, alight_stop.lat], [destination.lng, destination.lat]],
                                }),
                                live_status=None,
                            ),
                        ]

                        best_candidate = Itinerary(
                            id=f"itin_direct_{route.id}_{direction.direction_type}_{i}_{j}",
                            mode_classification="fastest",
                            mode_tags=["least_transfers"],
                            total_duration_minutes=total_duration_mins,
                            total_distance_meters=walk_to_board_m + transit_dist_m + walk_from_alight_m,
                            walking_distance_meters=total_walk_m,
                            walking_duration_minutes=walk_to_board_mins + walk_from_alight_mins,
                            transit_duration_minutes=transit_duration_mins,
                            wait_duration_minutes=actual_wait_mins,
                            transfers_count=0,
                            total_fare_uzs=fare_uzs,
                            fare_known=item["fare_known"],
                            online_vehicles_count=item["online_count"],
                            live_status=actual_live_status,
                            live_confidence=actual_confidence,
                            legs=legs,
                        )

            if best_candidate:
                results.append(best_candidate)

        return results

    @classmethod
    def _find_transfer_transit_itineraries(
        cls,
        origin: CoordinateInput,
        destination: CoordinateInput,
        route_directions: List[Dict[str, Any]],
        db: Session,
    ) -> List[Itinerary]:
        """Find 2-vehicle transit routes with 1 transfer between lines."""
        results = []

        # Which line the passenger boards depends only on the origin, and where they alight only
        # on the destination -- so both are resolved once per line instead of once per pair, and
        # only the nearest few lines on each side enter the pairing below.
        origin_side: List[Tuple[float, Dict[str, Any], int]] = []
        dest_side: List[Tuple[float, Dict[str, Any], int]] = []
        for data in route_directions:
            stops: List[StopPoint] = data["stops"]
            board_idx, board_walk_m = cls._nearest_stop(stops, origin.lat, origin.lng, range(len(stops) - 1))
            if board_walk_m <= TRANSFER_ACCESS_WALK_LIMIT_METERS:
                origin_side.append((board_walk_m, data, board_idx))
            alight_idx, alight_walk_m = cls._nearest_stop(stops, destination.lat, destination.lng, range(1, len(stops)))
            if alight_walk_m <= TRANSFER_ACCESS_WALK_LIMIT_METERS:
                dest_side.append((alight_walk_m, data, alight_idx))

        origin_side.sort(key=lambda entry: entry[0])
        dest_side.sort(key=lambda entry: entry[0])
        del origin_side[MAX_TRANSFER_ENDPOINT_CANDIDATES:]
        del dest_side[MAX_TRANSFER_ENDPOINT_CANDIDATES:]

        # Compare pairs of distinct routes
        for walk_to_r1_raw, r1_data, best_r1_board_idx in origin_side:
            r1: Route = r1_data["route"]
            r1_stops: List[StopPoint] = r1_data["stops"]
            r1_board_stop = r1_stops[best_r1_board_idx]
            walk_to_r1_m = int(round(walk_to_r1_raw))

            for walk_from_r2_raw, r2_data, best_r2_alight_idx in dest_side:
                r2: Route = r2_data["route"]
                if r1.id == r2.id:
                    continue  # Transfer between distinct routes only

                r2_stops: List[StopPoint] = r2_data["stops"]
                r2_alight_stop = r2_stops[best_r2_alight_idx]
                walk_from_r2_m = int(round(walk_from_r2_raw))

                # Look for valid transfer stop pair (r1_alight_idx > best_r1_board_idx, r2_board_idx < best_r2_alight_idx)
                for r1_alight_idx in range(best_r1_board_idx + 1, len(r1_stops)):
                    r1_transfer_stop = r1_stops[r1_alight_idx]

                    for r2_board_idx in range(best_r2_alight_idx):
                        r2_transfer_stop = r2_stops[r2_board_idx]

                        transfer_walk_m = int(round(haversine_distance(
                            r1_transfer_stop.lat, r1_transfer_stop.lng,
                            r2_transfer_stop.lat, r2_transfer_stop.lng,
                        ) * ROAD_CURVATURE_FACTOR))

                        # Allow transfer walk up to 1000 meters
                        if transfer_walk_m <= 1000:
                            # Calculate transit distances
                            r1_coords, r1_dist_m = cls._transit_segment(r1_data["direction"], r1_stops, best_r1_board_idx, r1_alight_idx)
                            r2_coords, r2_dist_m = cls._transit_segment(r2_data["direction"], r2_stops, r2_board_idx, best_r2_alight_idx)

                            r1_transit_mins = max(2, int(round(r1_dist_m / cls._transit_speed(r1_data["direction"]))))
                            r2_transit_mins = max(2, int(round(r2_dist_m / cls._transit_speed(r2_data["direction"]))))
                            transfer_walk_mins = int(round(transfer_walk_m / WALKING_SPEED_M_PER_MIN))
                            walk_to_r1_mins = int(round(walk_to_r1_m / WALKING_SPEED_M_PER_MIN))
                            walk_from_r2_mins = int(round(walk_from_r2_m / WALKING_SPEED_M_PER_MIN))

                            # ETA for first leg
                            eta1 = eta_service.calculate_eta(
                                route_id=r1.id,
                                direction_type=r1_data["direction"].direction_type,
                                stop_lat=r1_board_stop.lat,
                                stop_lng=r1_board_stop.lng,
                                db=db,
                                stop_name=r1_board_stop.name,
                                direction=r1_data["direction"],
                            )
                            if eta1.has_approaching_vehicle:
                                actual_r1_wait = max(1, eta1.eta_minutes or 1)
                                r1_live_status = "online_vehicles_visible"
                                r1_conf = max(r1_data["confidence"], eta1.confidence)
                            else:
                                actual_r1_wait = r1_data["wait_time_mins"]
                                r1_live_status = r1_data["live_status"]
                                r1_conf = r1_data["confidence"]

                            total_wait_mins = actual_r1_wait + r2_data["wait_time_mins"]
                            total_walk_m = walk_to_r1_m + transfer_walk_m + walk_from_r2_m
                            total_duration_mins = (
                                walk_to_r1_mins + actual_r1_wait + r1_transit_mins
                                + transfer_walk_mins + r2_data["wait_time_mins"] + r2_transit_mins
                                + walk_from_r2_mins
                            )

                            has_live_both = (r1_live_status == "online_vehicles_visible") and r2_data["has_live"]
                            overall_live_status = "online_vehicles_visible" if has_live_both else "no_online_vehicle_visible"
                            overall_confidence = min(r1_conf, r2_data["confidence"])

                            legs = [
                                ItineraryLeg(
                                    leg_type="walking",
                                    origin_name=origin.name or "Boshlang'ich nuqta",
                                    origin_coord=origin,
                                    destination_name=r1_board_stop.name,
                                    destination_coord=CoordinateInput(lat=r1_board_stop.lat, lng=r1_board_stop.lng, name=r1_board_stop.name),
                                    distance_meters=walk_to_r1_m,
                                    duration_minutes=walk_to_r1_mins,
                                    fare_uzs=0,
                                    live_status=None,
                                ),
                                ItineraryLeg(
                                    leg_type="transit",
                                    route_id=r1.id,
                                    route_number=r1.route_number,
                                    route_name=r1.name,
                                    direction_type=r1_data["direction"].direction_type,
                                    origin_name=r1_board_stop.name,
                                    origin_coord=CoordinateInput(lat=r1_board_stop.lat, lng=r1_board_stop.lng, name=r1_board_stop.name),
                                    destination_name=r1_transfer_stop.name,
                                    destination_coord=CoordinateInput(lat=r1_transfer_stop.lat, lng=r1_transfer_stop.lng, name=r1_transfer_stop.name),
                                    distance_meters=r1_dist_m,
                                    duration_minutes=r1_transit_mins,
                                    fare_uzs=r1_data["fare_uzs"],
                                    fare_known=r1_data["fare_known"],
                                    stops_count=r1_alight_idx - best_r1_board_idx,
                                    polyline=json.dumps({"type": "LineString", "coordinates": r1_coords}),
                                    live_status=r1_live_status,
                                ),
                                ItineraryLeg(
                                    leg_type="walking",
                                    origin_name=r1_transfer_stop.name,
                                    origin_coord=CoordinateInput(lat=r1_transfer_stop.lat, lng=r1_transfer_stop.lng, name=r1_transfer_stop.name),
                                    destination_name=r2_transfer_stop.name,
                                    destination_coord=CoordinateInput(lat=r2_transfer_stop.lat, lng=r2_transfer_stop.lng, name=r2_transfer_stop.name),
                                    distance_meters=transfer_walk_m,
                                    duration_minutes=transfer_walk_mins,
                                    fare_uzs=0,
                                    live_status=None,
                                ),
                                ItineraryLeg(
                                    leg_type="transit",
                                    route_id=r2.id,
                                    route_number=r2.route_number,
                                    route_name=r2.name,
                                    direction_type=r2_data["direction"].direction_type,
                                    origin_name=r2_transfer_stop.name,
                                    origin_coord=CoordinateInput(lat=r2_transfer_stop.lat, lng=r2_transfer_stop.lng, name=r2_transfer_stop.name),
                                    destination_name=r2_alight_stop.name,
                                    destination_coord=CoordinateInput(lat=r2_alight_stop.lat, lng=r2_alight_stop.lng, name=r2_alight_stop.name),
                                    distance_meters=r2_dist_m,
                                    duration_minutes=r2_transit_mins,
                                    fare_uzs=r2_data["fare_uzs"],
                                    fare_known=r2_data["fare_known"],
                                    stops_count=best_r2_alight_idx - r2_board_idx,
                                    polyline=json.dumps({"type": "LineString", "coordinates": r2_coords}),
                                    live_status=r2_data["live_status"],
                                ),
                                ItineraryLeg(
                                    leg_type="walking",
                                    origin_name=r2_alight_stop.name,
                                    origin_coord=CoordinateInput(lat=r2_alight_stop.lat, lng=r2_alight_stop.lng, name=r2_alight_stop.name),
                                    destination_name=destination.name or "Yetib borish manzili",
                                    destination_coord=destination,
                                    distance_meters=walk_from_r2_m,
                                    duration_minutes=walk_from_r2_mins,
                                    fare_uzs=0,
                                    live_status=None,
                                ),
                            ]

                            itin = Itinerary(
                                id=f"itin_xfer_{r1.id}{r1_data['direction'].direction_type[0]}_{r2.id}{r2_data['direction'].direction_type[0]}_{best_r1_board_idx}_{r1_alight_idx}_{r2_board_idx}_{best_r2_alight_idx}",
                                mode_classification="balanced",
                                mode_tags=["transfer"],
                                total_duration_minutes=total_duration_mins,
                                total_distance_meters=total_walk_m + r1_dist_m + r2_dist_m,
                                walking_distance_meters=total_walk_m,
                                walking_duration_minutes=walk_to_r1_mins + transfer_walk_mins + walk_from_r2_mins,
                                transit_duration_minutes=r1_transit_mins + r2_transit_mins,
                                wait_duration_minutes=total_wait_mins,
                                transfers_count=1,
                                total_fare_uzs=r1_data["fare_uzs"] + r2_data["fare_uzs"],
                                fare_known=r1_data["fare_known"] and r2_data["fare_known"],
                                online_vehicles_count=min(r1_data["online_count"], r2_data["online_count"]),
                                live_status=overall_live_status,
                                live_confidence=overall_confidence,
                                legs=legs,
                            )
                            results.append(itin)
                            break  # Found best transfer pair between r1 and r2

        return results

    @classmethod
    def _evaluate_multi_criteria(
        cls,
        candidates: List[Itinerary],
        preferences: Optional[Any] = None,
    ) -> Tuple[Dict[str, Itinerary], List[Itinerary]]:
        """Identify best candidates for each optimization mode and sort overall list."""
        if not candidates:
            return {}, []

        # Find best for each criterion
        fastest_itin = min(candidates, key=lambda it: it.total_duration_minutes)
        cheapest_itin = min(candidates, key=lambda it: (it.total_fare_uzs, it.total_duration_minutes))
        least_walking_itin = min(candidates, key=lambda it: (it.walking_distance_meters, it.total_duration_minutes))
        least_transfers_itin = min(candidates, key=lambda it: (it.transfers_count, it.total_duration_minutes))

        # Assign mode tags
        for it in candidates:
            tags = set(it.mode_tags)
            if it.id == fastest_itin.id:
                tags.add("fastest")
            if it.id == cheapest_itin.id:
                tags.add("cheapest")
            if it.id == least_walking_itin.id:
                tags.add("least_walking")
            if it.id == least_transfers_itin.id:
                tags.add("least_transfers")
            it.mode_tags = sorted(tags)

        # Determine primary classification for recommendation
        fastest_itin.mode_classification = "fastest"
        cheapest_itin.mode_classification = "cheapest"
        least_walking_itin.mode_classification = "least_walking"
        least_transfers_itin.mode_classification = "least_transfers"

        recommended = {
            "fastest": fastest_itin,
            "cheapest": cheapest_itin,
            "least_walking": least_walking_itin,
            "least_transfers": least_transfers_itin,
        }

        # Sort all candidates by selected user preference mode. Overlapping lines routinely tie on
        # the headline criterion, so every ordering falls through to the same chain -- fewer
        # transfers, less walking, cheaper -- and finally to the (deterministic) itinerary id, so
        # identical input always produces identical output.
        def tie_break(it: Itinerary) -> Tuple[Any, ...]:
            return (it.transfers_count, it.walking_distance_meters, it.total_fare_uzs, it.id)

        pref_mode = preferences.mode if preferences and preferences.mode else "fastest"
        sort_keys = {
            "cheapest": lambda it: (it.total_fare_uzs, it.total_duration_minutes, *tie_break(it)),
            "least_walking": lambda it: (it.walking_distance_meters, it.total_duration_minutes, *tie_break(it)),
            "least_transfers": lambda it: (it.transfers_count, it.total_duration_minutes, *tie_break(it)),
        }
        sort_key = sort_keys.get(pref_mode, lambda it: (it.total_duration_minutes, *tie_break(it)))
        sorted_itineraries = sorted(candidates, key=sort_key)

        # Answer with a shortlist. Every candidate the search generated is a valid plan, but a
        # passenger chooses from a handful and the full set costs megabytes on a phone connection.
        # The four recommended plans are kept even when they fall outside the top slice.
        if len(sorted_itineraries) > MAX_ITINERARIES:
            shortlist = sorted_itineraries[:MAX_ITINERARIES]
            shown = {it.id for it in shortlist}
            for best in recommended.values():
                if best.id not in shown:
                    shortlist.append(best)
                    shown.add(best.id)
            sorted_itineraries = sorted(shortlist, key=sort_key)

        return recommended, sorted_itineraries
