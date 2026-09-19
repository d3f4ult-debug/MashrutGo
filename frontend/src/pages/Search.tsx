import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import AppMap, { AppMapHandle } from '@/components/map/AppMap'
import RouteCard from '@/components/ui/RouteCard'
import ItineraryLegs from '@/components/map/ItineraryLegs'
import RouteFilterTabs from '@/components/client/RouteFilterTabs'
import LoadingSkeleton from '@/components/ui/LoadingSkeleton'
import EmptyState from '@/components/ui/EmptyState'
import SearchInput from '@/components/ui/SearchInput'
import { geocode } from '@/services/map/geocode'
import { findItineraries } from '@/services/routing/routingService'
import {
  addMarker,
  clearAllMarkers,
  drawPolyline,
  clearPolyline,
  fitBoundsToCoordinates
} from '@/services/map/maptiler'
import { Itinerary, OptimizationMode } from '@/types/client'
import { uz } from '@/locales/uz'

export default function Search() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const fromParam = searchParams.get('from') || 'Eski Shahar'
  const toParam = searchParams.get('to') || 'Yangi Bozor'

  const [loading, setLoading] = useState(true)
  const [itineraries, setItineraries] = useState<Itinerary[]>([])
  const [selectedMode, setSelectedMode] = useState<OptimizationMode>('fastest')
  const [selectedItinerary, setSelectedItinerary] = useState<Itinerary | null>(null)
  const [map, setMap] = useState<any | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const mapRef = useRef<AppMapHandle | null>(null)
  const [query, setQuery] = useState('')
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list')

  const handleMapReady = useCallback((m: any) => {
    setMap(m)
  }, [])

  const handleSearch = useCallback(async (q: string) => {
    if (!q || q.length < 2) return
    try {
      // allow tests to inject a hoist-safe mock via globalThis
      const geocodeFn = (globalThis as any).__testGeocode || (globalThis as any).__mockGeocode || geocode
      const results = await geocodeFn(q)
      if (results && results.length > 0) {
        const first = results[0]
        if (mapRef.current) {
          mapRef.current.centerOn(first.center[0], first.center[1], 14)
        } else {
          // if ref not ready yet (race in tests), try again on next tick
          setTimeout(() => {
            try {
              mapRef.current?.centerOn(first.center[0], first.center[1], 14)
            } catch (e) {
              // ignore
            }
          }, 0)
        }
      }
    } catch (e) {
      // ignore geocode errors
    }
  }, [])

  // Execute search with abort controller
  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    setLoading(true)
    findItineraries(fromParam, toParam, controller.signal)
      .then((results) => {
        setItineraries(results)
        // Default select fastest
        const match = results.find((r) => r.mode === selectedMode) || results[0]
        setSelectedItinerary(match || null)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Search error:', err)
        }
      })
      .finally(() => {
        setLoading(false)
      })

    return () => {
      controller.abort()
    }
  }, [fromParam, toParam])

  // Filter itineraries according to selectedMode
  const filteredItineraries = itineraries.filter((i) => {
    if (selectedMode === 'fastest') return true
    if (selectedMode === 'cheapest') return i.totalFareSoM <= 2000
    if (selectedMode === 'least_walking') return i.totalWalkingMeters < 500
    if (selectedMode === 'least_transfers') return i.transferCount === 0
    return true
  })

  // Render selected itinerary geometry on map
  useEffect(() => {
    if (!map || !selectedItinerary) return

    clearAllMarkers(map)
    // Clear lines
    clearPolyline(map, 'walk-1')
    clearPolyline(map, 'transit-main')
    clearPolyline(map, 'walk-2')

    const allPoints: [number, number][] = []

    selectedItinerary.legs.forEach((leg, idx) => {
      const lineId = `leg-${idx}`
      if (leg.geometry && leg.geometry.length > 0) {
        drawPolyline(map, lineId, leg.geometry, {
          color: leg.type === 'walking' ? '#64748b' : '#2563eb',
          dashed: leg.type === 'walking',
          width: leg.type === 'walking' ? 3 : 5
        })
        leg.geometry.forEach((pt) => allPoints.push(pt))
      }

      // Add stop markers
      if (leg.fromStop) {
        addMarker(map, `stop-${leg.fromStop.id}`, leg.fromStop.coordinates, {
          type: 'boarding',
          label: leg.routeNumber || 'A'
        })
        allPoints.push(leg.fromStop.coordinates)
      }
      if (leg.toStop) {
        addMarker(map, `stop-${leg.toStop.id}`, leg.toStop.coordinates, {
          type: 'alighting',
          label: 'B'
        })
        allPoints.push(leg.toStop.coordinates)
      }
    })

    if (allPoints.length > 0) {
      fitBoundsToCoordinates(map, allPoints)
    }
  }, [map, selectedItinerary])

  return (
    <div className="space-y-4">
      {/* Route Header summary */}
      <div className="bg-white rounded-2xl p-4 border border-neutral-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <span className="text-blue-600 font-bold">{fromParam}</span>
          <i className="ri-arrow-right-line text-neutral-400"></i>
          <span className="text-red-600 font-bold">{toParam}</span>
        </div>
        <button
          onClick={() => navigate('/')}
          className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          <i className="ri-edit-line"></i>
          <span>O‘zgartirish</span>
        </button>
      </div>

      {/* Filter Tabs */}
            <div className="mb-3 flex gap-2">
              <SearchInput
                placeholder="Qayerga bormoqchisiz?"
                value={query}
                onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch(query)
                }}
              />
              <button
                type="button"
                className="px-3 py-2 bg-blue-600 text-white rounded-lg"
                onClick={() => handleSearch(query)}
              >
                Qidirish
              </button>
            </div>

            <RouteFilterTabs
        activeMode={selectedMode}
        onSelectMode={(mode) => {
          setSelectedMode(mode)
          const found = itineraries.find((i) => i.mode === mode)
          if (found) setSelectedItinerary(found)
        }}
      />

      {/* Mobile view segmented control */}
      <div className="flex lg:hidden bg-neutral-200/70 p-1 rounded-xl text-xs font-semibold">
        <button
          type="button"
          onClick={() => setMobileView('list')}
          className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            mobileView === 'list'
              ? 'bg-white text-blue-700 shadow-xs font-bold'
              : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          <i className="ri-list-check-2"></i>
          <span>Ro‘yxat ({filteredItineraries.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileView('map')}
          className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            mobileView === 'map'
              ? 'bg-white text-blue-700 shadow-xs font-bold'
              : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          <i className="ri-map-2-line"></i>
          <span>Xarita</span>
        </button>
      </div>

      {/* Desktop Responsive Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left column: Itinerary Cards & Detailed Steps */}
        <div className={`lg:col-span-6 space-y-4 ${mobileView === 'map' ? 'hidden lg:block' : 'block'}`}>
          <h2 className="text-sm font-bold text-neutral-800 flex items-center justify-between">
            <span>{uz.alternatives.title}</span>
            <span className="text-xs font-normal text-neutral-500">
              {filteredItineraries.length} ta natija
            </span>
          </h2>

          {loading ? (
            <div className="space-y-3">
              <LoadingSkeleton className="h-24 rounded-xl" />
              <LoadingSkeleton className="h-24 rounded-xl" />
              <LoadingSkeleton className="h-24 rounded-xl" />
            </div>
          ) : filteredItineraries.length === 0 ? (
            <EmptyState
              title={uz.search.noResults}
              description="Boshqa filtrni tanlang yoki manzillarni tekshiring"
            />
          ) : (
            <div className="space-y-3" data-testid="itineraries-list">
              {filteredItineraries.map((itn) => (
                <RouteCard
                  key={itn.id}
                  itinerary={itn}
                  isSelected={selectedItinerary?.id === itn.id}
                  onClick={() => setSelectedItinerary(itn)}
                />
              ))}
            </div>
          )}

          {/* Selected Itinerary Step-by-Step Breakdown */}
          {selectedItinerary && (
            <div className="pt-2 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-neutral-900">
                  {uz.routeDetails.title} (Bosqichma-bosqich)
                </h3>
                {selectedItinerary.routeNumbers.length > 0 && (
                  <button
                    onClick={() => navigate(`/route/${selectedItinerary.routeNumbers[0]}`)}
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Jonli kuzatuv sahifasi →
                  </button>
                )}
              </div>
              <ItineraryLegs itinerary={selectedItinerary} showDetailedSteps={true} />
            </div>
          )}
        </div>

        {/* Right column: Interactive Map View */}
        <div className={`lg:col-span-6 sticky top-20 ${mobileView === 'list' ? 'hidden lg:block' : 'block'}`}>
          <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-xs">
            <div className="p-3 border-b border-neutral-100 flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-800 flex items-center gap-1.5">
                <i className="ri-map-pin-range-line text-blue-600"></i>
                <span>Tanlangan yo‘nalish xaritasi</span>
              </span>
              {selectedItinerary && (
                <span className="text-xs font-bold text-blue-700">
                  {selectedItinerary.totalDurationMinutes} daqiqa
                </span>
              )}
            </div>
            <div className="h-80 sm:h-[480px] w-full relative">
              <AppMap ref={mapRef} onMapReady={handleMapReady} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
