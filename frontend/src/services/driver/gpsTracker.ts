// Driver GPS transmitter: collects fixes while a shift is active and delivers them to the backend.
//
// - Sends the freshest fix every `gps_interval_seconds` (setting managed by the Super Admin).
// - Network/server failures never lose data: the fix goes to the durable offline queue, which is
//   uploaded with the idempotent batch endpoint when the connection returns.
// - 409 from the backend means the shift is no longer active (ended elsewhere / force-ended by an
//   administrator): tracking stops and the owner is notified.
// - A wrong device clock is corrected, not fatal: every response carries the server time, and fixes
//   are stamped with it (drivers' phones do drift, and the backend rejects future-dated fixes).
import { ApiError, newIdempotencyKey } from '../api/client'
import { nativeBridge } from '../nativeBridge'
import type { GpsBatchResult, GpsPoint } from '../../types/driver'
import type { GpsQueue } from './gpsQueue'

export type GpsPermission = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported'

export interface GpsFix {
  lat: number
  lng: number
  accuracy: number
  speedKmh: number
  heading: number
  capturedAtMs: number
}

export interface GpsTrackerStatus {
  running: boolean
  shiftId: number | null
  permission: GpsPermission
  lastFix: GpsFix | null
  lastSentAtMs: number | null
  lastError: string | null
  queued: number
  syncing: boolean
  online: boolean
}

export interface GpsTrackerApi {
  sendGps(point: GpsPoint): Promise<{ serverTimeMs?: number | null } | void>
  syncGpsBatch(points: GpsPoint[], shiftId?: number): Promise<Partial<GpsBatchResult> | void>
}

/** Where fixes come from: the browser/WebView Geolocation API or the Flutter bridge. */
export interface LocationSource {
  readonly kind: 'browser' | 'native' | 'none'
  watch(onFix: (fix: GpsFix) => void, onError: (code: number, message: string) => void): () => void
  current(timeoutMs: number): Promise<GpsFix>
}

/** Fixes worse than this are useless for a map and are rejected by the backend (le=500). */
export const MAX_ACCURACY_METERS = 500
const BATCH_SIZE = 500
const FLUSH_INTERVAL_MS = 20_000
const NATIVE_FIX_TIMEOUT_MS = 15_000
/** Ignore sub-minute differences: they are network latency, not a wrong clock. */
const MIN_CLOCK_SKEW_MS = 60_000
/** Backend rejects fixes more than 2 minutes ahead; stay well inside that. */
const CLOCK_SKEW_SAFETY_MS = 30_000
const SKEW_STORAGE_KEY = 'mashrutgo.gps.clock_skew'
/** The backend accepts a finished shift's backlog as history for this long (see driver.py). */
const HISTORY_WINDOW_MS = 12 * 3600_000

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

function fromPosition(pos: GeolocationPosition): GpsFix {
  const c = pos.coords
  const speed = typeof c.speed === 'number' && Number.isFinite(c.speed) ? c.speed * 3.6 : 0
  const heading = typeof c.heading === 'number' && Number.isFinite(c.heading) ? c.heading : 0
  return {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: Number.isFinite(c.accuracy) ? c.accuracy : MAX_ACCURACY_METERS,
    speedKmh: clamp(speed, 0, 200),
    heading: clamp(heading, 0, 360),
    capturedAtMs: pos.timestamp || Date.now(),
  }
}

export function browserLocationSource(geo: Geolocation = navigator.geolocation): LocationSource {
  const options: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }
  return {
    kind: 'browser',
    watch(onFix, onError) {
      const id = geo.watchPosition(
        (pos) => onFix(fromPosition(pos)),
        (err) => onError(err.code, err.message),
        options,
      )
      return () => geo.clearWatch(id)
    },
    current(timeoutMs) {
      return new Promise((resolve, reject) => {
        geo.getCurrentPosition(
          (pos) => resolve(fromPosition(pos)),
          (err) => reject(Object.assign(new Error(err.message), { code: err.code })),
          { ...options, timeout: timeoutMs },
        )
      })
    },
  }
}

