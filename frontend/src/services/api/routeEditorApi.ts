// Visual Route Editor API (backend/app/api/v1/routes.py) + pure DTO <-> editor-state mappers.
// Geometry always comes from the backend routing provider (POST /routes/editor/auto-path) or from
// the saved direction; the frontend never invents road geometry.
import { apiClient } from './client'
import type {
  AutoPathRequest,
  AutoPathResponse,
  DirectionEditorState,
  DirectionSaveRequest,
  DirectionType,
  EditorWaypoint,
  LineStringGeometry,
  LngLat,
  RouteCreateRequest,
  RouteDetailDto,
  RouteDirectionDto,
  RouteDto,
  RouteEditorModel,
  RouteMetaState,
  RoutePreview,
  RouteUpdateRequest,
} from '../../types/routeEditor'

/** Backend limits (schemas/route.py). */
export const EDITOR_LIMITS = {
  /** AutoPathRequest.waypoints max_length (DirectionSaveRequest allows 200, routing allows 100). */
  maxWaypoints: 100,
  pointNameMax: 150,
  waypointNameMax: 100,
  routeNumberMax: 20,
  routeNameMin: 2,
  routeNameMax: 150,
  descriptionMax: 500,
} as const

export const DIRECTION_LABEL: Record<DirectionType, string> = {
  outbound: 'Borish (A → B)',
  inbound: 'Qaytish (B → A)',
}

// ---------------------------------------------------------------- coordinates & geometry

/** 6 decimals ≈ 0.1 m — the precision the routing provider returns. */
export function roundCoord(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

export function toLngLat(lat: number, lng: number): LngLat {
  return [roundCoord(lng), roundCoord(lat)]
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Parses a GeoJSON LineString (object or JSON string, [lng, lat] order).
 * Returns null for anything that is not a valid LineString with at least 2 points.
 */
export function parseLineString(value: unknown): LineStringGeometry | null {
  let obj: unknown = value
  if (typeof value === 'string') {
    if (!value.trim()) return null
    try {
      obj = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== 'object') return null
  const { type, coordinates } = obj as { type?: unknown; coordinates?: unknown }
  if (type !== 'LineString' || !Array.isArray(coordinates) || coordinates.length < 2) return null
  const coords: LngLat[] = []
  for (const pt of coordinates) {
    if (!Array.isArray(pt) || pt.length < 2 || !isFiniteNumber(pt[0]) || !isFiniteNumber(pt[1])) return null
    if (pt[0] < -180 || pt[0] > 180 || pt[1] < -90 || pt[1] > 90) return null
    coords.push([pt[0], pt[1]])
  }
  return { type: 'LineString', coordinates: coords }
}

// Local planar approximation (metres) — only used to order points, never to draw geometry.
function planarMeters(a: LngLat, b: LngLat): number {
  const latRad = (((a[1] + b[1]) / 2) * Math.PI) / 180
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(latRad)
  const dy = (b[1] - a[1]) * 110_540
  return Math.hypot(dx, dy)
}

/** Distance from `p` to segment a–b and the position (0..1) of the closest point on it. */
function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): { dist: number; t: number } {
  const latRad = (a[1] * Math.PI) / 180
  const kx = 111_320 * Math.cos(latRad)
  const ky = 110_540
  // Segment start `a` is the origin of the local plane.
  const bx = (b[0] - a[0]) * kx
  const by = (b[1] - a[1]) * ky
  const px = (p[0] - a[0]) * kx
  const py = (p[1] - a[1]) * ky
  const len2 = bx * bx + by * by
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2))
  return { dist: Math.hypot(px - bx * t, py - by * t), t }
}

/** Distance along `line` (metres) of the point closest to `p`, and how far `p` is from the line. */
export function measureAlongLine(line: LngLat[], p: LngLat): { along: number; offset: number } {
  let best = { along: 0, offset: Number.POSITIVE_INFINITY }
  let travelled = 0
  for (let i = 0; i < line.length - 1; i++) {
    const segLen = planarMeters(line[i], line[i + 1])
    const { dist, t } = projectOnSegment(p, line[i], line[i + 1])
    if (dist < best.offset) best = { along: travelled + segLen * t, offset: dist }
    travelled += segLen
  }
  return best
}

/** Clicks closer than this to the current road path are inserted by their position along the path. */
export const SNAP_TO_PATH_METERS = 60

