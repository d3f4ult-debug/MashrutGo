// ── Visual Route Editor Types (Stage 5) ──

export interface RoutePoint {
  name: string;
  coordinates: [number, number]; // [lng, lat]
}

export interface RouteWaypoint {
  id: string;
  name: string;
  coordinates: [number, number]; // [lng, lat]
  order: number;
}

export interface DirectionEditorState {
  direction: 'outbound' | 'inbound';
  startPoint: RoutePoint | null;
  endPoint: RoutePoint | null;
  waypoints: RouteWaypoint[];
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  } | null;
  distanceKm: number;
  durationMin: number;
  isDirty: boolean;
}

export interface RouteDraft {
  routeId: string;
  routeNumber: string;
  routeName: string;
  description: string;
  status: 'draft' | 'published';
  outbound: DirectionEditorState;
  inbound: DirectionEditorState;
}

export interface CalculatePathRequest {
  origin: [number, number];
  destination: [number, number];
  waypoints: [number, number][];
}

export interface CalculatePathResponse {
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  distance_km: number;
  duration_min: number;
}
