import json
import uuid
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from app.models.finance import FareRule
from app.models.shift import DriverShift
from app.models.transport import Route, RouteDirection, RouteWaypoint
from app.schemas.routing import (
    CoordinateInput,
    Itinerary,
    ItineraryLeg,
    RouteSearchRequest,
    RouteSearchResponse,
)
from app.services.routing.maptiler_adapter import haversine_distance
from app.services.routing.eta_service import eta_service

WALKING_SPEED_M_PER_MIN = 75.0  # ~4.5 km/h
TRANSIT_SPEED_M_PER_MIN = 500.0  # ~30 km/h
ROAD_CURVATURE_FACTOR = 1.25


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

        # 2. Query all published routes with directions, waypoints, fare rules, and active shifts
        routes = db.query(Route).filter(Route.is_published.is_(True)).all()

        route_directions_data = []
        for route in routes:
            # Determine Fare for this route
            fare_rule = (
                db.query(FareRule)
                .filter(FareRule.route_id == route.id, FareRule.is_active.is_(True))
                .first()
            )
            if not fare_rule:
                fare_rule = (
                    db.query(FareRule)
                    .filter(FareRule.uyushma_id == route.uyushma_id, FareRule.is_active.is_(True))
                    .first()
                )
            base_fare = fare_rule.base_fare_uzs if fare_rule else 2500

            # Check if any driver shift is active for this route
            active_shift = (
                db.query(DriverShift)
                .filter(DriverShift.route_id == route.id, DriverShift.status == "active")
                .first()
            )
            has_live = active_shift is not None
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
                        "has_live": has_live,
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
            live_status="online_vehicles_visible",
        )

        return Itinerary(
            id=f"itin_walk_{uuid.uuid4().hex[:8]}",
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
            live_status="online_vehicles_visible",
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

                        # Calculate transit segment distance & duration
                        transit_dist_m = 0
                        transit_coords = []
                        for s_idx in range(i, j + 1):
                            transit_coords.append([stops[s_idx].lng, stops[s_idx].lat])
                            if s_idx > i:
                                transit_dist_m += int(round(haversine_distance(
                                    stops[s_idx - 1].lat, stops[s_idx - 1].lng,
                                    stops[s_idx].lat, stops[s_idx].lng,
                                ) * ROAD_CURVATURE_FACTOR))

                        transit_duration_mins = max(2, int(round(transit_dist_m / TRANSIT_SPEED_M_PER_MIN)))
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
                                live_status="online_vehicles_visible",
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
                                live_status="online_vehicles_visible",
                            ),
                        ]

                        best_candidate = Itinerary(
                            id=f"itin_direct_{route.route_number}_{uuid.uuid4().hex[:6]}",
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

        # Compare pairs of distinct routes
        for r1_data in route_directions:
            r1: Route = r1_data["route"]
            r1_stops: List[StopPoint] = r1_data["stops"]

            for r2_data in route_directions:
                r2: Route = r2_data["route"]
                if r1.id == r2.id:
                    continue  # Transfer between distinct routes only

                r2_stops: List[StopPoint] = r2_data["stops"]

                # Find optimal boarding on R1 near origin
                best_r1_board_idx = min(
                    range(len(r1_stops) - 1),
                    key=lambda idx: haversine_distance(origin.lat, origin.lng, r1_stops[idx].lat, r1_stops[idx].lng),
                )
                r1_board_stop = r1_stops[best_r1_board_idx]
                walk_to_r1_m = int(round(haversine_distance(origin.lat, origin.lng, r1_board_stop.lat, r1_board_stop.lng) * ROAD_CURVATURE_FACTOR))

                # Find optimal alighting on R2 near destination
                best_r2_alight_idx = min(
                    range(1, len(r2_stops)),
                    key=lambda idx: haversine_distance(r2_stops[idx].lat, r2_stops[idx].lng, destination.lat, destination.lng),
                )
                r2_alight_stop = r2_stops[best_r2_alight_idx]
                walk_from_r2_m = int(round(haversine_distance(r2_alight_stop.lat, r2_alight_stop.lng, destination.lat, destination.lng) * ROAD_CURVATURE_FACTOR))

                # Look for valid transfer stop pair (r1_alight_idx > best_r1_board_idx, r2_board_idx < best_r2_alight_idx)
                for r1_alight_idx in range(best_r1_board_idx + 1, len(r1_stops)):
                    r1_transfer_stop = r1_stops[r1_alight_idx]

                    for r2_board_idx in range(0, best_r2_alight_idx):
                        r2_transfer_stop = r2_stops[r2_board_idx]

                        transfer_walk_m = int(round(haversine_distance(
                            r1_transfer_stop.lat, r1_transfer_stop.lng,
                            r2_transfer_stop.lat, r2_transfer_stop.lng,
                        ) * ROAD_CURVATURE_FACTOR))

                        # Allow transfer walk up to 1000 meters
                        if transfer_walk_m <= 1000:
                            # Calculate transit distances
                            r1_dist_m = int(round(haversine_distance(r1_board_stop.lat, r1_board_stop.lng, r1_transfer_stop.lat, r1_transfer_stop.lng) * ROAD_CURVATURE_FACTOR))
                            r2_dist_m = int(round(haversine_distance(r2_transfer_stop.lat, r2_transfer_stop.lng, r2_alight_stop.lat, r2_alight_stop.lng) * ROAD_CURVATURE_FACTOR))

                            r1_transit_mins = max(2, int(round(r1_dist_m / TRANSIT_SPEED_M_PER_MIN)))
                            r2_transit_mins = max(2, int(round(r2_dist_m / TRANSIT_SPEED_M_PER_MIN)))
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
                                    live_status="online_vehicles_visible",
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
                                    stops_count=r1_alight_idx - best_r1_board_idx,
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
                                    live_status="online_vehicles_visible",
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
                                    stops_count=best_r2_alight_idx - r2_board_idx,
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
                                    live_status="online_vehicles_visible",
                                ),
                            ]

                            itin = Itinerary(
                                id=f"itin_xfer_{r1.route_number}_{r2.route_number}_{uuid.uuid4().hex[:6]}",
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
            it.mode_tags = sorted(list(tags))

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

        # Sort all candidates by selected user preference mode
        pref_mode = preferences.mode if preferences and preferences.mode else "fastest"
        if pref_mode == "cheapest":
            sorted_itineraries = sorted(candidates, key=lambda it: (it.total_fare_uzs, it.total_duration_minutes))
        elif pref_mode == "least_walking":
            sorted_itineraries = sorted(candidates, key=lambda it: (it.walking_distance_meters, it.total_duration_minutes))
        elif pref_mode == "least_transfers":
            sorted_itineraries = sorted(candidates, key=lambda it: (it.transfers_count, it.total_duration_minutes))
        else:
            sorted_itineraries = sorted(candidates, key=lambda it: (it.total_duration_minutes, it.transfers_count))

        return recommended, sorted_itineraries
