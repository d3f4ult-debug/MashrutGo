import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AppMap from '@/components/map/AppMap'
import RouteCard from '@/components/ui/RouteCard'
import ItineraryLegs from '@/components/map/ItineraryLegs'
import RouteFilterTabs from '@/components/client/RouteFilterTabs'
import LoadingSkeleton from '@/components/ui/LoadingSkeleton'
import EmptyState from '@/components/ui/EmptyState'
import { clientApi } from '@/services/api/clientApi'
import { errorMessage } from '@/services/api/client'
import { addMarker, clearAllMarkers, clearPolyline, drawPolyline, fitBoundsToCoordinates } from '@/services/map/maptiler'
import type { Coordinates, Itinerary, OptimizationMode } from '@/types/client'
import { uz } from '@/locales/uz'

function readPoint(params: URLSearchParams, prefix: 'from' | 'to'): { name: string; coordinates: Coordinates } | null {
  const lat = Number(params.get(`${prefix}Lat`))
  const lng = Number(params.get(`${prefix}Lng`))
  if (!params.get(`${prefix}Lat`) || !params.get(`${prefix}Lng`) || Number.isNaN(lat) || Number.isNaN(lng)) return null
  return { name: params.get(prefix) || (prefix === 'from' ? 'A nuqta' : 'B nuqta'), coordinates: [lng, lat] }
}

// Same comparators the backend applies to `mode` (graph_router._evaluate_multi_criteria). The
// search returns every candidate it found, not a truncated top-N, so switching tabs only re-sorts
// the list already on screen — no refetch, no spinner between tabs.
const SORTERS: Record<OptimizationMode, (a: Itinerary, b: Itinerary) => number> = {
  fastest: (a, b) => a.totalDurationMinutes - b.totalDurationMinutes || a.transferCount - b.transferCount,
  cheapest: (a, b) => a.totalFareSoM - b.totalFareSoM || a.totalDurationMinutes - b.totalDurationMinutes,
  least_walking: (a, b) => a.totalWalkingMeters - b.totalWalkingMeters || a.totalDurationMinutes - b.totalDurationMinutes,
  least_transfers: (a, b) => a.transferCount - b.transferCount || a.totalDurationMinutes - b.totalDurationMinutes,
}

