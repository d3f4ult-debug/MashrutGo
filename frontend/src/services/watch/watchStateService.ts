// Client Watch & Ride State Service with Local Persistence and GPS Broadcast
import { ClientWatchSession, Coordinates, WatchStatus } from '@/types/client'

const STORAGE_KEY = 'mashrutgo_watch_session'

type StateListener = (session: ClientWatchSession) => void

class WatchStateService {
  private currentSession: ClientWatchSession
  private listeners: Set<StateListener> = new Set()
  private geoWatchId: number | null = null

  constructor() {
    this.currentSession = this.loadFromStorage()
    // Resume GPS tracking if was WATCHING before reload
    if (this.currentSession.status === 'WATCHING') {
      this.startGpsBroadcast()
    }
  }

  private loadFromStorage(): ClientWatchSession {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        return JSON.parse(saved)
      }
    } catch (e) {
      // ignore
    }
    return { status: 'IDLE' }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentSession))
    } catch (e) {
      // ignore
    }
  }

  getSession(): ClientWatchSession {
    return { ...this.currentSession }
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    listener(this.getSession())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    this.saveToStorage()
    const session = this.getSession()
    this.listeners.forEach((l) => l(session))
  }

  /**
   * Action 1: "Kutayapman" — Start watching route and broadcast exact GPS to drivers
   */
  startWatching(routeNumber: string, targetStopId?: string): { success: boolean; error?: string } {
    if (!navigator.onLine) {
      return { success: false, error: 'Kutish rejimini faollashtirish uchun internet aloqasi zarur' }
    }

    this.currentSession = {
      status: 'WATCHING',
      routeNumber,
      targetStopId,
      startedAtEpochMs: Date.now()
    }

    this.startGpsBroadcast()
    this.notify()
    return { success: true }
  }

  /**
   * Action 2: "Mashinadaman" — Stop GPS broadcast immediately and enter Ride state
   */
  boardVehicle(): void {
    this.stopGpsBroadcast()
    this.currentSession = {
      ...this.currentSession,
      status: 'ON_VEHICLE'
    }
    this.notify()
  }

  /**
   * Action 3: "Tushdim" — Complete ride and reset to IDLE
   */
  alightVehicle(): void {
    this.stopGpsBroadcast()
    this.currentSession = { status: 'IDLE' }
    this.notify()
  }

  /**
   * Stop watching voluntarily without boarding
   */
  stopWatching(): void {
    this.stopGpsBroadcast()
    this.currentSession = { status: 'IDLE' }
    this.notify()
  }

  private startGpsBroadcast() {
    this.stopGpsBroadcast()
    if (!('geolocation' in navigator)) return

    try {
      this.geoWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          const coords: Coordinates = [pos.coords.longitude, pos.coords.latitude]
          this.currentSession.lastGps = coords
          this.saveToStorage()
          // Broadcast to backend via websocket or HTTP endpoint
          this.broadcastGpsToDrivers(coords)
        },
        (err) => {
          console.warn('GPS broadcast error:', err.message)
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      )
    } catch (e) {
      // ignore
    }
  }

  private stopGpsBroadcast() {
    if (this.geoWatchId !== null && 'geolocation' in navigator) {
      try {
        navigator.geolocation.clearWatch(this.geoWatchId)
      } catch (e) {}
      this.geoWatchId = null
    }
  }

  private broadcastGpsToDrivers(coords: Coordinates) {
    // When Dev 1 backend is active, this POSTs to /api/v1/client/watch/heartbeat
    // Silently fails gracefully if endpoint is not up yet
    if (navigator.onLine && this.currentSession.routeNumber) {
      try {
        fetch('/api/v1/client/watch/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            routeNumber: this.currentSession.routeNumber,
            coordinates: coords,
            timestamp: Date.now()
          })
        }).catch(() => {})
      } catch (e) {}
    }
  }
}

export const watchStateService = new WatchStateService()