function nativeLocationSource(pollMs = 5_000): LocationSource {
  const source: LocationSource = {
    kind: 'native',
    // The wrapper answers one request at a time, so "watching" is polling the host.
    watch(onFix, onError) {
      let stopped = false
      const poll = async () => {
        if (stopped) return
        try {
          onFix(await source.current(NATIVE_FIX_TIMEOUT_MS))
        } catch (err) {
          onError((err as { code?: number }).code ?? 2, (err as Error).message)
        }
      }
      void poll()
      const timer = setInterval(() => void poll(), pollMs)
      return () => {
        stopped = true
        clearInterval(timer)
      }
    },
    async current() {
      const loc = await nativeBridge.requestLocation()
      if (!loc) throw Object.assign(new Error('GPS signal olinmadi'), { code: 2 })
      return {
        lat: loc.latitude,
        lng: loc.longitude,
        accuracy: loc.accuracy ?? MAX_ACCURACY_METERS,
        speedKmh: clamp((loc.speed ?? 0) * 3.6, 0, 200),
        heading: clamp(loc.heading ?? 0, 0, 360),
        capturedAtMs: loc.timestamp || Date.now(),
      }
    },
  }
  return source
}

export function defaultLocationSource(): LocationSource {
  // Inside the Flutter wrapper the native host owns the background-capable GPS: prefer it over the
  // WebView's own Geolocation, which the system throttles or blocks once the screen sleeps.
  if (nativeBridge.isNative()) return nativeLocationSource()
  if (typeof navigator !== 'undefined' && navigator.geolocation) return browserLocationSource()
  return {
    kind: 'none',
    watch: () => () => undefined,
    current: () => Promise.reject(Object.assign(new Error('Qurilmada GPS mavjud emas'), { code: 2 })),
  }
}

export async function queryGpsPermission(): Promise<GpsPermission> {
  if (typeof navigator === 'undefined' || (!navigator.geolocation && !nativeBridge.isNative())) return 'unsupported'
  try {
    const res = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    if (res) return res.state as GpsPermission
  } catch {
    // Permissions API missing (older Safari / WebView): unknown until we ask
  }
  return 'unknown'
}

const PERMISSION_DENIED = 1

function describeGeoError(code: number): string {
  if (code === PERMISSION_DENIED) return 'GPS ruxsati berilmagan. Brauzer/ilova sozlamalaridan joylashuvga ruxsat bering.'
  if (code === 3) return 'GPS signal kutilmoqda (vaqt tugadi)'
  return 'GPS signal yo‘q. Ochiq joyga chiqing yoki joylashuv xizmatini yoqing.'
}

export function toGpsPoint(fix: GpsFix, key = newIdempotencyKey(), skewMs = 0): GpsPoint {
  return {
    idempotency_key: key,
    lat: fix.lat,
    lng: fix.lng,
    speed_kmh: Math.round(fix.speedKmh * 10) / 10,
    heading: Math.round(fix.heading),
    accuracy_meters: Math.round(fix.accuracy * 10) / 10,
    captured_at: new Date(fix.capturedAtMs + skewMs).toISOString(),
  }
}

