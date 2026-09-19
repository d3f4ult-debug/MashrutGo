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

    // Try connecting to real WS or fallback to realistic simulation
    this.ensureConnection(routeNumber)

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
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/api/v1/ws/live-vehicles'
    
    // If running in browser and no backend WS is live, start simulator
    if (!this.socket && !this.isSimulated) {
      try {
        this.socket = new WebSocket(`${wsUrl}?route=${routeNumber}`)
        
        this.socket.onopen = () => {
          this.reconnectAttempts = 0
          this.isSimulated = false
        }

        this.socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (data.routeNumber && Array.isArray(data.vehicles)) {
              this.handleVehicleBatch(data.routeNumber, data.vehicles)
            }
          } catch (e) {
            // invalid json
          }
        }

        this.socket.onerror = () => {
          // fallback to simulation on connection failure
          this.fallbackToSimulation()
        }

        this.socket.onclose = () => {
          this.socket = null
          if (!this.isSimulated && this.subscribers.size > 0) {
            this.scheduleReconnect(routeNumber)
          }
        }
      } catch (e) {
        this.fallbackToSimulation()
      }
    }
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

    if (this.mockIntervalId) return

    // Initialize mock vehicles for Andijon routes
    const mockState: Record<string, LiveVehicle[]> = {
      '15': [
        {
          id: 'v-15-1',
          routeNumber: '15',
          licensePlate: '60 A 105 AA',
          coordinates: [72.344, 40.781],
          speedKmh: 28,
          headingDeg: 110,
          lastUpdatedEpochMs: Date.now(),
          etaMinutesToNextStop: 3
        },
        {
          id: 'v-15-2',
          routeNumber: '15',
          licensePlate: '60 B 220 BA',
          coordinates: [72.352, 40.778],
          speedKmh: 32,
          headingDeg: 115,
          lastUpdatedEpochMs: Date.now() - 5000,
          etaMinutesToNextStop: 7
        },
        {
          id: 'v-15-3',
          routeNumber: '15',
          licensePlate: '60 C 330 CA',
          coordinates: [72.358, 40.775],
          speedKmh: 0, // at stop
          headingDeg: 110,
          lastUpdatedEpochMs: Date.now() - 35000, // Stale example (>30s)
          etaMinutesToNextStop: null // Do not invent fake ETA if null
        }
      ],
      '22': [
        {
          id: 'v-22-1',
          routeNumber: '22',
          licensePlate: '60 D 404 DA',
          coordinates: [72.352, 40.788],
          speedKmh: 35,
          headingDeg: 80,
          lastUpdatedEpochMs: Date.now(),
          etaMinutesToNextStop: 4
        },
        {
          id: 'v-22-2',
          routeNumber: '22',
          licensePlate: '60 E 515 EA',
          coordinates: [72.368, 40.792],
          speedKmh: 22,
          headingDeg: 75,
          lastUpdatedEpochMs: Date.now() - 8000,
          etaMinutesToNextStop: 8
        }
      ],
      '33': [
        {
          id: 'v-33-1',
          routeNumber: '33',
          licensePlate: '60 F 616 FA',
          coordinates: [72.330, 40.796],
          speedKmh: 29,
          headingDeg: 130,
          lastUpdatedEpochMs: Date.now(),
          etaMinutesToNextStop: 5
        }
      ]
    }

    this.mockIntervalId = setInterval(() => {
      for (const [route, subs] of this.subscribers.entries()) {
        const vehicles = mockState[route] || []
        // Slightly advance moving vehicles
        vehicles.forEach((v) => {
          if (v.speedKmh > 0) {
            v.coordinates[0] += (Math.random() - 0.48) * 0.0003
            v.coordinates[1] += (Math.random() - 0.5) * 0.0002
            v.lastUpdatedEpochMs = Date.now()
          }
        })
        const checked = this.checkStale(vehicles)
        this.vehicleCache.set(route, checked)
        subs.forEach((cb) => cb(checked))
      }
    }, 2500)
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