/**
 * Index in `state.waypoints` where a new point should be inserted so the A → waypoints → B order
 * stays natural: by position along the current road path when the click is on it, otherwise the
 * cheapest insertion (smallest detour) between consecutive points.
 */
export function insertionIndex(state: DirectionEditorState, p: LngLat): number {
  const { origin, destination, waypoints, preview } = state
  if (!origin || !destination) return waypoints.length

  const key = pointsKey(state)
  if (preview && preview.pointsKey === key) {
    const line = preview.geometry.coordinates
    const target = measureAlongLine(line, p)
    if (target.offset <= SNAP_TO_PATH_METERS) {
      return waypoints.filter((w) => measureAlongLine(line, w.coordinates).along <= target.along).length
    }
  }

  const seq: LngLat[] = [origin.coordinates, ...waypoints.map((w) => w.coordinates), destination.coordinates]
  let bestIdx = waypoints.length
  let bestCost = Number.POSITIVE_INFINITY
  for (let i = 0; i < seq.length - 1; i++) {
    const cost = planarMeters(seq[i], p) + planarMeters(p, seq[i + 1]) - planarMeters(seq[i], seq[i + 1])
    if (cost < bestCost) {
      bestCost = cost
      bestIdx = i
    }
  }
  return bestIdx
}

// ---------------------------------------------------------------- editor state helpers

let waypointSeq = 0
/** Stable local key for waypoints created in this session (no randomness needed). */
export function newWaypointKey(): string {
  waypointSeq += 1
  return `new-${waypointSeq}`
}

export function emptyDirection(direction: DirectionType): DirectionEditorState {
  return { direction, saved: false, origin: null, destination: null, waypoints: [], preview: null }
}

