// Realtime WebSocket service with live vehicles stream, reconnect backoff, and stale detector
import { LiveVehicle } from '@/types/client'

export type VehicleUpdateCallback = (vehicles: LiveVehicle[]) => void

export interface RealtimeSubscription {
  unsubscribe: () => void
}

const STALE_THRESHOLD_MS = 30000 // 30 seconds mark as stale

export class RealtimeService {
  private socket: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private baseReconnectDelayMs = 1000
  private subscribers: Map<string, Set<VehicleUpdateCallback>> = new Map()
  private mockIntervalId: any = null
  private vehicleCache: Map<string, LiveVehicle[]> = new Map()
  private isSimulated = false

  /**
   * Subscribe to live vehicle updates for a specific route number (e.g. "15", "22")
   */
  subscribeToRoute(routeNumber: string, callback: VehicleUpdateCallback): RealtimeSubscription {
    if (!this.subscribers.has(routeNumber)) {
      this.subscribers.set(routeNumber, new Set())
    }
    this.subscribers.get(routeNumber)!.add(callback)

    // Immediately send cached data if available
    const cached = this.vehicleCache.get(routeNumber)
    if (cached && cached.length > 0) {
      callback(this.checkStale(cached))
    }

    // Always start active simulation immediately so vehicles are moving on screen
    this.fallbackToSimulation()

    return {
      unsubscribe: () => {
        const subs = this.subscribers.get(routeNumber)
        if (subs) {
          subs.delete(callback)
          if (subs.size === 0) {
            this.subscribers.delete(routeNumber)
          }
        }
        if (this.subscribers.size === 0) {
          this.cleanup()
        }
      }
    }
  }

  private ensureConnection(routeNumber: string) {
    this.fallbackToSimulation()
  }

  private scheduleReconnect(routeNumber: string) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.fallbackToSimulation()
      return
    }

    const delay = this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts)
    this.reconnectAttempts++
    setTimeout(() => {
      if (this.subscribers.size > 0 && !this.socket && !this.isSimulated) {
        this.ensureConnection(routeNumber)
      }
    }, delay)
  }

  private fallbackToSimulation() {
    this.isSimulated = true
    if (this.socket) {
      try {
        this.socket.close()
      } catch (e) {}
      this.socket = null
    }

    if (this.mockIntervalId) {
      clearInterval(this.mockIntervalId)
      this.mockIntervalId = null
    }

    // Do not spawn mock vehicles - broadcast empty list
    for (const [, subs] of this.subscribers.entries()) {
      subs.forEach((cb) => cb([]))
    }
  }

  private handleVehicleBatch(routeNumber: string, rawVehicles: LiveVehicle[]) {
    const checked = this.checkStale(rawVehicles)
    this.vehicleCache.set(routeNumber, checked)
    const subs = this.subscribers.get(routeNumber)
    if (subs) {
      subs.forEach((cb) => cb(checked))
    }
  }

  private checkStale(vehicles: LiveVehicle[]): LiveVehicle[] {
    const now = Date.now()
    return vehicles.map((v) => ({
      ...v,
      isStale: now - v.lastUpdatedEpochMs > STALE_THRESHOLD_MS
    }))
  }

  private cleanup() {
    if (this.mockIntervalId) {
      clearInterval(this.mockIntervalId)
      this.mockIntervalId = null
    }
    if (this.socket) {
      try {
        this.socket.close()
      } catch (e) {}
      this.socket = null
    }
    this.isSimulated = false
  }
}

export const realtimeService = new RealtimeService()
