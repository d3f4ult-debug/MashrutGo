/**
 * Live operations fleet for the Uyushma / Super Admin map.
 *
 * Source of truth:
 * - REST snapshot  GET /operations/live-fleet  -> which vehicles are on an active shift (membership)
 *   and their last known fix. Re-fetched every 20 s, after a WebSocket reconnect and whenever a
 *   `route.vehicle.status` event says a vehicle went online/offline.
 * - Public WebSocket `vehicle.location.updated` -> moves vehicles that are already in the snapshot.
 *   The public channel carries every tenant, so unknown vehicle ids are ignored (tenant isolation).
 * - `parking.count.updated` -> live counts of the parkings loaded for this scope.
 *
 * Stale state is computed on the client (now − last fix > 45 s, the backend default).
 * Everything that is not React glue is exported as pure functions (see __tests__).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiClient, errorMessage } from '../services/api/client'
import { uyushmaApi } from '../services/api/uyushmaApi'
import { publicChannel, type ConnectionState } from '../services/realtime/websocket'
import { parseUtc } from '../utils/format'
import type { WsEvent } from '../types/map'
import type {
  FleetDirection,
  FleetFilters,
  FleetParking,
  FleetRouteOption,
  FleetScope,
  FleetStatus,
  FleetStatusCounts,
  FleetVehicle,
  LiveFleetVehicle,
  ParkingCountEvent,
  RouteVehicleStatusEvent,
  VehicleLocationEvent,
} from '../types/realtimeFleet'

/** Backend GPS_STALE_THRESHOLD_SECONDS default. */
export const FLEET_STALE_THRESHOLD_MS = 45_000
export const FLEET_REFRESH_INTERVAL_MS = 20_000
/** Clock tick that re-evaluates stale state and "… oldin" labels. */
export const FLEET_CLOCK_TICK_MS = 5_000
const ROUTE_STATUS_DEBOUNCE_MS = 800
const RECONNECT_RESYNC_MIN_GAP_MS = 2_000

// ---------------------------------------------------------------- DTOs

/** backend/app/schemas/misc.py::LiveFleetVehicle */
export interface LiveFleetVehicleDto {
  vehicle_pk: number
  vehicle_id: string
  plate_number?: string | null
  model?: string | null
  color?: string | null
  driver_id: number
  driver_name: string
  driver_phone: string
  uyushma_id: number
  uyushma_name: string
  route_id: number
  route_number: string
  route_name?: string | null
  direction: string
  has_fix: boolean
  lat?: number | null
  lng?: number | null
  heading?: number
  speed_kmh?: number
  shift_status: string
  shift_started_at: string
  last_seen?: string | null
  is_stale: boolean
  parking_id?: number | null
  parking_name?: string | null
}

/** backend/app/schemas/driver.py::ParkingResponse */
export interface FleetParkingDto {
  id: number
  uyushma_id?: number | null
  name: string
  lat: number
  lng: number
  radius_meters: number
  capacity?: number | null
  is_active: boolean
  vehicle_count: number
  created_at?: string
}

// ---------------------------------------------------------------- pure state logic

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const idOrNull = (v: number | string | null | undefined) => (v === null || v === undefined ? null : String(v))
const asDirection = (d: string | undefined | null, whenUnknown: FleetDirection = 'outbound'): FleetDirection =>
  d === 'inbound' || d === 'outbound' ? d : whenUnknown

function epochOrNull(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = parseUtc(iso)
  return Number.isNaN(ms) ? null : ms
}