const fmt = (c: LngLat) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`

/** Identity of the routed point sequence (A → waypoints → B); null until both A and B are set. */
export function pointsKey(state: Pick<DirectionEditorState, 'origin' | 'destination' | 'waypoints'>): string | null {
  if (!state.origin || !state.destination) return null
  return [state.origin.coordinates, ...state.waypoints.map((w) => w.coordinates), state.destination.coordinates]
    .map(fmt)
    .join(';')
}

/** Everything that is persisted for a direction — used for dirty tracking against the saved baseline. */
export function directionFingerprint(state: DirectionEditorState): string {
  const g = state.preview
  const coords = g?.geometry.coordinates
  return JSON.stringify({
    o: state.origin ? [state.origin.name, fmt(state.origin.coordinates)] : null,
    d: state.destination ? [state.destination.name, fmt(state.destination.coordinates)] : null,
    w: state.waypoints.map((w) => [w.name, fmt(w.coordinates), w.isStop]),
    g: g && coords
      ? [g.pointsKey, g.distanceMeters, g.durationSeconds, coords.length, fmt(coords[0]), fmt(coords[coords.length - 1])]
      : null,
  })
}

/** Geometry is usable (previewable/saveable) only when it was computed for the current points. */
export function hasFreshGeometry(state: DirectionEditorState): boolean {
  const key = pointsKey(state)
  return Boolean(key && state.preview && state.preview.pointsKey === key)
}

export function mapDirectionDto(dto: RouteDirectionDto): DirectionEditorState {
  const waypoints: EditorWaypoint[] = [...dto.waypoints]
    .sort((a, b) => a.order - b.order)
    .map((w) => ({
      key: `db-${w.id}`,
      id: w.id,
      name: w.name ?? '',
      coordinates: toLngLat(w.lat, w.lng),
      isStop: w.is_stop,
    }))
  const state: DirectionEditorState = {
    direction: dto.direction_type,
    saved: true,
    origin: { name: dto.origin_name, coordinates: toLngLat(dto.origin_lat, dto.origin_lng) },
    destination: { name: dto.destination_name, coordinates: toLngLat(dto.destination_lat, dto.destination_lng) },
    waypoints,
    preview: null,
  }
  const geometry = parseLineString(dto.polyline)
  if (geometry) {
    state.preview = {
      geometry,
      distanceMeters: dto.distance_meters,
      durationSeconds: dto.duration_seconds,
      provider: null,
      warning: null,
      pointsKey: pointsKey(state) as string,
    }
  }
  return state
}

export function mapRouteDetail(dto: RouteDetailDto): RouteEditorModel {
  const find = (t: DirectionType) => dto.directions.find((d) => d.direction_type === t)
  const outbound = find('outbound')
  const inbound = find('inbound')
  return {
    id: dto.id,
    uyushmaId: dto.uyushma_id,
    uyushmaName: dto.uyushma_name,
    isPublished: dto.is_published,
    isArchived: dto.is_archived,
    meta: { routeNumber: dto.route_number, name: dto.name, description: dto.description ?? '' },
    directions: {
      outbound: outbound ? mapDirectionDto(outbound) : emptyDirection('outbound'),
      inbound: inbound ? mapDirectionDto(inbound) : emptyDirection('inbound'),
    },
  }
}

/** Inbound drawn from the outbound in reverse (B → A). Geometry is re-routed by the backend, never mirrored. */
export function reverseInto(source: DirectionEditorState, target: DirectionEditorState): DirectionEditorState {
  return {
    direction: target.direction,
    saved: target.saved,
    origin: source.destination ? { ...source.destination } : null,
    destination: source.origin ? { ...source.origin } : null,
    waypoints: [...source.waypoints].reverse().map((w) => ({ ...w, key: newWaypointKey(), id: null })),
    preview: null,
  }
}

// ---------------------------------------------------------------- request builders

export function buildAutoPathRequest(state: DirectionEditorState): AutoPathRequest | null {
  if (!state.origin || !state.destination) return null
  const ll = (c: LngLat) => ({ lat: c[1], lng: c[0] })
  return {
    origin: ll(state.origin.coordinates),
    destination: ll(state.destination.coordinates),
    waypoints: state.waypoints.map((w) => ll(w.coordinates)),
    profile: 'driving',
  }
}

export function mapAutoPathResponse(res: AutoPathResponse, key: string): RoutePreview {
  const geometry = parseLineString(res.geojson) ?? parseLineString(res.polyline)
  if (!geometry) throw new Error('Yo‘l chizish xizmati noto‘g‘ri geometriya qaytardi')
  return {
    geometry,
    distanceMeters: Math.max(0, Math.round(res.distance_meters)),
    durationSeconds: Math.max(0, Math.round(res.duration_seconds)),
    provider: res.provider,
    warning: res.warning ?? null,
    pointsKey: key,
  }
}

/** Human readable problems that block saving a direction (empty list = saveable). */
export function validateDirectionForSave(state: DirectionEditorState): string[] {
  const errors: string[] = []
  if (!state.origin) errors.push('A nuqta (bosh bekat) tanlanmagan')
  else if (!state.origin.name.trim()) errors.push('A nuqta nomini kiriting')
  if (!state.destination) errors.push('B nuqta (oxirgi bekat) tanlanmagan')
  else if (!state.destination.name.trim()) errors.push('B nuqta nomini kiriting')
  if (state.waypoints.length > EDITOR_LIMITS.maxWaypoints) {
    errors.push(`Oraliq nuqtalar ${EDITOR_LIMITS.maxWaypoints} tadan oshmasligi kerak`)
  }
  const unnamedStops = state.waypoints
    .map((w, i) => (w.isStop && !w.name.trim() ? i + 1 : 0))
    .filter(Boolean)
  if (unnamedStops.length) errors.push(`Bekat nomini kiriting: #${unnamedStops.join(', #')}`)
  if (state.origin && state.destination && !hasFreshGeometry(state)) {
    errors.push('Yo‘l geometriyasi hisoblanmagan (xarita yo‘lni qayta chizishini kuting yoki qayta urinib ko‘ring)')
  }
  return errors
}

export function buildDirectionSaveRequest(state: DirectionEditorState): DirectionSaveRequest {
  const errors = validateDirectionForSave(state)
  if (errors.length) throw new Error(errors.join('; '))
  const origin = state.origin!
  const destination = state.destination!
  const preview = state.preview!
  return {
    origin_name: origin.name.trim(),
    destination_name: destination.name.trim(),
    origin_lat: origin.coordinates[1],
    origin_lng: origin.coordinates[0],
    destination_lat: destination.coordinates[1],
    destination_lng: destination.coordinates[0],
    waypoints: state.waypoints.map((w) => ({
      name: w.name.trim() || null,
      lat: w.coordinates[1],
      lng: w.coordinates[0],
      is_stop: w.isStop,
    })),
    geojson: { type: 'LineString', coordinates: preview.geometry.coordinates.map((c) => [c[0], c[1]] as LngLat) },
    distance_meters: preview.distanceMeters,
    duration_seconds: preview.durationSeconds,
  }
}