/** Server time out of an error detail (`{message, reason, server_time}`) or a response body. */
function serverTimeFromDetail(detail: unknown): number | null {
  if (!detail || typeof detail !== 'object') return null
  const raw = (detail as { server_time?: unknown }).server_time
  if (typeof raw !== 'string') return null
  const ms = Date.parse(raw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`)
  return Number.isNaN(ms) ? null : ms
}

function loadStoredSkew(): number {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SKEW_STORAGE_KEY) : null
    const ms = raw === null ? 0 : Number(raw)
    return Number.isFinite(ms) ? ms : 0
  } catch {
    return 0
  }
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true
  return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500
}

export interface GpsTrackerOptions {
  api: GpsTrackerApi
  queue: GpsQueue
  source?: LocationSource
  /** Called when the backend says the shift is no longer active (HTTP 409). */
  onShiftLost?: (message: string) => void
  isOnline?: () => boolean
}

export class GpsTracker {
  private status: GpsTrackerStatus = {
    running: false,
    shiftId: null,
    permission: 'unknown',
    lastFix: null,
    lastSentAtMs: null,
    lastError: null,
    queued: 0,
    syncing: false,
    online: true,
  }
  private listeners = new Set<(s: GpsTrackerStatus) => void>()
  private stopWatch: (() => void) | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private ticking = false
  /** Newest fix already handed to `tick` (sent, queued or rejected): avoids resending the same one. */
  private lastEvaluatedFixMs = 0
  /** server − device clock, learned from every response; 0 when the device clock is fine. */
  private skewMs = loadStoredSkew()
  private flushing: Promise<void> | null = null
  private starting: number | null = null
  private readonly source: LocationSource
  private readonly isOnline: () => boolean

  constructor(private readonly opts: GpsTrackerOptions) {
    this.source = opts.source ?? defaultLocationSource()
    this.isOnline = opts.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false)
    if (this.source.kind === 'none') this.status.permission = 'unsupported'
  }

  getStatus(): GpsTrackerStatus {
    return this.status
  }

  subscribe(fn: (s: GpsTrackerStatus) => void): () => void {
    this.listeners.add(fn)
    fn(this.status)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Learn the device↔server clock difference from a response (or a 422 detail). */
  private noteServerTime(serverTimeMs: number | null | undefined) {
    if (!serverTimeMs) return
    // The response is already a little old, so bias the correction backwards by the safety margin.
    const observed = serverTimeMs - Date.now() - CLOCK_SKEW_SAFETY_MS
    const next = Math.abs(observed) < MIN_CLOCK_SKEW_MS ? 0 : Math.round(observed)
    if (next === this.skewMs) return
    this.skewMs = next
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(SKEW_STORAGE_KEY, String(next))
    } catch {
      // Private mode: the correction still holds for this session
    }
    if (next !== 0) console.info(`GPS: qurilma soati ${Math.round(next / 1000)} s ga to‘g‘rilandi`)
  }

  /** Re-stamp queued fixes with the corrected clock (same idempotency keys, so no duplicates). */
  private restamp(points: GpsPoint[]): GpsPoint[] {
    if (!this.skewMs) return points
    return points.map((p) => {
      const ms = Date.parse(p.captured_at)
      return Number.isNaN(ms) ? p : { ...p, captured_at: new Date(ms + this.skewMs).toISOString() }
    })
  }

  private patch(p: Partial<GpsTrackerStatus>) {
    this.status = { ...this.status, ...p }
    this.listeners.forEach((fn) => fn(this.status))
  }

  private readonly onOnline = () => {
    this.patch({ online: true })
    void this.flush()
  }

  private readonly onOffline = () => this.patch({ online: false })

  /** Start (or restart for another shift). Safe to call again with the same shift. */
  async start(shiftId: number, intervalSeconds: number): Promise<void> {
    // Synchronous guard: `start` awaits, so two callers (mount + shift refresh) would otherwise
    // both get past the check and install a second watcher and timer pair.
    if (this.starting === shiftId || (this.status.running && this.status.shiftId === shiftId)) return
    this.starting = shiftId
    try {
      await this.doStart(shiftId, intervalSeconds)
    } finally {
      this.starting = null
    }
  }

  private async doStart(shiftId: number, intervalSeconds: number): Promise<void> {
    this.stop()
    // A driver who finished the previous shift offline still carries its tail in the queue
    await this.uploadLeftovers(shiftId)
    const dropped = await this.opts.queue.dropOtherShifts(shiftId)
    if (dropped) console.info(`GPS queue: dropped ${dropped} undeliverable fixes of a finished shift`)
    this.lastEvaluatedFixMs = 0
    this.patch({ running: true, shiftId, lastError: null, online: this.isOnline() })
    await this.refreshQueued()

    this.stopWatch = this.source.watch(
      (fix) => this.patch({ lastFix: fix, permission: 'granted', lastError: null }),
      (code) => this.patch({ permission: code === PERMISSION_DENIED ? 'denied' : this.status.permission, lastError: describeGeoError(code) }),
    )
    const intervalMs = Math.max(2, intervalSeconds) * 1000
    this.tickTimer = setInterval(() => void this.tick(intervalMs), intervalMs)
    this.flushTimer = setInterval(() => {
      if (this.status.queued > 0) void this.flush()
    }, FLUSH_INTERVAL_MS)
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline)
      window.addEventListener('offline', this.onOffline)
    }
    // Backlog left from before a reload goes first, then the first live fix
    await this.flush()
    await this.tick(intervalMs)
  }

  stop(): void {
    this.stopWatch?.()
    this.stopWatch = null
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.tickTimer = null
    this.flushTimer = null
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline)
      window.removeEventListener('offline', this.onOffline)
    }
    if (this.status.running) this.patch({ running: false, syncing: false })
  }

  private async refreshQueued() {
    const shiftId = this.status.shiftId
    this.patch({ queued: shiftId === null ? 0 : await this.opts.queue.count(shiftId) })
  }

  private async freshFix(intervalMs: number): Promise<GpsFix | null> {
    const latest = this.status.lastFix
    if (latest && latest.capturedAtMs > this.lastEvaluatedFixMs) return latest
    // No new fix from the watcher (stationary device / watcher idle): ask for a fresh one
    try {
      const fix = await this.source.current(Math.min(intervalMs, 10_000))
      this.patch({ lastFix: fix, permission: 'granted' })
      return fix.capturedAtMs > this.lastEvaluatedFixMs ? fix : null
    } catch (err) {
      const code = (err as { code?: number }).code ?? 2
      this.patch({
        permission: code === PERMISSION_DENIED ? 'denied' : this.status.permission,
        lastError: describeGeoError(code),
      })
      return null
    }
  }

  /** One transmission cycle (exposed for tests). */
  async tick(intervalMs = 5000): Promise<void> {
    if (!this.status.running || this.ticking) return
    this.ticking = true
    try {
      const shiftId = this.status.shiftId
      const fix = await this.freshFix(intervalMs)
      if (!fix || shiftId === null || !this.status.running) return
      // Count it as handled either way, so a stuck inaccurate fix does not block the next request
      this.lastEvaluatedFixMs = fix.capturedAtMs
      if (fix.accuracy > MAX_ACCURACY_METERS) {
        this.patch({ lastError: `GPS aniqligi juda past (±${Math.round(fix.accuracy)} m)` })
        return
      }
      const point = toGpsPoint(fix, newIdempotencyKey(), this.skewMs)

      const online = this.isOnline()
      if (!online || this.status.queued > 0) {
        // Keep ordering simple: while a backlog exists, new fixes join it and the batch sync delivers them
        await this.opts.queue.add(shiftId, point)
        await this.refreshQueued()
        this.patch({ online })
        if (online) void this.flush()
        return
      }
      try {
        const res = await this.opts.api.sendGps(point)
        this.noteServerTime(res?.serverTimeMs)
        this.patch({ lastSentAtMs: Date.now(), lastError: null, online: true })
      } catch (err) {
        await this.handleSendError(err, shiftId, [point])
      }
    } finally {
      this.ticking = false
    }
  }

  private async handleSendError(err: unknown, shiftId: number, points: GpsPoint[]) {
    if (isRetryable(err)) {
      for (const p of points) await this.opts.queue.add(shiftId, p)
      await this.refreshQueued()
      this.patch({ online: !(err instanceof ApiError && err.status === 0) && this.isOnline(), lastError: null })
      return
    }
    const apiErr = err as ApiError
    if (apiErr.status === 409) {
      this.shiftLost(apiErr.message)
    } else if (apiErr.status === 401 || apiErr.status === 403) {
      this.stop()
      this.patch({ lastError: apiErr.message })
    } else if (apiErr.status === 422 && serverTimeFromDetail(apiErr.detail) !== null) {
      // The fix was dated in the future by a wrong device clock: correct the clock and requeue it,
      // instead of silently dropping the whole shift's GPS while the app still shows "Online".
      this.noteServerTime(serverTimeFromDetail(apiErr.detail))
      for (const p of this.restamp(points)) await this.opts.queue.add(shiftId, p)
      await this.refreshQueued()
      this.patch({ lastError: null })
    } else {
      // Any other 422 (malformed fix): it can never succeed, so report it and move on
      this.patch({ lastError: apiErr.message })
    }
  }

  private shiftLost(message: string) {
    this.stop()
    // Fixes of a shift the backend no longer accepts can never be attributed: discard them
    void this.opts.queue.clear()
    this.patch({ lastError: message, queued: 0, shiftId: null })
    this.opts.onShiftLost?.(message)
  }

  /**
   * Deliver what an earlier shift left behind (the driver ended it without a connection). The
   * points carry their own shift id, so they land in that shift's history and never move a
   * vehicle on the live map. Anything past the backend's history window is dropped by the caller.
   */
  private async uploadLeftovers(currentShiftId: number): Promise<void> {
    if (!this.isOnline()) return
    for (;;) {
      const rows = await this.opts.queue.takeOtherShifts(currentShiftId, BATCH_SIZE)
      if (!rows.length) return
      const expired = rows.filter((r) => Date.now() - Date.parse(r.point.captured_at) > HISTORY_WINDOW_MS)
      if (expired.length) await this.opts.queue.remove(expired.map((r) => r.key))
      const fresh = rows.filter((r) => !expired.includes(r))
      if (!fresh.length) continue
      const shiftId = fresh[0].shiftId
      const batch = fresh.filter((r) => r.shiftId === shiftId).map((r) => r.point)
      try {
        const res = await this.opts.api.syncGpsBatch(batch, shiftId)
        this.noteServerTime((res as { serverTimeMs?: number | null } | undefined)?.serverTimeMs)
        await this.opts.queue.remove(batch.map((p) => p.idempotency_key))
      } catch (err) {
        // Best effort: a shift that is gone (409) or a refused batch must not block the new shift
        if (isRetryable(err)) return
        await this.opts.queue.remove(batch.map((p) => p.idempotency_key))
      }
    }
  }

  /** Upload the offline backlog of the current shift (idempotent, safe to call any time). */
  flush(): Promise<void> {
    // Callers overlap (tick, the 20 s timer, the `online` event): one upload at a time, and every
    // caller awaits the same run instead of returning early while fixes are still queued.
    if (this.flushing) return this.flushing
    const run = this.runFlush().finally(() => {
      this.flushing = null
    })
    this.flushing = run
    return run
  }

  private async runFlush(): Promise<void> {
    const shiftId = this.status.shiftId
    if (shiftId === null || !this.isOnline()) return
    this.patch({ syncing: true })
    try {
      for (;;) {
        const points = await this.opts.queue.take(shiftId, BATCH_SIZE)
        if (!points.length) break
        const outcome = await this.uploadBatch(points, shiftId)
        if (outcome === 'stop') return
        if (outcome === 'retry-later') break
        await this.refreshQueued()
      }
    } finally {
      await this.refreshQueued()
      this.patch({ syncing: false })
    }
  }

  /**
   * Upload one batch. A batch the backend refuses outright is split in half rather than dropped:
   * a single bad fix must not cost a whole shift's history (500 fixes ≈ 40 minutes of driving).
   */
  private async uploadBatch(points: GpsPoint[], shiftId: number): Promise<'ok' | 'retry-later' | 'stop'> {
    const keys = points.map((p) => p.idempotency_key)
    try {
      const res = await this.opts.api.syncGpsBatch(this.restamp(points), shiftId)
      this.noteServerTime(res?.serverTimeMs)
      await this.opts.queue.remove(keys)
      this.patch({ lastSentAtMs: Date.now(), online: true, lastError: null })
      return 'ok'
    } catch (err) {
      if (isRetryable(err)) {
        this.patch({ online: !(err instanceof ApiError && err.status === 0) })
        return 'retry-later'
      }
      if (err instanceof ApiError && err.status === 409) {
        this.shiftLost(err.message)
        return 'stop'
      }
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        this.stop()
        this.patch({ lastError: err.message })
        return 'stop'
      }
      if (err instanceof ApiError && err.status === 422) {
        const serverTime = serverTimeFromDetail(err.detail)
        if (serverTime !== null) {
          // Wrong device clock: correct it, then the same batch goes out re-stamped next round
          this.noteServerTime(serverTime)
          return 'retry-later'
        }
      }
      if (points.length === 1) {
        // Isolated bad fix: drop just this one so the rest of the queue keeps moving
        await this.opts.queue.remove(keys)
        this.patch({ lastError: err instanceof Error ? err.message : 'GPS nuqtasi qabul qilinmadi' })
        return 'ok'
      }
      const middle = Math.floor(points.length / 2)
      const first = await this.uploadBatch(points.slice(0, middle), shiftId)
      if (first !== 'ok') return first
      return this.uploadBatch(points.slice(middle), shiftId)
    }
  }
}