export function mapLiveFleetVehicle(dto: LiveFleetVehicleDto): FleetVehicle {
  const hasFix = Boolean(dto.has_fix && isFiniteNumber(dto.lat) && isFiniteNumber(dto.lng))
  return {
    vehicle_pk: String(dto.vehicle_pk),
    vehicle_id: dto.vehicle_id,
    plate_number: dto.plate_number || null,
    model: dto.model || null,
    color: dto.color || null,
    driver_id: String(dto.driver_id),
    driver_name: dto.driver_name,
    driver_phone: dto.driver_phone,
    uyushma_id: String(dto.uyushma_id),
    uyushma_name: dto.uyushma_name,
    route_id: String(dto.route_id),
    route_number: dto.route_number,
    route_name: dto.route_name ?? null,
    direction: asDirection(dto.direction),
    has_fix: hasFix,
    lat: hasFix ? (dto.lat as number) : null,
    lng: hasFix ? (dto.lng as number) : null,
    heading: isFiniteNumber(dto.heading) ? dto.heading : 0,
    speed_kmh: isFiniteNumber(dto.speed_kmh) ? dto.speed_kmh : 0,
    server_stale: hasFix && (dto.is_stale || dto.shift_status === 'stale'),
    shift_started_at: dto.shift_started_at,
    last_seen: hasFix ? dto.last_seen ?? null : null,
    last_seen_ms: hasFix ? epochOrNull(dto.last_seen) : null,
    parking_id: hasFix ? idOrNull(dto.parking_id) : null,
    parking_name: hasFix ? dto.parking_name ?? null : null,
  }
}

export function mapFleetParking(dto: FleetParkingDto): FleetParking {
  return {
    id: String(dto.id),
    uyushma_id: idOrNull(dto.uyushma_id),
    name: dto.name,
    lat: dto.lat,
    lng: dto.lng,
    radius_m: dto.radius_meters,
    capacity: dto.capacity ?? null,
    vehicle_count: dto.vehicle_count,
    is_active: dto.is_active,
  }
}

const POSITION_FIELDS = [
  'has_fix',
  'lat',
  'lng',
  'heading',
  'speed_kmh',
  'server_stale',
  'last_seen',
  'last_seen_ms',
  'parking_id',
  'parking_name',
  'direction',
] as const

/**
 * Apply a fresh REST snapshot. The snapshot decides membership (shift started/ended); a position
 * already known from a newer WebSocket fix (received while the request was in flight) is kept.
 */
export function mergeFleetSnapshot(current: FleetVehicle[], snapshot: FleetVehicle[]): FleetVehicle[] {
  if (current.length === 0) return snapshot
  const known = new Map(current.map((v) => [v.vehicle_id, v]))
  return snapshot.map((fresh) => {
    const prev = known.get(fresh.vehicle_id)
    if (!prev || prev.last_seen_ms === null) return fresh
    if (fresh.last_seen_ms !== null && fresh.last_seen_ms >= prev.last_seen_ms) return fresh
    const merged: FleetVehicle = { ...fresh }
    for (const key of POSITION_FIELDS) (merged as unknown as Record<string, unknown>)[key] = prev[key]
    return merged
  })
}

/**
 * Apply one `vehicle.location.updated` event. Returns the same array (no re-render) when the
 * vehicle is not part of this scope's snapshot (other tenant / not on shift), when the payload is
 * malformed, or when the fix is not newer than the one already shown (out-of-order delivery).
 */
export function applyLocationUpdate(
  vehicles: FleetVehicle[],
  payload: VehicleLocationEvent | null | undefined,
  parkingNames?: ReadonlyMap<string, string>,
): FleetVehicle[] {
  if (!payload || typeof payload.vehicle_id !== 'string') return vehicles
  if (!isFiniteNumber(payload.lat) || !isFiniteNumber(payload.lng)) return vehicles
  const index = vehicles.findIndex((v) => v.vehicle_id === payload.vehicle_id)
  if (index === -1) return vehicles
  const capturedMs = epochOrNull(payload.captured_at)
  if (capturedMs === null) return vehicles
  const prev = vehicles[index]
  if (prev.last_seen_ms !== null && capturedMs <= prev.last_seen_ms) return vehicles

  const parkingId = idOrNull(payload.parking_id)
  const parkingName =
    parkingId === null
      ? null
      : payload.parking_name ?? (parkingId === prev.parking_id && prev.parking_name ? prev.parking_name : parkingNames?.get(parkingId) ?? null)

  const next: FleetVehicle = {
    ...prev,
    has_fix: true,
    lat: payload.lat,
    lng: payload.lng,
    heading: isFiniteNumber(payload.heading) ? payload.heading : prev.heading,
    speed_kmh: isFiniteNumber(payload.speed_kmh) ? payload.speed_kmh : prev.speed_kmh,
    direction: asDirection(payload.direction, prev.direction),
    server_stale: Boolean(payload.is_stale),
    last_seen: payload.captured_at,
    last_seen_ms: capturedMs,
    parking_id: parkingId,
    parking_name: parkingName,
  }
  const out = vehicles.slice()
  out[index] = next
  return out
}

