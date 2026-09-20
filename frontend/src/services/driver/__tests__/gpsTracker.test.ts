import { ApiError } from '@/services/api/client'
import { MemoryGpsQueue } from '../gpsQueue'
import { GpsTracker, toGpsPoint, type GpsFix, type LocationSource } from '../gpsTracker'
import type { GpsPoint } from '@/types/driver'

vi.mock('@/services/nativeBridge', () => ({ nativeBridge: { isNative: () => false } }))

function fix(overrides: Partial<GpsFix> = {}): GpsFix {
  return { lat: 40.78, lng: 72.34, accuracy: 8, speedKmh: 30, heading: 90, capturedAtMs: Date.now(), ...overrides }
}

function point(key: string, capturedAtMs: number): GpsPoint {
  return toGpsPoint(fix({ capturedAtMs }), key)
}

/** A controllable location source: the test decides which fix `current()` returns. */
function source(next: () => GpsFix | Error): LocationSource {
  return {
    kind: 'browser',
    watch: () => () => undefined,
    current: async () => {
      const value = next()
      if (value instanceof Error) throw value
      return value
    },
  }
}

function setup(opts: { online?: boolean; fixes?: () => GpsFix | Error } = {}) {
  let online = opts.online ?? true
  let clock = Date.now()
  const api = { sendGps: vi.fn().mockResolvedValue({}), syncGpsBatch: vi.fn().mockResolvedValue({ processed: 0 }) }
  const queue = new MemoryGpsQueue()
  const onShiftLost = vi.fn()
  const tracker = new GpsTracker({
    api,
    queue,
    source: source(opts.fixes ?? (() => fix({ capturedAtMs: (clock += 5000) }))),
    onShiftLost,
    isOnline: () => online,
  })
  return { tracker, api, queue, onShiftLost, setOnline: (v: boolean) => (online = v) }
}

