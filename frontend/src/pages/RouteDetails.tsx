import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AppMap from '@/components/map/AppMap'
import WatchActionBar from '@/components/client/WatchActionBar'
import PaymentModal from '@/components/client/PaymentModal'
import LoadingSkeleton from '@/components/ui/LoadingSkeleton'
import { clientApi } from '@/services/api/clientApi'
import { errorMessage } from '@/services/api/client'
import { subscribeToRouteVehicles } from '@/services/realtime/realtimeService'
import { getCurrentPosition } from '@/services/geolocation'
import {
  addMarker,
  clearPolyline,
  drawPolyline,
  fitBoundsToCoordinates,
  removeMarker,
} from '@/services/map/maptiler'
import { formatSom } from '@/components/ui/RouteCard'
import type { Coordinates, EtaInfo, LiveVehicle, RouteStop, RouteView } from '@/types/client'
import { uz } from '@/locales/uz'

function distanceMeters(a: Coordinates, b: Coordinates): number {
  const R = 6371000
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export default function RouteDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const routeId = Number(id)

  const [route, setRoute] = useState<RouteView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [map, setMap] = useState<any | null>(null)
  const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound')
  const [vehicles, setVehicles] = useState<LiveVehicle[]>([])
  const [liveError, setLiveError] = useState<string | null>(null)
  const [userPos, setUserPos] = useState<Coordinates | null>(null)
  const [boardingStop, setBoardingStop] = useState<RouteStop | null>(null)
  const [eta, setEta] = useState<EtaInfo | null>(null)
  const [isPayOpen, setIsPayOpen] = useState(false)
  const vehicleMarkers = useRef(new Set<string>())
  const stopMarkers = useRef(new Set<string>())

  const load = useCallback(() => {
    if (!Number.isFinite(routeId)) {
      setError('Marshrut topilmadi')
      setLoading(false)
      return
    }
    setLoading(true)
    clientApi
      .getRoute(routeId)
      .then((r) => {
        setRoute(r)
        setError(null)
      })
      .catch((err) => setError(errorMessage(err, 'Marshrut topilmadi')))
      .finally(() => setLoading(false))
  }, [routeId])

  useEffect(load, [load])

  useEffect(() => {
    getCurrentPosition()
      .then((pos) => setUserPos([pos.coords.longitude, pos.coords.latitude]))
      .catch(() => setUserPos(null))
  }, [])

  const current = useMemo(() => route?.directions.find((d) => d.type === direction) ?? route?.directions[0] ?? null, [route, direction])

  // Nearest stop to the passenger becomes the default boarding stop
  useEffect(() => {
    if (!current) return
    if (userPos) {
      const nearest = [...current.stops].sort((a, b) => distanceMeters(userPos, a.coordinates) - distanceMeters(userPos, b.coordinates))[0]
      setBoardingStop(nearest ?? null)
    } else {
      setBoardingStop(null)
    }
  }, [current, userPos])

  // Live vehicles (REST snapshot + WebSocket)
  useEffect(() => {
    if (!route) return
    const sub = subscribeToRouteVehicles(
      route.id,
      ({ vehicles: list, failed }) => {
        setVehicles(list)
        // Only a successful snapshot clears the warning: a failed fetch must never look like
        // "no vehicles online".
        if (!failed) setLiveError(null)
      },
      (err) => setLiveError(errorMessage(err, 'Jonli ma’lumot vaqtincha mavjud emas')),
    )
    return () => sub.unsubscribe()
  }, [route])

  // ETA to the boarding stop (only from real live GPS; otherwise shown as unavailable)
  useEffect(() => {
    if (!route || !current || !boardingStop) {
      setEta(null)
      return
    }
    let cancelled = false
    const fetchEta = () =>
      clientApi
        .eta(route.id, current.type, boardingStop.coordinates, boardingStop.name)
        .then((res) => !cancelled && setEta(res))
        .catch(() => !cancelled && setEta(null))
    void fetchEta()
    const timer = setInterval(fetchEta, 20_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [route, current, boardingStop])

  // Route geometry & stops. Vehicle markers are owned by the effect below; removing only the
  // stop markers here keeps live vehicles on the map when the direction changes.
  useEffect(() => {
    if (!map || !current) return
    stopMarkers.current.forEach((id) => removeMarker(map, id))
    stopMarkers.current = new Set()
    clearPolyline(map, 'route-line')
    drawPolyline(map, 'route-line', current.geometry, { color: direction === 'outbound' ? '#2563eb' : '#16a34a', width: 5 })
    current.stops.forEach((stop, index) => {
      const id = `stop-${stop.id}`
      addMarker(map, id, stop.coordinates, {
        type: index === 0 ? 'boarding' : index === current.stops.length - 1 ? 'alighting' : 'stop',
        label: `${index + 1}`,
      })
      stopMarkers.current.add(id)
    })
    if (userPos) {
      addMarker(map, 'user', userPos, { type: 'user' })
      stopMarkers.current.add('user')
    }
    fitBoundsToCoordinates(map, current.geometry)
  }, [map, current, direction, userPos])

  // Vehicle markers
  useEffect(() => {
    if (!map || !route) return
    const seen = new Set<string>()
    vehicles.forEach((v) => {
      seen.add(v.id)
      addMarker(map, `veh-${v.id}`, v.coordinates, {
        type: 'vehicle',
        label: route.routeNumber,
        isStale: v.isStale,
        color: v.direction === 'outbound' ? '#2563eb' : '#16a34a',
      })
    })
    vehicleMarkers.current.forEach((vid) => {
      if (!seen.has(vid)) removeMarker(map, `veh-${vid}`)
    })
    vehicleMarkers.current = seen
  }, [map, route, vehicles])

  if (loading) {
    return (
      <div className="space-y-3">
        <LoadingSkeleton className="h-28 rounded-2xl" />
        <LoadingSkeleton className="h-80 rounded-2xl" />
      </div>
    )
  }

  if (error || !route || !current) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-neutral-200 shadow-xs space-y-4">
        <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto text-2xl">
          <i className="ri-road-map-line"></i>
        </div>
        <div>
          <h3 className="font-bold text-neutral-900">Marshrut topilmadi</h3>
          <p className="text-xs text-neutral-500 mt-1">{error}</p>
        </div>
        <div className="flex gap-2 justify-center">
          <button onClick={load} className="px-4 py-2 bg-neutral-100 rounded-xl text-xs font-semibold">
            Qayta urinish
          </button>
          <button onClick={() => navigate('/')} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold">
            Asosiy sahifa
          </button>
        </div>
      </div>
    )
  }

  const directionVehicles = vehicles.filter((v) => v.direction === current.type)
  const parked = vehicles.filter((v) => v.parkingId && !v.isStale).length
  const onlineCount = vehicles.filter((v) => !v.isStale).length

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 border border-neutral-200 shadow-xs">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-blue-600 text-white font-black text-xl flex items-center justify-center shadow-sm shrink-0">
              {route.routeNumber}
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-neutral-900 truncate">{route.name}</h1>
              <div className="text-xs text-neutral-500 flex items-center gap-1.5">
                <span className="truncate">{current.originName}</span>
                <i className="ri-arrow-right-line text-neutral-400"></i>
                <span className="truncate">{current.destinationName}</span>
              </div>
              {route.directions.length > 1 && (
                <button
                  type="button"
                  onClick={() => setDirection(direction === 'outbound' ? 'inbound' : 'outbound')}
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded"
                >
                  <i className="ri-arrow-left-right-line text-xs"></i>
                  <span>{direction === 'outbound' ? 'Borish yo‘nalishi (almashtirish ⇄)' : 'Qaytish yo‘nalishi (almashtirish ⇄)'}</span>
                </button>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-base font-bold text-blue-600">{route.fareSoM !== null ? formatSom(route.fareSoM) : 'Tarif belgilanmagan'}</div>
            <div className="text-[11px] text-neutral-500">{route.uyushmaName}</div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center justify-between gap-2 text-xs flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${onlineCount > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-400'}`}></span>
            <span className="font-semibold text-neutral-800">
              {liveError ? 'Jonli ma’lumot vaqtincha mavjud emas' : onlineCount > 0 ? `${onlineCount} ta mashina liniyada` : uz.alternatives.noLiveVehicles}
            </span>
          </div>
          <div className="flex items-center gap-3 text-neutral-500">
            <span>
              Stoyankada: <strong>{parked} ta</strong>
            </span>
            <button onClick={() => setIsPayOpen(true)} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold flex items-center gap-1">
              <i className="ri-qr-scan-line"></i>
              <span>To‘lash</span>
            </button>
          </div>
        </div>
        {liveError && <div className="mt-2 text-[11px] text-amber-600">{liveError}</div>}
      </div>

      <WatchActionBar routeId={route.id} routeNumber={route.routeNumber} direction={current.type} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-7">
          <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-xs">
            <div className="p-3 border-b border-neutral-100 flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-800 flex items-center gap-1.5">
                <i className="ri-radar-fill text-blue-600"></i>
                <span>Jonli transport harakati</span>
              </span>
            </div>
            <div className="h-80 sm:h-[420px] w-full relative">
              <AppMap center={current.stops[0]?.coordinates} onMapReady={setMap} />
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-2xl p-4 border border-neutral-200 shadow-xs space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Kutish vaqti (ETA)</h3>
            {!boardingStop ? (
              <p className="text-xs text-neutral-500">Bekatni ro‘yxatdan tanlang — shu bekatgacha kelish vaqti hisoblanadi.</p>
            ) : eta?.hasApproachingVehicle && eta.etaMinutes !== null ? (
              <div className="flex items-center justify-between">
                <div className="text-xs text-neutral-600">
                  <div className="font-semibold text-neutral-800">{boardingStop.name}</div>
                  <div>
                    {eta.plateNumber || eta.vehicleId} · {eta.distanceMeters ? `${Math.round(eta.distanceMeters)} m` : ''}
                  </div>
                </div>
                <div className="text-2xl font-black text-blue-700">~{eta.etaMinutes} daq</div>
              </div>
            ) : (
              <div className="text-xs text-neutral-500">
                <div className="font-semibold text-neutral-700">{boardingStop.name}</div>
                {uz.routeDetails.etaCalculating}. Yaqinlashayotgan onlayn mashina ko‘rinmayapti — bu transport yo‘q degani emas.
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl p-4 border border-neutral-200 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Liniyadagi transport</h3>
            {directionVehicles.length === 0 ? (
              <div className="p-3 bg-neutral-50 rounded-xl text-xs text-neutral-500 text-center">
                {liveError ? 'Jonli ma’lumotni yuklab bo‘lmadi — qayta urinilmoqda' : uz.alternatives.noLiveVehicles}
              </div>
            ) : (
              <div className="space-y-2">
                {directionVehicles.map((v) => (
                  <div
                    key={v.id}
                    className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                      v.isStale ? 'bg-neutral-50 border-neutral-200 text-neutral-400' : 'bg-white border-neutral-200 text-neutral-800'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-white text-[11px] ${v.isStale ? 'bg-neutral-400' : 'bg-blue-600'}`}>
                        {route.routeNumber}
                      </div>
                      <div>
                        <div className="font-bold">{v.licensePlate || v.id}</div>
                        <div className="text-[11px] text-neutral-500">Tezlik: {v.speedKmh} km/soat</div>
                      </div>
                    </div>
                    {v.isStale && <span className="text-[10px] text-amber-600 font-semibold">Ma’lumot eskirgan</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl p-4 border border-neutral-200 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Bekatlar ({current.stops.length} ta)</h3>
            <div className="space-y-1">
              {current.stops.map((stop, idx) => (
                <button
                  key={stop.id}
                  type="button"
                  onClick={() => setBoardingStop(stop)}
                  className={`w-full flex items-center gap-2.5 text-xs text-left px-2 py-1.5 rounded-lg ${
                    boardingStop?.id === stop.id ? 'bg-blue-50 text-blue-800 font-semibold' : 'text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-neutral-100 text-neutral-600 font-bold flex items-center justify-center text-[10px]">{idx + 1}</span>
                  <span>{stop.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <PaymentModal isOpen={isPayOpen} onClose={() => setIsPayOpen(false)} />
    </div>
  )
}
