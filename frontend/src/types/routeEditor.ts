// ── Visual Route Editor (Stage 5) ──
// Backend DTOs mirror backend/app/schemas/route.py; editor state is what the page edits.

export type DirectionType = 'outbound' | 'inbound'

/** [lng, lat] — GeoJSON / MapLibre order. */
export type LngLat = [number, number]

export interface LineStringGeometry {
  type: 'LineString'
  coordinates: LngLat[]
}

// ---------------------------------------------------------------- backend DTOs

export interface WaypointDto {
  id: number
  route_direction_id: number
  order: number
  name: string | null
  lat: number
  lng: number
  is_stop: boolean
  created_at: string
}

export interface RouteDirectionDto {
  id: number
  route_id: number
  direction_type: DirectionType
  origin_name: string
  destination_name: string
  origin_lat: number
  origin_lng: number
  destination_lat: number
  destination_lng: number
  /** GeoJSON LineString serialized as a JSON string, or null when no geometry was saved. */
  polyline: string | null
  distance_meters: number
  duration_seconds: number
  waypoints: WaypointDto[]
  created_at: string
  updated_at: string
}

export interface RouteDto {
  id: number
  uyushma_id: number
  route_number: string
  name: string
  description: string | null
  is_published: boolean
  is_archived: boolean
  directions: RouteDirectionDto[]
  created_at: string
  updated_at: string
}

export interface RouteDetailDto extends RouteDto {
  uyushma_name: string
  fare_uzs: number | null
  online_vehicles_count: number
}

export interface RouteCreateRequest {
  route_number: string
  name: string
  description: string | null
  /** Required for the Super Admin; Uyushma admins are always forced to their own tenant. */
  uyushma_id: number | null
}

export interface RouteUpdateRequest {
  route_number?: string
  name?: string
  description?: string | null
}

export interface LatLngDto {
  lat: number
  lng: number
}

export interface AutoPathRequest {
  origin: LatLngDto
  destination: LatLngDto
  waypoints: LatLngDto[]
  profile: 'driving'
}

export interface AutoPathResponse {
  distance_meters: number
  duration_seconds: number
  geojson: Record<string, unknown>
  polyline: string
  provider: string
  /** Set when the backend used the straight-line "geodesic" fallback instead of a road router. */
  warning: string | null
}

export interface WaypointSaveDto {
  name: string | null
  lat: number
  lng: number
  is_stop: boolean
}

export interface DirectionSaveRequest {
  origin_name: string
  destination_name: string
  origin_lat: number
  origin_lng: number
  destination_lat: number
  destination_lng: number
  waypoints: WaypointSaveDto[]
  geojson: LineStringGeometry
  distance_meters: number
  duration_seconds: number
}

// ---------------------------------------------------------------- editor state

export interface EditorPoint {
  name: string
  coordinates: LngLat
}

export interface EditorWaypoint {
  /** Stable client-side key (backend ids change on every save). */
  key: string
  /** Backend id of the loaded waypoint, null for waypoints added in this session. */
  id: number | null
  name: string
  coordinates: LngLat
  /** true = passenger stop, false = shaping point that only bends the road path. */
  isStop: boolean
}

export interface RoutePreview {
  geometry: LineStringGeometry
  distanceMeters: number
  durationSeconds: number
  /** Routing provider that produced the geometry (null for geometry loaded from the database). */
  provider: string | null
  warning: string | null
  /** `pointsKey` of the A → waypoints → B sequence this geometry was computed for. */
  pointsKey: string
}

export interface DirectionEditorState {
  direction: DirectionType
  /** Whether the direction exists on the backend. */
  saved: boolean
  origin: EditorPoint | null
  destination: EditorPoint | null
  waypoints: EditorWaypoint[]
  preview: RoutePreview | null
}

export type DirectionPair = Record<DirectionType, DirectionEditorState>

export interface RouteMetaState {
  routeNumber: string
  name: string
  description: string
}

export interface RouteEditorModel {
  id: number
  uyushmaId: number
  uyushmaName: string
  isPublished: boolean
  isArchived: boolean
  meta: RouteMetaState
  directions: DirectionPair
}