export function validateMeta(meta: RouteMetaState): string[] {
  const errors: string[] = []
  const num = meta.routeNumber.trim()
  const name = meta.name.trim()
  if (!num) errors.push('Yo‘nalish raqamini kiriting')
  else if (num.length > EDITOR_LIMITS.routeNumberMax) errors.push(`Raqam ${EDITOR_LIMITS.routeNumberMax} belgidan oshmasin`)
  if (name.length < EDITOR_LIMITS.routeNameMin) errors.push('Yo‘nalish nomi kamida 2 belgi bo‘lsin')
  else if (name.length > EDITOR_LIMITS.routeNameMax) errors.push(`Nom ${EDITOR_LIMITS.routeNameMax} belgidan oshmasin`)
  if (meta.description.length > EDITOR_LIMITS.descriptionMax) errors.push(`Tavsif ${EDITOR_LIMITS.descriptionMax} belgidan oshmasin`)
  return errors
}

/** Only the changed metadata fields (PUT /routes/{id}); empty object = nothing to save. */
export function buildMetaUpdate(saved: RouteMetaState, current: RouteMetaState): RouteUpdateRequest {
  const body: RouteUpdateRequest = {}
  if (current.routeNumber.trim() !== saved.routeNumber.trim()) body.route_number = current.routeNumber.trim()
  if (current.name.trim() !== saved.name.trim()) body.name = current.name.trim()
  if (current.description.trim() !== saved.description.trim()) body.description = current.description.trim()
  return body
}

export function buildCreateRequest(meta: RouteMetaState, uyushmaId: string | null): RouteCreateRequest {
  return {
    route_number: meta.routeNumber.trim(),
    name: meta.name.trim(),
    description: meta.description.trim() || null,
    uyushma_id: uyushmaId ? Number(uyushmaId) : null,
  }
}

// ---------------------------------------------------------------- HTTP

export const routeEditorApi = {
  /** Route with both directions and ordered waypoints (operators can read their unpublished routes). */
  async loadRoute(routeId: number, signal?: AbortSignal): Promise<RouteEditorModel> {
    return mapRouteDetail(await apiClient.get<RouteDetailDto>(`/routes/${routeId}`, { signal }))
  },

  /** Creates route metadata as an unpublished draft. 409 when the number already exists. */
  createRoute(body: RouteCreateRequest): Promise<RouteDto> {
    return apiClient.post<RouteDto>('/routes', body)
  },

  updateRoute(routeId: number, body: RouteUpdateRequest): Promise<RouteDto> {
    return apiClient.put<RouteDto>(`/routes/${routeId}`, body)
  },

  /** Road path preview A → waypoints → B from the backend routing provider (not saved). */
  async previewPath(state: DirectionEditorState, signal?: AbortSignal): Promise<RoutePreview> {
    const body = buildAutoPathRequest(state)
    const key = pointsKey(state)
    if (!body || !key) throw new Error('A va B nuqtalarni tanlang')
    const res = await apiClient.post<AutoPathResponse>('/routes/editor/auto-path', body, { signal, timeoutMs: 30_000 })
    return mapAutoPathResponse(res, key)
  },

  /** Atomically saves A, ordered waypoints, B and the previewed geometry of one direction. */
  async saveDirection(routeId: number, state: DirectionEditorState): Promise<DirectionEditorState> {
    const body = buildDirectionSaveRequest(state)
    const dto = await apiClient.put<RouteDirectionDto>(`/routes/${routeId}/directions/${state.direction}`, body)
    return mapDirectionDto(dto)
  },

  /** Publishing requires both directions with saved geometry (409 with a reason otherwise). */
  setPublished(routeId: number, isPublished: boolean): Promise<RouteDto> {
    return apiClient.post<RouteDto>(`/routes/${routeId}/publish`, { is_published: isPublished })
  },
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return '—'
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  const min = Math.round(seconds / 60)
  if (min < 60) return `${min} daq`
  return `${Math.floor(min / 60)} soat ${min % 60} daq`
}