/** Update the live count of a parking of this scope; unknown parkings are ignored. */
export function applyParkingCount(parkings: FleetParking[], payload: ParkingCountEvent | null | undefined): FleetParking[] {
  if (!payload || payload.parking_id === undefined || payload.parking_id === null) return parkings
  if (!isFiniteNumber(payload.vehicle_count)) return parkings
  const id = String(payload.parking_id)
  const index = parkings.findIndex((p) => p.id === id)
  if (index === -1 || parkings[index].vehicle_count === payload.vehicle_count) return parkings
  const out = parkings.slice()
  out[index] = { ...parkings[index], vehicle_count: payload.vehicle_count }
  return out
}

export function computeFleetStatus(v: FleetVehicle, now: number, thresholdMs = FLEET_STALE_THRESHOLD_MS): FleetStatus {
  if (!v.has_fix || v.lat === null || v.lng === null) return 'awaiting_gps'
  if (v.server_stale || v.last_seen_ms === null || now - v.last_seen_ms > thresholdMs) return 'stale'
  return v.parking_id ? 'in_parking' : 'on_route'
}

export function withLiveStatus(vehicles: FleetVehicle[], now: number, thresholdMs = FLEET_STALE_THRESHOLD_MS): LiveFleetVehicle[] {
  return vehicles.map((v) => ({
    ...v,
    status: computeFleetStatus(v, now, thresholdMs),
    age_ms: v.last_seen_ms === null ? null : Math.max(0, now - v.last_seen_ms),
  }))
}

const collator = new Intl.Collator('uz', { numeric: true, sensitivity: 'base' })

export function sortFleet<T extends FleetVehicle>(vehicles: T[]): T[] {
  return vehicles
    .slice()
    .sort(
      (a, b) =>
        collator.compare(a.route_number, b.route_number) ||
        collator.compare(a.uyushma_name, b.uyushma_name) ||
        collator.compare(a.plate_number || a.vehicle_id, b.plate_number || b.vehicle_id),
    )
}

const normalize = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[\s-]+/g, '')

export function filterFleet(vehicles: LiveFleetVehicle[], filters: FleetFilters): LiveFleetVehicle[] {
  const q = normalize(filters.search)
  return vehicles.filter((v) => {
    if (filters.routeId !== 'all' && v.route_id !== filters.routeId) return false
    if (filters.status !== 'all' && v.status !== filters.status) return false
    if (!q) return true
    return [v.plate_number, v.vehicle_id, v.driver_name, v.route_number, v.uyushma_name].some((field) => normalize(field).includes(q))
  })
}

export function summarizeFleet(vehicles: LiveFleetVehicle[]): FleetStatusCounts {
  const counts: FleetStatusCounts = { on_route: 0, in_parking: 0, stale: 0, awaiting_gps: 0, total: vehicles.length }
  vehicles.forEach((v) => {
    counts[v.status] += 1
  })
  return counts
}

/**
 * Route filter options. With the tenant's route list every route is offered (0 on shift included);
 * without it (Super Admin "all") the list is derived from the fleet and labelled with the tenant.
 */
export function buildRouteOptions(
  vehicles: FleetVehicle[],
  routes: { id: string; route_number: string; route_name?: string | null }[] | null,
): FleetRouteOption[] {
  const counts = new Map<string, number>()
  vehicles.forEach((v) => counts.set(v.route_id, (counts.get(v.route_id) ?? 0) + 1))
  const options = new Map<string, FleetRouteOption>()
  const mixedTenants = routes === null && new Set(vehicles.map((v) => v.uyushma_id)).size > 1

  routes?.forEach((r) =>
    options.set(r.id, { id: r.id, route_number: r.route_number, name: r.route_name ?? null, uyushma_name: null, vehicles_count: counts.get(r.id) ?? 0 }),
  )
  vehicles.forEach((v) => {
    if (options.has(v.route_id)) return
    options.set(v.route_id, {
      id: v.route_id,
      route_number: v.route_number,
      name: v.route_name,
      uyushma_name: mixedTenants ? v.uyushma_name : null,
      vehicles_count: counts.get(v.route_id) ?? 0,
    })
  })
  return Array.from(options.values()).sort(
    (a, b) => collator.compare(a.route_number, b.route_number) || collator.compare(a.uyushma_name ?? '', b.uyushma_name ?? ''),
  )
}

