/**
 * Driver session: profile/assignment, shift lifecycle, GPS transmission, offline queue,
 * the authenticated driver WebSocket and live "Kutayapman" passengers.
 *
 * Mounted once in DriverLayout so tracking keeps running while the driver switches pages.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { ApiError, errorMessage } from '../services/api/client'
import { driverApi } from '../services/api/driverApi'
import { createGpsQueue } from '../services/driver/gpsQueue'
import { GpsTracker, queryGpsPermission, type GpsTrackerStatus } from '../services/driver/gpsTracker'
import { actionFromEvent, waitingReducer } from '../services/driver/waitingPassengers'
import { driverChannel, type ConnectionState } from '../services/realtime/websocket'
import { nativeBridge } from '../services/nativeBridge'
import { useChannel } from '../hooks/useRealtime'
import type { DirectionType, DriverMe, DriverShift, WaitingPassenger } from '../types/driver'
import type { DriverParkingPayload, WsEvent } from '../types/map'

export interface ParkingPresence {
  parkingId: number | null
  parkingName: string | null
  isInside: boolean
}

interface DriverSessionValue {
  me: DriverMe | null
  loading: boolean
  error: string | null
  shift: DriverShift | null
  gps: GpsTrackerStatus
  wsState: ConnectionState
  waiting: WaitingPassenger[]
  parking: ParkingPresence | null
  /** Shift ended outside this device (administrator / another session). */
  notice: string | null
  busy: boolean
  reload: () => Promise<void>
  startShift: (direction: DirectionType) => Promise<void>
  endShift: (notes?: string) => Promise<void>
  switchDirection: (direction: DirectionType) => Promise<void>
  syncNow: () => Promise<void>
  dismissNotice: () => void
}

const Ctx = createContext<DriverSessionValue | null>(null)

function useWakeLock(active: boolean) {
  // Flutter wrapper: native keep-screen-on (WebView timers pause when the screen sleeps)
  useEffect(() => {
    if (!active || !nativeBridge.isNative()) return
    nativeBridge.setKeepScreenOn(true)
    return () => {
      nativeBridge.setKeepScreenOn(false)
    }
  }, [active])

  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let sentinel: { release: () => Promise<void> } | null = null
    let cancelled = false
    const acquire = async () => {
      try {
        sentinel = await (navigator as Navigator & { wakeLock: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock.request('screen')
      } catch {
        // denied (battery saver / not visible): GPS still works, the screen may just dim
      }
    }
    const onVisible = () => {
      if (!cancelled && document.visibilityState === 'visible') void acquire()
    }
    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      sentinel?.release().catch(() => undefined)
    }
  }, [active])
}