export default function Search() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const origin = useMemo(() => readPoint(params, 'from'), [params])
  const destination = useMemo(() => readPoint(params, 'to'), [params])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [itineraries, setItineraries] = useState<Itinerary[]>([])
  const [mode, setMode] = useState<OptimizationMode>('fastest')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [map, setMap] = useState<any | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list')
  const drawnLegs = useRef(0)

  const runSearch = useCallback(() => {
    if (!origin || !destination) return () => undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    clientApi
      .searchItineraries(origin, destination, 'fastest', controller.signal)
      .then((results) => {
        setItineraries(results)
        setSelectedId(results[0]?.id ?? null)
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setError(errorMessage(err, 'Yo‘nalishlarni hisoblab bo‘lmadi'))
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [origin, destination])

  useEffect(() => runSearch(), [runSearch])

  const sorted = useMemo(() => [...itineraries].sort(SORTERS[mode]), [itineraries, mode])
  const selected = sorted.find((i) => i.id === selectedId) ?? sorted[0] ?? null

  const handleMode = (next: OptimizationMode) => {
    setMode(next)
    const best = [...itineraries].sort(SORTERS[next])[0]
    if (best) setSelectedId(best.id)
  }

  // Draw the selected itinerary
  useEffect(() => {
    if (!map) return
    clearAllMarkers(map)
    for (let i = 0; i < drawnLegs.current; i += 1) clearPolyline(map, `leg-${i}`)
    drawnLegs.current = 0
    if (!selected || !origin || !destination) return

    const allPoints: Coordinates[] = [origin.coordinates, destination.coordinates]
    selected.legs.forEach((leg, idx) => {
      if (leg.geometry && leg.geometry.length > 1) {
        drawPolyline(map, `leg-${idx}`, leg.geometry, {
          color: leg.type === 'walking' ? '#64748b' : '#2563eb',
          dashed: leg.type === 'walking',
          width: leg.type === 'walking' ? 3 : 5,
        })
        allPoints.push(...leg.geometry)
      }
      if (leg.type === 'transit') {
        if (leg.fromStop) addMarker(map, `board-${idx}`, leg.fromStop.coordinates, { type: idx > 1 ? 'transfer' : 'boarding', label: leg.routeNumber })
        if (leg.toStop) addMarker(map, `alight-${idx}`, leg.toStop.coordinates, { type: 'alighting', label: 'B' })
      }
    })
    drawnLegs.current = selected.legs.length
    addMarker(map, 'origin', origin.coordinates, { type: 'user' })
    addMarker(map, 'destination', destination.coordinates, { type: 'alighting', label: 'B' })
    fitBoundsToCoordinates(map, allPoints)
  }, [map, selected, origin, destination])

  if (!origin || !destination) {
    return (
      <EmptyState
        title="A va B nuqtalar tanlanmagan"
        description="Bosh sahifada qayerdan va qayerga borishni ro‘yxatdan tanlang."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 border border-neutral-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-800 min-w-0">
          <span className="text-blue-600 font-bold truncate">{origin.name}</span>
          <i className="ri-arrow-right-line text-neutral-400"></i>
          <span className="text-red-600 font-bold truncate">{destination.name}</span>
        </div>
        <button onClick={() => navigate('/')} className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1">
          <i className="ri-edit-line"></i>
          <span>O‘zgartirish</span>
        </button>
      </div>

      <RouteFilterTabs activeMode={mode} onSelectMode={handleMode} />

      <div className="flex lg:hidden bg-neutral-200/70 p-1 rounded-xl text-xs font-semibold">
        {(['list', 'map'] as const).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => setMobileView(view)}
            className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 ${
              mobileView === view ? 'bg-white text-blue-700 shadow-xs font-bold' : 'text-neutral-600'
            }`}
          >
            <i className={view === 'list' ? 'ri-list-check-2' : 'ri-map-2-line'}></i>
            <span>{view === 'list' ? `Ro‘yxat (${sorted.length})` : 'Xarita'}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className={`lg:col-span-6 space-y-4 ${mobileView === 'map' ? 'hidden lg:block' : 'block'}`}>
          <h2 className="text-sm font-bold text-neutral-800 flex items-center justify-between">
            <span>{uz.alternatives.title}</span>
            <span className="text-xs font-normal text-neutral-500">{sorted.length} ta natija</span>
          </h2>

          {loading ? (
            <div className="space-y-3">
              <LoadingSkeleton className="h-24 rounded-xl" />
              <LoadingSkeleton className="h-24 rounded-xl" />
              <LoadingSkeleton className="h-24 rounded-xl" />
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 space-y-2">
              <div className="flex items-center gap-2">
                <i className="ri-error-warning-line"></i>
                <span>{error}</span>
              </div>
              <button onClick={runSearch} className="text-xs font-semibold underline">
                Qayta urinish
              </button>
            </div>
          ) : sorted.length === 0 ? (
            <EmptyState title={uz.search.noResults} description="Manzillarni tekshiring yoki boshqa nuqta tanlang" />
          ) : (
            <div className="space-y-3" data-testid="itineraries-list">
              {sorted.map((itn) => (
                <RouteCard key={itn.id} itinerary={itn} isSelected={selected?.id === itn.id} onClick={() => setSelectedId(itn.id)} />
              ))}
            </div>
          )}

          {selected && !loading && (
            <div className="pt-2 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-neutral-900">{uz.routeDetails.title} (Bosqichma-bosqich)</h3>
                {selected.routeIds.length > 0 && (
                  <Link to={`/route/${selected.routeIds[0]}`} className="text-xs font-semibold text-blue-600 hover:underline">
                    Jonli kuzatuv →
                  </Link>
                )}
              </div>
              <ItineraryLegs itinerary={selected} showDetailedSteps />
            </div>
          )}
        </div>

        <div className={`lg:col-span-6 lg:sticky lg:top-20 ${mobileView === 'list' ? 'hidden lg:block' : 'block'}`}>
          <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-xs">
            <div className="p-3 border-b border-neutral-100 flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-800 flex items-center gap-1.5">
                <i className="ri-map-pin-range-line text-blue-600"></i>
                <span>Tanlangan yo‘nalish xaritasi</span>
              </span>
              {selected && <span className="text-xs font-bold text-blue-700">{selected.totalDurationMinutes} daqiqa</span>}
            </div>
            <div className="h-80 sm:h-[480px] w-full relative">
              <AppMap center={origin.coordinates} onMapReady={setMap} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