/** Should a `route.vehicle.status` event trigger a snapshot re-fetch for this scope? */
export function isRelevantRouteStatus(payload: RouteVehicleStatusEvent | null | undefined, knownRouteIds: ReadonlySet<string> | null): boolean {
  if (!payload || payload.route_id === undefined || payload.route_id === null) return false
  return knownRouteIds === null || knownRouteIds.has(String(payload.route_id))
}

export function fleetQuery(scope: FleetScope): { uyushma_id?: string } {
  return scope.kind === 'tenant' ? { uyushma_id: scope.uyushmaId } : {}
}

export function scopeKey(scope: FleetScope | null): string {
  if (!scope) return 'none'
  return scope.kind === 'all' ? 'all' : `tenant:${scope.uyushmaId}`
}

// ---------------------------------------------------------------- API

export const liveFleetApi = {
  async getFleet(scope: FleetScope, signal?: AbortSignal): Promise<FleetVehicle[]> {
    const list = await apiClient.get<LiveFleetVehicleDto[]>('/operations/live-fleet', { query: fleetQuery(scope), signal })
    return list.map(mapLiveFleetVehicle)
  },

  /** Tenant parkings (management list) or every active parking for the Super Admin "all" view. */
  async getParkings(scope: FleetScope, signal?: AbortSignal): Promise<FleetParking[]> {
    const path = scope.kind === 'tenant' ? `/uyushma/${encodeURIComponent(scope.uyushmaId)}/parkings` : '/parkings'
    const list = await apiClient.get<FleetParkingDto[]>(path, { signal })
    return list.map(mapFleetParking).filter((p) => p.is_active)
  },
}

// ---------------------------------------------------------------- hook

export interface UseLiveFleetResult {
  /** every vehicle on an active shift in scope, with status computed against `now` */
  vehicles: LiveFleetVehicle[]
  parkings: FleetParking[]
  routeOptions: FleetRouteOption[]
  /** route id -> name and direction endpoints, when the tenant's routes are known */
  routeDetails: ReadonlyMap<string, FleetRouteDetails>
  connectionState: ConnectionState
  /** first snapshot of the current scope is loading */
  loading: boolean
  /** a snapshot request is in flight */
  syncing: boolean
  error: string | null
  parkingsError: string | null
  lastSyncedAt: number | null
  now: number
  refresh: () => void
}

export interface FleetRouteDetails {
  id: string
  route_number: string
  route_name: string
  directions: { direction: FleetDirection; start_name: string; end_name: string }[]
}

