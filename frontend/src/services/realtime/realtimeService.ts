// Live vehicles of one route for the client app: REST snapshot + public WebSocket updates.
import { clientApi, mapLiveVehicle, type LiveVehicleDto } from '../api/clientApi'
import { publicChannel } from './websocket'
import type { LiveVehicle } from '@/types/client'
import type { RouteStatusPayload, WsEvent } from '@/types/map'

export interface LiveVehiclesUpdate {
  vehicles: LiveVehicle[]
  /** true when the last snapshot request failed: the UI must not read this as "no vehicles". */
  failed: boolean
}

export type VehicleUpdateCallback = (update: LiveVehiclesUpdate) => void

export interface RealtimeSubscription {
  unsubscribe: () => void
}

/** Matches the backend GPS_STALE_THRESHOLD_SECONDS default. */
export const STALE_THRESHOLD_MS = 45_000

export function markStale(vehicles: LiveVehicle[], now = Date.now()): LiveVehicle[] {
  return vehicles.map((v) => ({ ...v, isStale: v.isStale || now - v.lastUpdatedEpochMs > STALE_THRESHOLD_MS }))
}

export function subscribeToRouteVehicles(
  routeId: number,
  callback: VehicleUpdateCallback,
  onError?: (err: unknown) => void,
): RealtimeSubscription {
  const vehicles = new Map<string, LiveVehicle>()
  let active = true
  let failed = false

  const emit = () => {
    if (active) callback({ vehicles: markStale(Array.from(vehicles.values())), failed })
  }

  const refresh = () => {
    clientApi
      .liveVehicles(routeId)
      .then((list) => {
        vehicles.clear()
        list.forEach((v) => vehicles.set(v.id, v))
        failed = false
        emit()
      })
      .catch((err) => {
        if (!active) return
        // Keep the last known vehicles and tell the UI the data is stale, never pretend "0 online"
        failed = true
        onError?.(err)
        emit()
      })
  }

  const release = publicChannel.acquire()
  const offLocation = publicChannel.on('vehicle.location.updated', (evt: WsEvent) => {
    const payload = evt.payload as LiveVehicleDto
    if (payload.route_id !== routeId) return
    vehicles.set(payload.vehicle_id, mapLiveVehicle(payload))
    failed = false // a live event proves the stream works again
    emit()
  })
  const offStatus = publicChannel.on('route.vehicle.status', (evt: WsEvent) => {
    if ((evt.payload as RouteStatusPayload).route_id === routeId) refresh()
  })
  const offState = publicChannel.onStateChange((state) => {
    if (state === 'connected') refresh() // resync after reconnect
  })
  const staleTimer = setInterval(emit, 5_000)

  refresh()

  return {
    unsubscribe: () => {
      active = false
      clearInterval(staleTimer)
      offLocation()
      offStatus()
      offState()
      release()
    },
  }
}