export function DriverSessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<DriverMe | null>(null)
  const [shift, setShift] = useState<DriverShift | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [parking, setParking] = useState<ParkingPresence | null>(null)
  const [waitingState, dispatchWaiting] = useReducer(waitingReducer, {})

  const queueRef = useRef(createGpsQueue())
  const trackerRef = useRef<GpsTracker | null>(null)
  if (!trackerRef.current) {
    trackerRef.current = new GpsTracker({
      api: driverApi,
      queue: queueRef.current,
      onShiftLost: (message) => {
        setShift(null)
        setNotice(`Smena faol emas: ${message}`)
      },
    })
  }
  const tracker = trackerRef.current
  const [gps, setGps] = useState<GpsTrackerStatus>(tracker.getStatus())
  useEffect(() => tracker.subscribe(setGps), [tracker])

  const reload = useCallback(async () => {
    try {
      const data = await driverApi.me()
      setMe(data)
      setShift(data.activeShift)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Haydovchi ma’lumotlarini yuklab bo‘lmadi'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Initial stoyanka presence (afterwards `parking.status` events keep it current)
  const shiftId = shift?.status === 'active' ? shift.id : null
  useEffect(() => {
    if (shiftId === null) {
      setParking(null)
      return
    }
    driverApi
      .parkings()
      .then((list) => {
        const inside = list.find((p) => p.isDriverInside)
        setParking({ parkingId: inside?.id ?? null, parkingName: inside?.name ?? null, isInside: Boolean(inside) })
      })
      .catch(() => undefined)
  }, [shiftId])

  // GPS transmission follows the shift (also resumes after a page reload)
  const intervalSeconds = me?.gpsIntervalSeconds ?? 5
  useEffect(() => {
    if (shiftId === null) {
      tracker.stop()
      return
    }
    void tracker.start(shiftId, intervalSeconds)
  }, [tracker, shiftId, intervalSeconds])

  useEffect(() => () => tracker.stop(), [tracker])
  useWakeLock(shiftId !== null)

  // Realtime driver channel: passengers, parking presence, forced shift end
  const wsState = useChannel(driverChannel)
  const routeId = shiftId !== null ? shift?.routeId ?? null : null
  const routeRef = useRef(routeId)
  routeRef.current = routeId

  useEffect(() => {
    const offAny = driverChannel.onAny((evt: WsEvent) => {
      const action = actionFromEvent(evt.type, evt.payload, routeRef.current)
      if (action) dispatchWaiting(action)
    })
    const offParking = driverChannel.on('parking.status', (evt) => {
      const p = evt.payload as DriverParkingPayload
      setParking({ parkingId: p.parking_id, parkingName: p.parking_name, isInside: p.is_inside })
    })
    const offForced = driverChannel.on('shift.force_ended', (evt) => {
      const reason = (evt.payload as { reason?: string }).reason
      tracker.stop()
      void queueRef.current.clear()
      setShift(null)
      setNotice(`Smenangiz administrator tomonidan yakunlandi${reason ? `: ${reason}` : ''}`)
    })
    return () => {
      offAny()
      offParking()
      offForced()
    }
  }, [tracker])

  // REST snapshot of waiting passengers whenever the shift/route or the connection changes
  useEffect(() => {
    if (routeId === null) {
      dispatchWaiting({ type: 'clear' })
      return
    }
    if (wsState !== 'connected') return
    let cancelled = false
    driverApi
      .waitingPassengers()
      .then((list) => {
        if (!cancelled) dispatchWaiting({ type: 'snapshot', passengers: list.filter((p) => p.routeId === routeId) })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [routeId, wsState])

  const startShift = useCallback(
    async (direction: DirectionType) => {
      setBusy(true)
      try {
        const permission = await queryGpsPermission()
        if (permission === 'denied') {
          throw new Error('GPS ruxsati berilmagan. Smenani boshlashdan oldin joylashuvga ruxsat bering.')
        }
        if (permission === 'unsupported') {
          throw new Error('Bu qurilmada GPS mavjud emas. Smartfondan foydalaning.')
        }
        let started: DriverShift
        try {
          started = await driverApi.startShift(direction)
        } catch (err) {
          // 409 = a shift is already active (another device/tab): converge to the server state
          if (err instanceof ApiError && err.status === 409) void reload()
          throw err
        }
        setShift(started)
        setNotice(null)
        // The server re-reads the driver's route on connect and sends the waiting-passenger snapshot
        driverChannel.reconnect()
      } finally {
        setBusy(false)
      }
    },
    [reload],
  )

  const endShift = useCallback(
    async (notes?: string) => {
      setBusy(true)
      try {
        await tracker.flush()
        try {
          await driverApi.endShift(notes)
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) throw err
          // 404 = already ended elsewhere: converge to the server state
        }
        tracker.stop()
        // Whatever the flush could not deliver (driver offline in the moment they finish) stays in
        // the queue: the backend accepts a closed shift's history, and the next start uploads it.
        setShift(null)
        dispatchWaiting({ type: 'clear' })
        void reload()
      } finally {
        setBusy(false)
      }
    },
    [tracker, reload],
  )

  const switchDirection = useCallback(async (direction: DirectionType) => {
    setBusy(true)
    try {
      setShift(await driverApi.switchDirection(direction))
    } finally {
      setBusy(false)
    }
  }, [])

  const syncNow = useCallback(() => tracker.flush(), [tracker])
  const dismissNotice = useCallback(() => setNotice(null), [])

  const waiting = useMemo(() => Object.values(waitingState).sort((a, b) => a.waitingSinceMs - b.waitingSinceMs), [waitingState])

  const value = useMemo<DriverSessionValue>(
    () => ({
      me,
      loading,
      error,
      shift: shiftId !== null ? shift : null,
      gps,
      wsState,
      waiting,
      parking,
      notice,
      busy,
      reload,
      startShift,
      endShift,
      switchDirection,
      syncNow,
      dismissNotice,
    }),
    [me, loading, error, shiftId, shift, gps, wsState, waiting, parking, notice, busy, reload, startShift, endShift, switchDirection, syncNow, dismissNotice],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDriverSession(): DriverSessionValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDriverSession must be used within DriverSessionProvider')
  return ctx
}