export function useLiveFleet(scope: FleetScope | null): UseLiveFleetResult {
  const key = scopeKey(scope)
  const [fleet, setFleet] = useState<FleetVehicle[]>([])
  const [parkings, setParkings] = useState<FleetParking[]>([])
  const [tenantRoutes, setTenantRoutes] = useState<FleetRouteDetails[] | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>(publicChannel.state)
  const [loading, setLoading] = useState(Boolean(scope))
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parkingsError, setParkingsError] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const parkingNamesRef = useRef<Map<string, string>>(new Map())
  const knownRouteIdsRef = useRef<Set<string> | null>(null)
  const syncRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    parkingNamesRef.current = new Map(parkings.map((p) => [p.id, p.name]))
  }, [parkings])

  useEffect(() => {
    // Tenant scope: only this tenant's routes matter. Unknown => re-fetch on any route event.
    knownRouteIdsRef.current = tenantRoutes ? new Set([...tenantRoutes.map((r) => r.id), ...fleet.map((v) => v.route_id)]) : null
  }, [tenantRoutes, fleet])

  // Clock for stale detection and relative times.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), FLEET_CLOCK_TICK_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    setFleet([])
    setParkings([])
    setTenantRoutes(null)
    setError(null)
    setParkingsError(null)
    setLastSyncedAt(null)
    if (!scope) {
      setLoading(false)
      syncRef.current = () => undefined
      return
    }
    const activeScope = scope
    setLoading(true)

    const ctrl = new AbortController()
    let alive = true
    let requestSeq = 0
    let appliedSeq = 0
    let inFlight = 0
    let lastFetchStartedAt = 0
    let statusTimer: ReturnType<typeof setTimeout> | null = null

    const loadFleet = async () => {
      const seq = ++requestSeq
      lastFetchStartedAt = Date.now()
      inFlight += 1
      setSyncing(true)
      try {
        const snapshot = await liveFleetApi.getFleet(activeScope, ctrl.signal)
        if (!alive || seq < appliedSeq) return
        appliedSeq = seq
        setFleet((prev) => mergeFleetSnapshot(prev, snapshot))
        setLastSyncedAt(Date.now())
        setError(null)
      } catch (err) {
        if (!alive) return
        setError(errorMessage(err, 'Transportlar holatini yuklab bo‘lmadi'))
      } finally {
        inFlight -= 1
        if (alive) {
          setSyncing(inFlight > 0)
          setLoading(false)
        }
      }
    }

    const loadParkings = async () => {
      try {
        const list = await liveFleetApi.getParkings(activeScope, ctrl.signal)
        if (!alive) return
        setParkings(list)
        setParkingsError(null)
      } catch (err) {
        if (!alive) return
        setParkingsError(errorMessage(err, 'Stoyankalarni yuklab bo‘lmadi'))
      }
    }

    const sync = () => {
      void loadFleet()
      void loadParkings()
    }
    syncRef.current = sync

    if (activeScope.kind === 'tenant') {
      uyushmaApi
        .getRoutes(activeScope.uyushmaId)
        .then((routes) => {
          if (!alive) return
          setTenantRoutes(
            routes.map((r) => ({
              id: r.id,
              route_number: r.route_number,
              route_name: r.route_name,
              directions: r.directions.map((d) => ({ direction: d.direction, start_name: d.start_name, end_name: d.end_name })),
            })),
          )
        })
        .catch(() => {
          // Route names are optional decoration: filters fall back to routes derived from the fleet.
        })
    }

    sync()
    const interval = setInterval(sync, FLEET_REFRESH_INTERVAL_MS)

    const release = publicChannel.acquire()
    setConnectionState(publicChannel.state)
    const offLocation = publicChannel.on('vehicle.location.updated', (evt: WsEvent) => {
      setFleet((prev) => applyLocationUpdate(prev, evt.payload as VehicleLocationEvent, parkingNamesRef.current))
    })
    const offRouteStatus = publicChannel.on('route.vehicle.status', (evt: WsEvent) => {
      if (!isRelevantRouteStatus(evt.payload as RouteVehicleStatusEvent, knownRouteIdsRef.current)) return
      if (statusTimer) clearTimeout(statusTimer)
      statusTimer = setTimeout(() => {
        statusTimer = null
        void loadFleet()
      }, ROUTE_STATUS_DEBOUNCE_MS)
    })
    const offParking = publicChannel.on('parking.count.updated', (evt: WsEvent) => {
      setParkings((prev) => applyParkingCount(prev, evt.payload as ParkingCountEvent))
    })
    const offState = publicChannel.onStateChange((state) => {
      setConnectionState(state)
      // Events may have been missed while disconnected: resync (unless we just did).
      if (state === 'connected' && Date.now() - lastFetchStartedAt > RECONNECT_RESYNC_MIN_GAP_MS) sync()
    })

    return () => {
      alive = false
      ctrl.abort()
      clearInterval(interval)
      if (statusTimer) clearTimeout(statusTimer)
      offLocation()
      offRouteStatus()
      offParking()
      offState()
      release()
      syncRef.current = () => undefined
    }
    // `scope` is represented by `key`; the object identity may change on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const vehicles = useMemo(() => sortFleet(withLiveStatus(fleet, now)), [fleet, now])
  const routeOptions = useMemo(() => buildRouteOptions(fleet, tenantRoutes), [fleet, tenantRoutes])
  const routeDetails = useMemo(() => new Map((tenantRoutes ?? []).map((r) => [r.id, r])), [tenantRoutes])
  const refresh = useCallback(() => syncRef.current(), [])

  return {
    vehicles,
    parkings,
    routeOptions,
    routeDetails,
    connectionState,
    loading,
    syncing,
    error,
    parkingsError,
    lastSyncedAt,
    now,
    refresh,
  }
}