describe('GpsTracker', () => {
  // The learned clock correction is persisted, so each test starts from a clean device clock
  beforeEach(() => {
    try {
      localStorage.clear()
    } catch {
      /* no storage in this environment */
    }
  })

  it('sends a fresh fix directly while online', async () => {
    const { tracker, api } = setup()
    await tracker.start(11, 3600)
    await tracker.tick()
    tracker.stop()
    expect(api.sendGps).toHaveBeenCalled()
    const sent = api.sendGps.mock.calls[0][0] as GpsPoint
    expect(sent.idempotency_key).toBeTruthy()
    expect(sent.lat).toBe(40.78)
    expect(new Date(sent.captured_at).toISOString()).toBe(sent.captured_at)
  })

  it('queues fixes offline and uploads them as one idempotent batch when back online', async () => {
    const { tracker, api, queue, setOnline } = setup({ online: false })
    await tracker.start(11, 3600)
    await tracker.tick()
    await tracker.tick()
    expect(api.sendGps).not.toHaveBeenCalled()
    expect(await queue.count(11)).toBeGreaterThanOrEqual(2)
    expect(tracker.getStatus().online).toBe(false)

    setOnline(true)
    await tracker.flush()
    tracker.stop()
    expect(api.syncGpsBatch).toHaveBeenCalledTimes(1)
    const batch = api.syncGpsBatch.mock.calls[0][0] as GpsPoint[]
    expect(batch.length).toBeGreaterThanOrEqual(2)
    // oldest first so history replays in order
    expect(Date.parse(batch[0].captured_at)).toBeLessThan(Date.parse(batch[1].captured_at))
    expect(await queue.count(11)).toBe(0)
  })

  it('keeps a fix when the network request fails and retries it later', async () => {
    const { tracker, api, queue } = setup()
    api.sendGps.mockRejectedValueOnce(new ApiError(0, 'Serverga ulanib bo‘lmadi'))
    await tracker.start(11, 3600) // first tick fails with a network error
    expect(await queue.count(11)).toBe(1)
    await tracker.flush()
    tracker.stop()
    expect(api.syncGpsBatch).toHaveBeenCalledTimes(1)
    expect(await queue.count(11)).toBe(0)
  })

  it('stops and reports when the backend says the shift is no longer active (409)', async () => {
    const { tracker, api, onShiftLost } = setup()
    api.sendGps.mockRejectedValueOnce(new ApiError(409, 'Faol smena yo‘q'))
    await tracker.start(11, 3600)
    expect(onShiftLost).toHaveBeenCalledWith('Faol smena yo‘q')
    expect(tracker.getStatus().running).toBe(false)
  })

  it('drops a fix the backend rejects as invalid (422) instead of retrying forever', async () => {
    const { tracker, api, queue } = setup()
    api.sendGps.mockRejectedValueOnce(new ApiError(422, 'GPS nuqtasi rad etildi'))
    await tracker.start(11, 3600)
    tracker.stop()
    expect(await queue.count()).toBe(0)
    expect(tracker.getStatus().lastError).toBe('GPS nuqtasi rad etildi')
  })

  it('never sends very inaccurate fixes', async () => {
    const { tracker, api } = setup({ fixes: () => fix({ accuracy: 900, capturedAtMs: Date.now() }) })
    await tracker.start(11, 3600)
    tracker.stop()
    expect(api.sendGps).not.toHaveBeenCalled()
    expect(tracker.getStatus().lastError).toMatch(/aniqligi/)
  })

  it('does not resend the same fix twice (stale fixes would be rejected as out of order)', async () => {
    const same = fix({ capturedAtMs: 1_700_000_000_000 })
    const { tracker, api } = setup({ fixes: () => same })
    await tracker.start(11, 3600)
    await tracker.tick()
    await tracker.tick()
    tracker.stop()
    expect(api.sendGps).toHaveBeenCalledTimes(1)
  })

  it('reports a denied GPS permission', async () => {
    const denied = Object.assign(new Error('denied'), { code: 1 })
    const { tracker, api } = setup({ fixes: () => denied })
    await tracker.start(11, 3600)
    tracker.stop()
    expect(api.sendGps).not.toHaveBeenCalled()
    expect(tracker.getStatus().permission).toBe('denied')
  })

  it('corrects a wrong device clock instead of losing the shift (422 + server_time)', async () => {
    // The phone runs 10 minutes fast, so every fix it records is dated in the future
    const realNow = Date.now()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(realNow + 10 * 60_000)
    try {
      const { tracker, api, queue } = setup()
      api.sendGps.mockRejectedValueOnce(
        new ApiError(422, 'GPS nuqtasi rad etildi', {
          reason: 'captured_at_in_future',
          server_time: new Date(realNow).toISOString(),
        }),
      )
      await tracker.start(11, 3600)

      // The rejected fix is kept and re-stamped into the window the backend accepts
      expect(await queue.count(11)).toBe(1)
      expect(Date.parse((await queue.take(11, 10))[0].captured_at)).toBeLessThanOrEqual(realNow)
      expect(tracker.getStatus().lastError).toBeNull()

      // ...and the next live fix already goes out with the corrected clock
      api.syncGpsBatch.mockResolvedValue({ processed: 1, serverTimeMs: realNow })
      await tracker.flush()
      await tracker.tick()
      tracker.stop()
      const sent = api.sendGps.mock.calls.at(-1)?.[0] as GpsPoint
      expect(Date.parse(sent.captured_at)).toBeLessThanOrEqual(realNow)
    } finally {
      vi.useRealTimers()
    }
  })

  it('splits a rejected batch instead of throwing away the whole backlog', async () => {
    const { tracker, api, queue, setOnline } = setup({ online: false })
    await tracker.start(11, 3600)
    const base = Date.now() - 60_000
    for (let i = 0; i < 4; i += 1) await queue.add(11, point(`fix-${i}`, base + i * 1000))

    // Only the third fix is malformed; the backend refuses any batch that contains it
    api.syncGpsBatch.mockImplementation(async (points: GpsPoint[]) => {
      if (points.some((p) => p.idempotency_key === 'fix-2')) throw new ApiError(422, 'Yaroqsiz nuqta')
      return { processed: points.length }
    })
    setOnline(true)
    await tracker.flush()
    tracker.stop()

    // The bad fix is dropped on its own; everything else was delivered
    expect(await queue.count(11)).toBe(0)
    const delivered = api.syncGpsBatch.mock.calls.flatMap((c) => (c[0] as GpsPoint[]).map((p) => p.idempotency_key))
    expect(delivered).toEqual(expect.arrayContaining(['fix-0', 'fix-1', 'fix-3']))
  })

  it('runs one upload at a time and lets every caller await the same one', async () => {
    const { tracker, api, queue } = setup()
    await tracker.start(11, 3600)
    await queue.add(11, point('a', Date.now() - 5000))
    api.syncGpsBatch.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ processed: 1 }), 10)),
    )
    const first = tracker.flush()
    const second = tracker.flush()
    expect(second).toBe(first)
    await Promise.all([first, second])
    tracker.stop()
    expect(api.syncGpsBatch).toHaveBeenCalledTimes(1)
    expect(await queue.count(11)).toBe(0)
  })

  it('never uploads fixes recorded during another shift', async () => {
    const { tracker, api, queue } = setup({ online: false })
    await queue.add(10, point('old-shift', Date.now() - 60_000))
    await tracker.start(11, 3600)
    expect(await queue.count(10)).toBe(0)
    tracker.stop()
    expect(api.syncGpsBatch).not.toHaveBeenCalled()
  })
})

describe('MemoryGpsQueue', () => {
  it('returns fixes oldest-first, deduplicated by idempotency key, and trims the oldest beyond the cap', async () => {
    const q = new MemoryGpsQueue(3)
    await q.add(1, point('c', 3000))
    await q.add(1, point('a', 1000))
    await q.add(1, point('a', 1000))
    await q.add(1, point('b', 2000))
    await q.add(1, point('d', 4000))
    const keys = (await q.take(1, 10)).map((p) => p.idempotency_key)
    expect(keys).toEqual(['b', 'c', 'd'])
  })
})
