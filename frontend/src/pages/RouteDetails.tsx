import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import AppMap from '@/components/map/AppMap'
import WatchActionBar from '@/components/client/WatchActionBar'
import PaymentModal from '@/components/client/PaymentModal'
import { getRouteByNumber, RouteOverview } from '@/services/routing/routingService'
import { realtimeService } from '@/services/realtime/realtimeService'
import {
  addMarker,
  clearAllMarkers,
  drawPolyline,
  clearPolyline,
  fitBoundsToCoordinates
} from '@/services/map/maptiler'
import { LiveVehicle } from '@/types/client'
import { uz } from '@/locales/uz'

export default function RouteDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const routeNumber = id || '15'
  const routeData: RouteOverview | null = getRouteByNumber(routeNumber)

  const [map, setMap] = useState<any | null>(null)
  const [vehicles, setVehicles] = useState<LiveVehicle[]>([])
  const [isPayModalOpen, setIsPayModalOpen] = useState(false)
  const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound')

  const handleMapReady = useCallback((m: any) => {
    setMap(m)
  }, [])

  const currentStops = routeData
    ? direction === 'outbound'
      ? routeData.stops
      : [...routeData.stops].reverse()
    : []

  const currentGeometry = routeData
    ? direction === 'outbound'
      ? routeData.geometry
      : [...routeData.geometry].reverse()
    : []

  // Draw route geometry and stops on map
  useEffect(() => {
    if (!map || !routeData) return

    clearAllMarkers(map)
    clearPolyline(map, `route-${routeNumber}`)

    // Draw main transit polyline
    drawPolyline(map, `route-${routeNumber}`, currentGeometry, {
      color: '#2563eb',
      width: 5
    })

    // Draw stops
    currentStops.forEach((stop, index) => {
      const isFirst = index === 0
      const isLast = index === currentStops.length - 1
      addMarker(map, `stop-${stop.id}`, stop.coordinates, {
        type: isFirst ? 'boarding' : isLast ? 'alighting' : 'stop',
        label: `${index + 1}`
      })
    })

    fitBoundsToCoordinates(map, currentGeometry)
  }, [map, routeData, routeNumber, direction])

  // Subscribe to live vehicle websocket stream
  useEffect(() => {
    if (!routeNumber) return

    const sub = realtimeService.subscribeToRoute(routeNumber, (updatedVehicles) => {
      setVehicles(updatedVehicles)
      if (map) {
        updatedVehicles.forEach((v) => {
          addMarker(map, `veh-${v.id}`, v.coordinates, {
            type: 'vehicle',
            label: routeNumber,
            isStale: v.isStale
          })
        })
      }
    })

    return () => {
      sub.unsubscribe()
    }
  }, [map, routeNumber])

  if (!routeData) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-neutral-200 shadow-xs space-y-4">
        <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto text-2xl">
          <i className="ri-road-map-line"></i>
        </div>
        <div>
          <h3 className="font-bold text-neutral-900">{routeNumber}-marshrut topilmadi</h3>
          <p className="text-xs text-neutral-500 mt-1">
            Mavjud marshrutlar: 15, 22, 7, 33
          </p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold"
        >
          Asosiy sahifaga qaytish
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Route Header Card */}
      <div className="bg-white rounded-2xl p-4 border border-neutral-200 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-blue-600 text-white font-black text-2xl flex items-center justify-center shadow-sm">
              {routeData.routeNumber}
            </div>
            <div>
              <h1 className="text-lg font-bold text-neutral-900">{routeData.name}</h1>
              <div className="text-xs text-neutral-500 flex items-center gap-1.5">
                <span>{direction === 'outbound' ? routeData.originName : routeData.destinationName}</span>
                <i className="ri-arrow-right-line text-neutral-400"></i>
                <span>{direction === 'outbound' ? routeData.destinationName : routeData.originName}</span>
              </div>
              <button
                type="button"
                onClick={() => setDirection(direction === 'outbound' ? 'inbound' : 'outbound')}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 bg-blue-50 px-2 py-0.5 rounded transition-colors"
              >
                <i className="ri-arrow-left-right-line text-xs"></i>
                <span>{direction === 'outbound' ? 'To‘g‘ri yo‘nalish (O‘zgartirish ⇄)' : 'Qaytish yo‘nalishi (O‘zgartirish ⇄)'}</span>
              </button>
            </div>
          </div>

          <div className="text-right">
            <div className="text-base font-bold text-blue-600">
              {routeData.fareSoM.toLocaleString('uz-UZ')} so‘m
            </div>
            <div className="text-[11px] text-neutral-500">
              Interval: ~{routeData.intervalMinutes} daqiqa
            </div>
          </div>
        </div>

        {/* Live Status Pills */}
        <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-semibold text-neutral-800">
              {vehicles.length > 0
                ? `${vehicles.length} ta mashina liniyada`
                : uz.alternatives.noLiveVehicles}
            </span>
          </div>

          <div className="flex items-center gap-3 text-neutral-500">
            <span>
              Bekatda kutayotgan: <strong>{routeData.parkedVehiclesCount} ta</strong>
            </span>
            <button
              onClick={() => setIsPayModalOpen(true)}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs flex items-center gap-1"
            >
              <i className="ri-qr-scan-line"></i>
              <span>To‘lash</span>
            </button>
          </div>
        </div>
      </div>

      {/* "Kutayapman" Watch & Ride State Action Bar */}
      <WatchActionBar routeNumber={routeNumber} />

      {/* Map + Live Fleet Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Interactive Map */}
        <div className="lg:col-span-7">
          <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-xs">
            <div className="p-3 border-b border-neutral-100 flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-800 flex items-center gap-1.5">
                <i className="ri-radar-fill text-blue-600"></i>
                <span>Jonli transport harakati</span>
              </span>
              <span className="text-[11px] text-emerald-600 font-semibold">
                WebSocket Jonli
              </span>
            </div>
            <div className="h-80 sm:h-[420px] w-full relative">
              <AppMap onMapReady={handleMapReady} />
            </div>
          </div>
        </div>

        {/* Right Column: Active Fleet & Stops */}
        <div className="lg:col-span-5 space-y-4">
          {/* Active Vehicles List */}
          <div className="bg-white rounded-2xl p-4 border border-neutral-200 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
              Liniyadagi transport vositalari
            </h3>

            {vehicles.length === 0 ? (
              <div className="p-3 bg-neutral-50 rounded-xl text-xs text-neutral-500 text-center">
                {uz.alternatives.noLiveVehicles}
              </div>
            ) : (
              <div className="space-y-2">
                {vehicles.map((v) => (
                  <div
                    key={v.id}
                    className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                      v.isStale
                        ? 'bg-neutral-50 border-neutral-200 text-neutral-400'
                        : 'bg-white border-neutral-200 text-neutral-800 shadow-2xs'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-white text-[11px] ${
                          v.isStale ? 'bg-neutral-400' : 'bg-blue-600'
                        }`}
                      >
                        {routeNumber}
                      </div>
                      <div>
                        <div className="font-bold">{v.licensePlate}</div>
                        <div className="text-[11px] text-neutral-500">
                          Tezlik: {v.speedKmh} km/soat
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      {v.etaMinutesToNextStop !== null && v.etaMinutesToNextStop !== undefined ? (
                        <div className="font-bold text-blue-700">
                          ~{v.etaMinutesToNextStop} daqiqa
                        </div>
                      ) : (
                        <div className="text-[10px] text-neutral-400">
                          {uz.routeDetails.etaCalculating}
                        </div>
                      )}
                      {v.isStale && (
                        <span className="text-[10px] text-amber-600 font-semibold block">
                          Eskirgan ma’lumot
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ordered Stops List */}
          <div className="bg-white rounded-2xl p-4 border border-neutral-200 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
              Marshrut bekatlari ({currentStops.length} ta)
            </h3>
            <div className="space-y-2">
              {currentStops.map((stop, idx) => (
                <div key={stop.id} className="flex items-center gap-2.5 text-xs text-neutral-700">
                  <span className="w-5 h-5 rounded-full bg-neutral-100 text-neutral-600 font-bold flex items-center justify-center text-[10px]">
                    {idx + 1}
                  </span>
                  <span>{stop.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Transport Payment Modal */}
      <PaymentModal
        isOpen={isPayModalOpen}
        onClose={() => setIsPayModalOpen(false)}
        initialVehicle={{
          vehicleId: `v-${routeNumber}-1`,
          licensePlate: `60 A 105 AA`,
          routeNumber: routeNumber,
          uyushmaName: 'Vodiy Trans Servis MCHJ',
          fareSoM: routeData.fareSoM
        }}
      />
    </div>
  )
}
