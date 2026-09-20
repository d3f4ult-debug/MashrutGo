import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  FLEET_STALE_THRESHOLD_MS,
  applyLocationUpdate,
  applyParkingCount,
  buildRouteOptions,
  computeFleetStatus,
  filterFleet,
  isRelevantRouteStatus,
  mapFleetParking,
  mapLiveFleetVehicle,
  mergeFleetSnapshot,
  summarizeFleet,
  useLiveFleet,
  withLiveStatus,
  type FleetParkingDto,
  type LiveFleetVehicleDto,
} from '../useLiveFleet'
import { publicChannel } from '../../services/realtime/websocket'
import type { FleetVehicle } from '../../types/realtimeFleet'

const NOW = Date.parse('2026-09-19T13:10:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

// Shape captured from GET /operations/live-fleet on the running backend.
function dto(overrides: Partial<LiveFleetVehicleDto> = {}): LiveFleetVehicleDto {
  return {
    vehicle_pk: 1,
    vehicle_id: 'AND01-V0001',
    plate_number: '60 A 101 AA',
    model: 'Damas',
    color: 'Oq',
    driver_id: 1,
    driver_name: 'Otabek Karimov',
    driver_phone: '+998901110001',
    uyushma_id: 1,
    uyushma_name: "Andijon Shahar Yo'lovchi Tashish Uyushmasi",
    route_id: 1,
    route_number: '15',
    direction: 'outbound',
    has_fix: true,
    lat: 40.783,
    lng: 72.345,
    heading: 90,
    speed_kmh: 28,
    shift_status: 'on_route',
    shift_started_at: '2026-09-19T13:05:04.988254Z',
    last_seen: iso(NOW - 5_000),
    is_stale: false,
    parking_id: null,
    parking_name: null,
    ...overrides,
  }
}

const AWAITING = dto({
  vehicle_pk: 2,
  vehicle_id: 'AND01-V0002',
  plate_number: '60 B 202 BB',
  driver_id: 2,
  driver_name: 'Jasur Saidov',
  has_fix: false,
  lat: null,
  lng: null,
  heading: 0,
  speed_kmh: 0,
  shift_status: 'awaiting_gps',
  last_seen: null,
})

const PARKING: FleetParkingDto = {
  id: 1,
  uyushma_id: 1,
  name: 'Yangi bozor stoyankasi',
  lat: 40.776,
  lng: 72.364,
  radius_meters: 150,
  capacity: 20,
  is_active: true,
  vehicle_count: 0,
  created_at: '2026-09-19T12:58:01.185024Z',
}

describe('mapping', () => {
  it('maps a vehicle with a GPS fix', () => {
    const v = mapLiveFleetVehicle(dto())
    expect(v).toMatchObject({ vehicle_pk: '1', vehicle_id: 'AND01-V0001', route_id: '1', has_fix: true, lat: 40.783, lng: 72.345 })
    expect(v.last_seen_ms).toBe(NOW - 5_000)
    expect(v.server_stale).toBe(false)
  })

  it('maps an awaiting-GPS vehicle without inventing a position', () => {
    const v = mapLiveFleetVehicle(AWAITING)
    expect(v).toMatchObject({ has_fix: false, lat: null, lng: null, last_seen: null, last_seen_ms: null, parking_id: null })
  })

  it('maps parkings', () => {
    expect(mapFleetParking(PARKING)).toEqual({
      id: '1',
      uyushma_id: '1',
      name: 'Yangi bozor stoyankasi',
      lat: 40.776,
      lng: 72.364,
      radius_m: 150,
      capacity: 20,
      vehicle_count: 0,
      is_active: true,
    })
  })
})

describe('computeFleetStatus', () => {
  const base = mapLiveFleetVehicle(dto())

  it('is on_route / in_parking with a fresh fix', () => {
    expect(computeFleetStatus(base, NOW)).toBe('on_route')
    expect(computeFleetStatus({ ...base, parking_id: '1' }, NOW)).toBe('in_parking')
  })

  it('becomes stale on the client after 45 s without a fix', () => {
    expect(computeFleetStatus(base, NOW - 5_000 + FLEET_STALE_THRESHOLD_MS)).toBe('on_route')
    expect(computeFleetStatus(base, NOW - 5_000 + FLEET_STALE_THRESHOLD_MS + 1)).toBe('stale')
    expect(computeFleetStatus({ ...base, parking_id: '1' }, NOW + 60_000)).toBe('stale')
  })

  it('honours a server-side stale flag and awaiting_gps', () => {
    expect(computeFleetStatus(mapLiveFleetVehicle(dto({ is_stale: true, shift_status: 'stale' })), NOW)).toBe('stale')
    expect(computeFleetStatus(mapLiveFleetVehicle(AWAITING), NOW)).toBe('awaiting_gps')
  })
})

describe('applyLocationUpdate', () => {
  const fleet: FleetVehicle[] = [mapLiveFleetVehicle(dto()), mapLiveFleetVehicle(AWAITING)]
  const parkingNames = new Map([['1', 'Yangi bozor stoyankasi']])

  it('ignores vehicles outside the snapshot (other tenants on the public channel)', () => {
    const out = applyLocationUpdate(fleet, { vehicle_id: 'ASK02-V0009', route_id: 7, lat: 40.7, lng: 72.3, captured_at: iso(NOW) }, parkingNames)
    expect(out).toBe(fleet)
  })

  it('ignores out-of-order and malformed fixes', () => {
    expect(applyLocationUpdate(fleet, { vehicle_id: 'AND01-V0001', route_id: 1, lat: 1, lng: 1, captured_at: iso(NOW - 10_000) })).toBe(fleet)
    expect(applyLocationUpdate(fleet, { vehicle_id: 'AND01-V0001', route_id: 1, lat: Number.NaN, lng: 1, captured_at: iso(NOW) })).toBe(fleet)
    expect(applyLocationUpdate(fleet, null)).toBe(fleet)
  })

  it('moves a known vehicle and resolves the parking name', () => {
    const out = applyLocationUpdate(
      fleet,
      { vehicle_id: 'AND01-V0002', route_id: 1, direction: 'inbound', lat: 40.7761, lng: 72.3641, heading: 120, speed_kmh: 5, captured_at: iso(NOW), is_stale: false, parking_id: 1 },
      parkingNames,
    )
    expect(out).not.toBe(fleet)
    expect(out[0]).toBe(fleet[0])
    expect(out[1]).toMatchObject({
      has_fix: true,
      lat: 40.7761,
      lng: 72.3641,
      heading: 120,
      speed_kmh: 5,
      direction: 'inbound',
      last_seen_ms: NOW,
      parking_id: '1',
      parking_name: 'Yangi bozor stoyankasi',
    })
    expect(computeFleetStatus(out[1], NOW)).toBe('in_parking')
  })

  it('clears a server stale flag when a live fix arrives', () => {
    const stale = [mapLiveFleetVehicle(dto({ is_stale: true, last_seen: iso(NOW - 120_000) }))]
    const out = applyLocationUpdate(stale, { vehicle_id: 'AND01-V0001', route_id: 1, lat: 40.78, lng: 72.35, captured_at: iso(NOW) })
    expect(computeFleetStatus(out[0], NOW)).toBe('on_route')
  })
})

describe('mergeFleetSnapshot', () => {
  it('lets the snapshot decide membership (new shift appears, ended shift disappears)', () => {
    const current = [mapLiveFleetVehicle(dto())]
    const snapshot = [mapLiveFleetVehicle(AWAITING)]
    expect(mergeFleetSnapshot(current, snapshot).map((v) => v.vehicle_id)).toEqual(['AND01-V0002'])
  })

  it('keeps a newer WebSocket position over an older snapshot position', () => {
    const current = applyLocationUpdate([mapLiveFleetVehicle(dto())], {
      vehicle_id: 'AND01-V0001',
      route_id: 1,
      lat: 40.79,
      lng: 72.36,
      captured_at: iso(NOW),
    })
    const snapshot = [mapLiveFleetVehicle(dto({ driver_name: 'Yangilangan ism' }))]
    const [merged] = mergeFleetSnapshot(current, snapshot)
    expect(merged).toMatchObject({ lat: 40.79, lng: 72.36, last_seen_ms: NOW, driver_name: 'Yangilangan ism' })
  })

  it('takes the snapshot position when it is newer', () => {
    const current = [mapLiveFleetVehicle(dto())]
    const snapshot = [mapLiveFleetVehicle(dto({ lat: 40.7, last_seen: iso(NOW) }))]
    expect(mergeFleetSnapshot(current, snapshot)[0].lat).toBe(40.7)
  })
})

describe('parkings, filters and summaries', () => {
  it('updates only parkings of this scope', () => {
    const parkings = [mapFleetParking(PARKING)]
    expect(applyParkingCount(parkings, { parking_id: 99, vehicle_count: 4 })).toBe(parkings)
    expect(applyParkingCount(parkings, { parking_id: 1, vehicle_count: 0 })).toBe(parkings)
    expect(applyParkingCount(parkings, { parking_id: 1, vehicle_count: 3 })[0].vehicle_count).toBe(3)
  })

  it('filters by route, status and search, and counts statuses', () => {
    const live = withLiveStatus(
      [mapLiveFleetVehicle(dto()), mapLiveFleetVehicle(AWAITING), mapLiveFleetVehicle(dto({ vehicle_id: 'AND01-V0003', plate_number: '60 C 303 CC', route_id: 2, route_number: '22', last_seen: iso(NOW - 90_000) }))],
      NOW,
    )
    expect(summarizeFleet(live)).toEqual({ on_route: 1, in_parking: 0, stale: 1, awaiting_gps: 1, total: 3 })
    expect(filterFleet(live, { routeId: '2', status: 'all', search: '' }).map((v) => v.vehicle_id)).toEqual(['AND01-V0003'])
    expect(filterFleet(live, { routeId: 'all', status: 'awaiting_gps', search: '' }).map((v) => v.vehicle_id)).toEqual(['AND01-V0002'])
    expect(filterFleet(live, { routeId: 'all', status: 'all', search: '60b202' }).map((v) => v.vehicle_id)).toEqual(['AND01-V0002'])
    expect(filterFleet(live, { routeId: 'all', status: 'all', search: 'otabek' })).toHaveLength(2)
    expect(live.find((v) => v.vehicle_id === 'AND01-V0003')?.age_ms).toBe(90_000)
  })

  it('offers every tenant route, or derives routes from the fleet for the Super Admin', () => {
    const fleet = [mapLiveFleetVehicle(dto())]
    const tenant = buildRouteOptions(fleet, [
      { id: '1', route_number: '15', route_name: 'Eski shahar — Yangi bozor' },
      { id: '2', route_number: '22', route_name: 'Temir yo‘l vokzali — Bog‘ishamol' },
    ])
    expect(tenant.map((r) => [r.route_number, r.vehicles_count])).toEqual([
      ['15', 1],
      ['22', 0],
    ])

    const mixed = buildRouteOptions(
      [...fleet, mapLiveFleetVehicle(dto({ vehicle_id: 'ASK02-V0001', uyushma_id: 2, uyushma_name: 'Asaka Trans', route_id: 9, route_number: '15' }))],
      null,
    )
    expect(mixed).toHaveLength(2)
    expect(mixed.map((r) => r.uyushma_name).sort()).toEqual(['Andijon Shahar Yo\'lovchi Tashish Uyushmasi', 'Asaka Trans'])
  })

  it('re-fetches only for route events that concern this scope', () => {
    const payload = { route_id: 1, route_number: '15', online_vehicles_count: 1, status: 'online', has_live_vehicles: true }
    expect(isRelevantRouteStatus(payload, new Set(['1']))).toBe(true)
    expect(isRelevantRouteStatus({ ...payload, route_id: 7 }, new Set(['1']))).toBe(false)
    expect(isRelevantRouteStatus({ ...payload, route_id: 7 }, null)).toBe(true)
  })
})

// ---------------------------------------------------------------- hook: REST snapshot + real publicChannel over a fake socket

class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }
  send() {}
  close() {
    this.readyState = 3
  }
  accept() {
    this.readyState = 1
    this.onopen?.()
  }
  emit(event: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ event, data, timestamp: new Date().toISOString(), version: '1.0' }) })
  }
}

