import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import { apiClient } from '../client'
import {
  buildAutoPathRequest,
  buildCreateRequest,
  buildDirectionSaveRequest,
  buildMetaUpdate,
  directionFingerprint,
  emptyDirection,
  hasFreshGeometry,
  insertionIndex,
  mapAutoPathResponse,
  mapDirectionDto,
  mapRouteDetail,
  parseLineString,
  pointsKey,
  reverseInto,
  routeEditorApi,
  validateDirectionForSave,
} from '../routeEditorApi'
import type {
  AutoPathResponse,
  DirectionEditorState,
  RouteDetailDto,
  RouteDirectionDto,
} from '../../../types/routeEditor'

const mocked = apiClient as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
}

const GEOMETRY = {
  type: 'LineString' as const,
  coordinates: [
    [72.333699, 40.783726],
    [72.3442, 40.7829],
    [72.3505, 40.7812],
    [72.364, 40.776],
  ] as [number, number][],
}

function outboundDto(overrides: Partial<RouteDirectionDto> = {}): RouteDirectionDto {
  return {
    id: 1,
    route_id: 7,
    direction_type: 'outbound',
    origin_name: 'Eski shahar',
    destination_name: 'Yangi bozor',
    origin_lat: 40.7836,
    origin_lng: 72.3337,
    destination_lat: 40.776,
    destination_lng: 72.364,
    // The backend stores the LineString as a JSON string (key order as json.dumps writes it)
    polyline: JSON.stringify({ coordinates: GEOMETRY.coordinates, type: 'LineString' }),
    distance_meters: 5015,
    duration_seconds: 643,
    // Deliberately out of order: the editor must sort by `order`
    waypoints: [
      { id: 12, route_direction_id: 1, order: 2, name: "Navoiy shoh ko'chasi", lat: 40.7812, lng: 72.3505, is_stop: true, created_at: '' },
      { id: 11, route_direction_id: 1, order: 1, name: null, lat: 40.7829, lng: 72.3442, is_stop: false, created_at: '' },
    ],
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function detailDto(directions: RouteDirectionDto[]): RouteDetailDto {
  return {
    id: 7,
    uyushma_id: 1,
    route_number: 'T1',
    name: 'Test yo‘nalish',
    description: null,
    is_published: false,
    is_archived: false,
    directions,
    created_at: '',
    updated_at: '',
    uyushma_name: 'Andijon',
    fare_uzs: null,
    online_vehicles_count: 0,
  }
}

function routedState(): DirectionEditorState {
  return mapDirectionDto(outboundDto())
}

beforeEach(() => {
  mocked.get.mockReset()
  mocked.post.mockReset()
  mocked.put.mockReset()
})

describe('DTO → editor state', () => {
  it('maps a saved direction: [lng, lat] points, ordered waypoints, parsed geometry', () => {
    const s = mapDirectionDto(outboundDto())
    expect(s.direction).toBe('outbound')
    expect(s.saved).toBe(true)
    expect(s.origin).toEqual({ name: 'Eski shahar', coordinates: [72.3337, 40.7836] })
    expect(s.destination).toEqual({ name: 'Yangi bozor', coordinates: [72.364, 40.776] })
    expect(s.waypoints.map((w) => [w.id, w.key, w.name, w.coordinates, w.isStop])).toEqual([
      [11, 'db-11', '', [72.3442, 40.7829], false],
      [12, 'db-12', "Navoiy shoh ko'chasi", [72.3505, 40.7812], true],
    ])
    expect(s.preview?.geometry).toEqual(GEOMETRY)
    expect(s.preview?.distanceMeters).toBe(5015)
    expect(s.preview?.durationSeconds).toBe(643)
    expect(s.preview?.provider).toBeNull()
    // Saved geometry belongs to the saved points, so no re-route is needed on load
    expect(s.preview?.pointsKey).toBe(pointsKey(s))
    expect(hasFreshGeometry(s)).toBe(true)
  })

  it('treats a missing/invalid polyline as "no geometry" (never fabricates one)', () => {
    expect(mapDirectionDto(outboundDto({ polyline: null })).preview).toBeNull()
    expect(mapDirectionDto(outboundDto({ polyline: 'not json' })).preview).toBeNull()
    expect(parseLineString({ type: 'Point', coordinates: [72, 40] })).toBeNull()
    expect(parseLineString({ type: 'LineString', coordinates: [[72, 40]] })).toBeNull()
    expect(parseLineString({ type: 'LineString', coordinates: [[72, 40], [72, 'x']] })).toBeNull()
    expect(parseLineString({ type: 'LineString', coordinates: [[72, 40], [200, 40]] })).toBeNull()
  })

  it('maps route detail and fills a missing direction with an empty editor state', () => {
    const model = mapRouteDetail(detailDto([outboundDto()]))
    expect(model.id).toBe(7)
    expect(model.meta).toEqual({ routeNumber: 'T1', name: 'Test yo‘nalish', description: '' })
    expect(model.directions.outbound.saved).toBe(true)
    expect(model.directions.inbound).toEqual(emptyDirection('inbound'))
    expect(pointsKey(model.directions.inbound)).toBeNull()
  })
})

describe('auto-path request', () => {
  it('sends A → waypoints → B as {lat, lng} objects with the driving profile', () => {
    expect(buildAutoPathRequest(routedState())).toEqual({
      origin: { lat: 40.7836, lng: 72.3337 },
      destination: { lat: 40.776, lng: 72.364 },
      waypoints: [
        { lat: 40.7829, lng: 72.3442 },
        { lat: 40.7812, lng: 72.3505 },
      ],
      profile: 'driving',
    })
  })

  it('returns null until both endpoints exist', () => {
    const s = { ...emptyDirection('outbound'), origin: { name: 'A', coordinates: [72.3, 40.7] as [number, number] } }
    expect(buildAutoPathRequest(s)).toBeNull()
  })

  it('previewPath posts to /routes/editor/auto-path and keeps the provider warning', async () => {
    const s = routedState()
    const response: AutoPathResponse = {
      distance_meters: 6100.4,
      duration_seconds: 700,
      geojson: { type: 'LineString', coordinates: GEOMETRY.coordinates },
      polyline: JSON.stringify(GEOMETRY),
      provider: 'geodesic-fallback',
      warning: "Yo'l ko'chalar bo'yicha emas",
    }
    mocked.post.mockResolvedValueOnce(response)
    const controller = new AbortController()
    const preview = await routeEditorApi.previewPath(s, controller.signal)

    expect(mocked.post).toHaveBeenCalledTimes(1)
    const [path, body, options] = mocked.post.mock.calls[0]
    expect(path).toBe('/routes/editor/auto-path')
    expect(body).toEqual(buildAutoPathRequest(s))
    expect(options.signal).toBe(controller.signal)
    expect(preview).toEqual({
      geometry: GEOMETRY,
      distanceMeters: 6100,
      durationSeconds: 700,
      provider: 'geodesic-fallback',
      warning: "Yo'l ko'chalar bo'yicha emas",
      pointsKey: pointsKey(s),
    })
  })

  it('rejects a provider response without a usable LineString', () => {
    const bad = { distance_meters: 1, duration_seconds: 1, geojson: {}, polyline: '', provider: 'osrm', warning: null }
    expect(() => mapAutoPathResponse(bad, 'k')).toThrow()
  })

  it('propagates backend errors (e.g. 502 provider failure) instead of inventing geometry', async () => {
    mocked.post.mockRejectedValueOnce(new Error("Yo'l chizish xizmati xatosi"))
    await expect(routeEditorApi.previewPath(routedState())).rejects.toThrow("Yo'l chizish xizmati xatosi")
  })
})

describe('direction save payload', () => {
  it('builds DirectionSaveRequest from the previewed geometry', () => {
    const s = routedState()
    s.origin!.name = '  Eski shahar  '
    const body = buildDirectionSaveRequest(s)
    expect(body).toEqual({
      origin_name: 'Eski shahar',
      destination_name: 'Yangi bozor',
      origin_lat: 40.7836,
      origin_lng: 72.3337,
      destination_lat: 40.776,
      destination_lng: 72.364,
      waypoints: [
        { name: null, lat: 40.7829, lng: 72.3442, is_stop: false },
        { name: "Navoiy shoh ko'chasi", lat: 40.7812, lng: 72.3505, is_stop: true },
      ],
      geojson: GEOMETRY,
      distance_meters: 5015,
      duration_seconds: 643,
    })
  })

  it('blocks saving stale geometry, missing endpoints and unnamed stops', () => {
    const moved = routedState()
    moved.waypoints[0] = { ...moved.waypoints[0], coordinates: [72.35, 40.79] }
    expect(hasFreshGeometry(moved)).toBe(false)
    expect(validateDirectionForSave(moved).join(' ')).toMatch(/geometriyasi hisoblanmagan/)
    expect(() => buildDirectionSaveRequest(moved)).toThrow()

    const unnamedStop = routedState()
    unnamedStop.waypoints[1] = { ...unnamedStop.waypoints[1], name: '  ' }
    expect(validateDirectionForSave(unnamedStop)).toEqual(['Bekat nomini kiriting: #2'])

    const empty = emptyDirection('inbound')
    expect(validateDirectionForSave(empty)).toEqual(['A nuqta (bosh bekat) tanlanmagan', 'B nuqta (oxirgi bekat) tanlanmagan'])
  })

  it('saveDirection PUTs /routes/{id}/directions/{type} and the response round-trips to the same state', async () => {
    const local = routedState()
    local.waypoints = local.waypoints.map((w) => ({ ...w, key: `new-${w.id}`, id: null }))
    // Simulate the backend: persist the payload and return RouteDirectionRead
    mocked.put.mockImplementationOnce(async (_path: string, body: ReturnType<typeof buildDirectionSaveRequest>) => ({
      id: 99,
      route_id: 7,
      direction_type: 'outbound',
      origin_name: body.origin_name,
      destination_name: body.destination_name,
      origin_lat: body.origin_lat,
      origin_lng: body.origin_lng,
      destination_lat: body.destination_lat,
      destination_lng: body.destination_lng,
      polyline: JSON.stringify({ type: 'LineString', coordinates: body.geojson.coordinates }),
      distance_meters: body.distance_meters,
      duration_seconds: body.duration_seconds,
      waypoints: body.waypoints.map((w, i) => ({
        id: 500 + i,
        route_direction_id: 99,
        order: i + 1,
        name: w.name,
        lat: w.lat,
        lng: w.lng,
        is_stop: w.is_stop,
        created_at: '',
      })),
      created_at: '',
      updated_at: '',
    }))

    const saved = await routeEditorApi.saveDirection(7, local)
    expect(mocked.put).toHaveBeenCalledWith('/routes/7/directions/outbound', buildDirectionSaveRequest(local))
    expect(saved.waypoints.map((w) => w.id)).toEqual([500, 501])
    expect(directionFingerprint(saved)).toBe(directionFingerprint(local))
    expect(hasFreshGeometry(saved)).toBe(true)
  })
})

describe('editor helpers', () => {
  it('reverseInto mirrors points only; geometry must be re-routed by the backend', () => {
    const out = routedState()
    const inbound = reverseInto(out, emptyDirection('inbound'))
    expect(inbound.direction).toBe('inbound')
    expect(inbound.origin).toEqual(out.destination)
    expect(inbound.destination).toEqual(out.origin)
    expect(inbound.waypoints.map((w) => w.coordinates)).toEqual([...out.waypoints].reverse().map((w) => w.coordinates))
    expect(inbound.waypoints.every((w) => w.id === null && w.key.startsWith('new-'))).toBe(true)
    expect(inbound.preview).toBeNull()
  })

  it('inserts a clicked point by its position along the current road path', () => {
    const s = routedState() // path: A → wp1 (72.3442) → wp2 (72.3505) → B
    // On the path between wp1 and wp2
    expect(insertionIndex(s, [72.347, 40.78205])).toBe(1)
    // On the path before wp1
    expect(insertionIndex(s, [72.339, 40.7833])).toBe(0)
  })

  it('uses cheapest insertion when the click is away from the path', () => {
    const s = { ...routedState(), preview: null }
    // Far north of the segment wp2 → B: smallest detour is between wp2 and B
    expect(insertionIndex(s, [72.358, 40.79])).toBe(2)
    expect(insertionIndex({ ...emptyDirection('outbound') }, [72.3, 40.7])).toBe(0)
  })

  it('fingerprint changes with persisted fields only', () => {
    const a = routedState()
    const b = { ...routedState(), waypoints: routedState().waypoints.map((w) => ({ ...w, key: 'other-' + w.id })) }
    expect(directionFingerprint(a)).toBe(directionFingerprint(b))
    const renamed = { ...a, waypoints: a.waypoints.map((w, i) => (i === 0 ? { ...w, name: 'X' } : w)) }
    expect(directionFingerprint(renamed)).not.toBe(directionFingerprint(a))
    const toggled = { ...a, waypoints: a.waypoints.map((w, i) => (i === 0 ? { ...w, isStop: true } : w)) }
    expect(directionFingerprint(toggled)).not.toBe(directionFingerprint(a))
  })

  it('builds metadata create/update bodies', () => {
    expect(buildCreateRequest({ routeNumber: ' T1 ', name: ' Test ', description: '' }, '3')).toEqual({
      route_number: 'T1',
      name: 'Test',
      description: null,
      uyushma_id: 3,
    })
    expect(buildCreateRequest({ routeNumber: 'T1', name: 'Test', description: 'x' }, null).uyushma_id).toBeNull()
    const saved = { routeNumber: '15', name: 'Eski shahar', description: '' }
    expect(buildMetaUpdate(saved, { ...saved })).toEqual({})
    expect(buildMetaUpdate(saved, { ...saved, name: 'Yangi nom ' })).toEqual({ name: 'Yangi nom' })
  })

  it('publishes through POST /routes/{id}/publish', async () => {
    mocked.post.mockResolvedValueOnce({ id: 7, is_published: true })
    await routeEditorApi.setPublished(7, true)
    expect(mocked.post).toHaveBeenCalledWith('/routes/7/publish', { is_published: true })
  })
})
