// "Kutayapman" / "Mashinadaman" / "Tushdim" state machine backed by /client/watch/* endpoints.
// The exact GPS point is shared with the route's active drivers ONLY while status === 'WATCHING'.
import { ApiError, apiClient, errorMessage } from '../api/client'
import type { ClientWatchSession, Coordinates } from '@/types/client'

const STORAGE_KEY = 'mashrutgo_watch_session'
const HEARTBEAT_MS = 25_000

type StateListener = (session: ClientWatchSession) => void

interface WatchDto {
  watch_id: number
  client_session_id: string
  route_id: number
  direction: 'outbound' | 'inbound'
  status: 'active' | 'on_car' | 'stopped' | 'expired'
  started_at: string
}

interface CurrentRideDto {
  active: boolean
  watch: WatchDto | null
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('Qurilmada GPS mavjud emas'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 })
  })
}

class WatchStateService {
  private session: ClientWatchSession = { status: 'IDLE' }
  private listeners = new Set<StateListener>()
  private geoWatchId: number | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private lastNotice: string | null = null

  constructor() {
    this.session = this.load()
    if (this.session.status !== 'IDLE') void this.resync()
  }

  private load(): ClientWatchSession {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
      if (saved) return JSON.parse(saved) as ClientWatchSession
    } catch {
      // ignore corrupted storage
    }
    return { status: 'IDLE' }
  }

  private persist() {
    try {
      if (this.session.status === 'IDLE') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(this.session))
    } catch {
      // storage unavailable
    }
  }

  private set(next: ClientWatchSession) {
    this.session = next
    this.persist()
    const snapshot = this.getSession()
    this.listeners.forEach((l) => l(snapshot))
  }

  getSession(): ClientWatchSession {
    return { ...this.session }
  }

  /** Message for the UI after the server ended the watch (expired, etc.). Read once. */
  takeNotice(): string | null {
    const notice = this.lastNotice
    this.lastNotice = null
    return notice
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    listener(this.getSession())
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Restore state after reload: the server is the source of truth. */
  async resync(): Promise<void> {
    const { sessionSecret } = this.session
    if (!sessionSecret) {
      this.reset()
      return
    }
    try {
      const res = await apiClient.get<CurrentRideDto>('/client/ride/current', { query: { session_id: sessionSecret }, anonymous: true })
      const w = res.watch
      if (!res.active || !w) {
        this.reset('Kutish sessiyasi yakunlangan')
        return
      }
      this.set({ ...this.session, status: w.status === 'on_car' ? 'ON_VEHICLE' : 'WATCHING', watchId: w.watch_id })
      if (w.status === 'active') this.startBroadcast()
    } catch (err) {
      if (err instanceof ApiError && !err.isNetworkError) this.reset()
      // network error: keep local state, will retry on next action
    }
  }

  async startWatching(
    routeId: number,
    routeNumber: string,
    direction: 'outbound' | 'inbound',
  ): Promise<{ success: boolean; error?: string }> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { success: false, error: 'Kutish rejimini yoqish uchun internet aloqasi zarur' }
    }
    let position: GeolocationPosition
    try {
      position = await getPosition()
    } catch {
      return { success: false, error: 'Haydovchilar sizni ko‘rishi uchun joylashuv (GPS) ruxsati kerak' }
    }
    // Close any watch this device still has open (e.g. the passenger switched route), otherwise
    // its drivers keep seeing a pin for someone who left, until the server-side expiry.
    const previousSecret = this.session.sessionSecret
    if (this.session.status !== 'IDLE') await this.stopWatching()
    try {
      const watch = await apiClient.post<WatchDto>(
        '/client/watch/start',
        {
          route_id: routeId,
          direction,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy_meters: Math.round(position.coords.accuracy),
          // Reusing the session secret makes the server close the previous watch itself
          session_id: previousSecret,
        },
        { anonymous: false },
      )
      this.set({
        status: 'WATCHING',
        watchId: watch.watch_id,
        sessionSecret: watch.client_session_id,
        routeId,
        routeNumber,
        direction,
        startedAtEpochMs: Date.now(),
        lastGps: [position.coords.longitude, position.coords.latitude],
      })
      this.startBroadcast()
      return { success: true }
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Kutish rejimini yoqib bo‘lmadi') }
    }
  }

  private async sendState(state: 'on_car' | 'exited'): Promise<void> {
    await apiClient.post('/client/ride/state', {
      watch_id: this.session.watchId,
      session_id: this.session.sessionSecret,
      state,
    })
  }

  /** "Mashinadaman": stop GPS sharing immediately (locally first, then on the server). */
  async boardVehicle(): Promise<{ success: boolean; error?: string }> {
    this.stopBroadcast()
    try {
      await this.sendState('on_car')
      this.set({ ...this.session, status: 'ON_VEHICLE', lastGps: undefined })
      return { success: true }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
        this.reset('Kutish sessiyasi muddati tugagan')
        return { success: false, error: 'Kutish sessiyasi muddati tugagan' }
      }
      this.startBroadcast()
      return { success: false, error: errorMessage(err) }
    }
  }

  /** "Tushdim": finish the ride. */
  async alightVehicle(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.sendState('exited')
    } catch (err) {
      if (!(err instanceof ApiError) || err.isNetworkError) return { success: false, error: errorMessage(err) }
      // 404/409: already finished on the server — still clear locally
    }
    this.reset()
    return { success: true }
  }

  async stopWatching(): Promise<void> {
    this.stopBroadcast()
    const { watchId, sessionSecret } = this.session
    this.reset()
    if (watchId && sessionSecret) {
      await apiClient.post('/client/watch/stop', { watch_id: watchId, session_id: sessionSecret }).catch(() => undefined)
    }
  }

  private reset(notice?: string) {
    this.stopBroadcast()
    if (notice) this.lastNotice = notice
    this.set({ status: 'IDLE' })
  }

  private startBroadcast() {
    this.stopBroadcast()
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      this.geoWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          this.session.lastGps = [pos.coords.longitude, pos.coords.latitude] as Coordinates
          this.persist()
        },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
      )
    }
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS)
  }

  private stopBroadcast() {
    if (this.geoWatchId !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(this.geoWatchId)
    }
    this.geoWatchId = null
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private async heartbeat() {
    if (this.session.status !== 'WATCHING' || !this.session.watchId) return
    const [lng, lat] = this.session.lastGps ?? [undefined, undefined]
    try {
      await apiClient.post('/client/watch/heartbeat', {
        watch_id: this.session.watchId,
        session_id: this.session.sessionSecret,
        lat,
        lng,
      })
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
        this.reset('Kutish sessiyasi muddati tugadi. Kerak bo‘lsa qayta yoqing.')
      }
    }
  }
}

export const watchStateService = new WatchStateService()