const ROUTES_DTO = [
  {
    id: 1,
    uyushma_id: 1,
    route_number: '15',
    name: 'Eski shahar — Yangi bozor',
    description: null,
    is_published: true,
    vehicles_count: 2,
    drivers_count: 2,
    online_vehicles_count: 1,
    fare_uzs: 2500,
    directions: [
      { id: 1, direction_type: 'outbound', origin_name: 'Eski shahar', destination_name: 'Yangi bozor', stops_count: 3, distance_meters: 5015, duration_seconds: 643, has_geometry: true },
    ],
    created_at: '2026-09-19T12:57:57.510941Z',
  },
]

describe('useLiveFleet (tenant scope)', () => {
  let fleetReply: LiveFleetVehicleDto[]
  let fleetRequests: string[]

  beforeEach(() => {
    FakeSocket.instances = []
    fleetRequests = []
    const now = Date.now()
    fleetReply = [dto({ last_seen: iso(now - 3_000) }), AWAITING]
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('fetch', async (url: string) => {
      const path = new URL(url, 'http://localhost')
      let body: unknown
      if (path.pathname === '/api/v1/operations/live-fleet') {
        fleetRequests.push(path.search)
        body = fleetReply
      } else if (path.pathname === '/api/v1/uyushma/1/parkings') body = [PARKING]
      else if (path.pathname === '/api/v1/uyushma/1/routes') body = ROUTES_DTO
      else return { status: 404, ok: false, text: async () => '{"detail":"Not Found"}' } as unknown as Response
      return { status: 200, ok: true, text: async () => JSON.stringify(body) } as unknown as Response
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the snapshot, applies only in-scope realtime updates and re-syncs on route status', async () => {
    const scope = { kind: 'tenant', uyushmaId: '1' } as const
    const { result, unmount } = renderHook(() => useLiveFleet(scope))

    await waitFor(() => expect(result.current.vehicles).toHaveLength(2))
    await waitFor(() => expect(result.current.parkings).toHaveLength(1))
    await waitFor(() => expect(result.current.routeDetails.get('1')?.route_name).toBe('Eski shahar — Yangi bozor'))
    expect(fleetRequests[0]).toBe('?uyushma_id=1')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(Object.fromEntries(result.current.vehicles.map((v) => [v.vehicle_id, v.status]))).toEqual({
      'AND01-V0001': 'on_route',
      'AND01-V0002': 'awaiting_gps',
    })

    const socket = FakeSocket.instances[FakeSocket.instances.length - 1]
    expect(socket.url).toContain('/ws/realtime')
    act(() => socket.accept())
    expect(result.current.connectionState).toBe('connected')

    // Another tenant's vehicle on the shared public channel is ignored.
    const before = result.current.vehicles
    act(() => socket.emit('vehicle.location.updated', { vehicle_id: 'ASK02-V0009', route_id: 7, lat: 40.7, lng: 72.3, captured_at: new Date().toISOString() }))
    expect(result.current.vehicles.map((v) => v.vehicle_id)).toEqual(before.map((v) => v.vehicle_id))

    // First fix of the awaiting vehicle, inside the parking geofence.
    act(() =>
      socket.emit('vehicle.location.updated', {
        vehicle_id: 'AND01-V0002',
        route_id: 1,
        direction: 'outbound',
        lat: 40.7761,
        lng: 72.3641,
        heading: 120,
        speed_kmh: 5,
        captured_at: new Date().toISOString(),
        is_stale: false,
        parking_id: 1,
      }),
    )
    const moved = result.current.vehicles.find((v) => v.vehicle_id === 'AND01-V0002')
    expect(moved).toMatchObject({ status: 'in_parking', lat: 40.7761, parking_name: 'Yangi bozor stoyankasi' })

    act(() => socket.emit('parking.count.updated', { parking_id: 1, parking_name: 'Yangi bozor stoyankasi', vehicle_count: 1, vehicles: [] }))
    expect(result.current.parkings[0].vehicle_count).toBe(1)
    act(() => socket.emit('parking.count.updated', { parking_id: 42, vehicle_count: 9 }))
    expect(result.current.parkings.map((p) => p.id)).toEqual(['1'])

    // Shift of vehicle 1 ended: the route event triggers a snapshot re-fetch that drops it.
    fleetReply = [AWAITING]
    const requestsBefore = fleetRequests.length
    act(() => socket.emit('route.vehicle.status', { route_id: 1, route_number: '15', online_vehicles_count: 1, status: 'online', has_live_vehicles: true }))
    await waitFor(() => expect(fleetRequests.length).toBeGreaterThan(requestsBefore), { timeout: 3000 })
    await waitFor(() => expect(result.current.vehicles.map((v) => v.vehicle_id)).toEqual(['AND01-V0002']))
    // The newer realtime fix survives the (older) snapshot position of the remaining vehicle.
    expect(result.current.vehicles[0]).toMatchObject({ has_fix: true, status: 'in_parking' })

    unmount()
    expect(socket.readyState).toBe(3)
    expect(publicChannel.state).toBe('disconnected')
  })
})
