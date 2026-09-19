import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import AppMap, { AppMapHandle } from '@/components/map/AppMap'
import RouteCard from '@/components/ui/RouteCard'
import ItineraryLegs from '@/components/map/ItineraryLegs'
import RouteFilterTabs from '@/components/client/RouteFilterTabs'
import LoadingSkeleton from '@/components/ui/LoadingSkeleton'
import EmptyState from '@/components/ui/EmptyState'
import { getCurrentPosition } from '@/services/geolocation'
import {
  findItineraries,
  ANDIJON_LANDMARKS,
  searchLandmarks
} from '@/services/routing/routingService'
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
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const fromParam = searchParams.get('from') || 'Eski Shahar'
  const toParam = searchParams.get('to') || 'Yangi Bozor'

  const [fromInput, setFromInput] = useState(fromParam)
  const [toInput, setToInput] = useState(toParam)
  const [showToSuggestions, setShowToSuggestions] = useState(false)
  const [toSuggestions, setToSuggestions] = useState(ANDIJON_LANDMARKS.slice(0, 4))
  const [gpsLoading, setGpsLoading] = useState(false)

  const [loading, setLoading] = useState(true)
  const [itineraries, setItineraries] = useState<Itinerary[]>([])
  const [selectedMode, setSelectedMode] = useState<OptimizationMode>('fastest')
  const [selectedItinerary, setSelectedItinerary] = useState<Itinerary | null>(null)
  const [map, setMap] = useState<any | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const mapRef = useRef<AppMapHandle | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list')

  // Keep inputs in sync when URL search params change
  useEffect(() => {
    setFromInput(fromParam)
    setToInput(toParam)
  }, [fromParam, toParam])

  const handleMapReady = useCallback((m: any) => {
    setMap(m)
  }, [])

  // Execute search whenever fromParam or toParam changes
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
        // Select matching mode or fallback to first result
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

  // Execute search by updating URL search params
  const executeSearch = (newFrom: string, newTo: string) => {
    const f = newFrom.trim() || 'Eski Shahar'
    const t = newTo.trim() || 'Yangi Bozor'
    setSearchParams({ from: f, to: t })
    setShowToSuggestions(false)
  }

  const handleSwap = () => {
    const nextFrom = toInput
    const nextTo = fromInput
    setFromInput(nextFrom)
    setToInput(nextTo)
    executeSearch(nextFrom, nextTo)
  }

  const handleFetchGps = () => {
    setGpsLoading(true)
    getCurrentPosition()
      .then((pos) => {
        const txt = uz.search.useCurrentLocation
        setFromInput(txt)
        executeSearch(txt, toInput)
      })
      .catch(() => {
        // graceful fallback
      })
      .finally(() => setGpsLoading(false))
  }

  const handleToInputChange = (val: string) => {
    setToInput(val)
    setToSuggestions(searchLandmarks(val))
    setShowToSuggestions(true)
  }

  const handleSelectLandmark = (name: string) => {
    setToInput(name)
    executeSearch(fromInput, name)
  }

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

  // Auto-resize map when switching to mobile map tab
  useEffect(() => {
    if (mobileView === 'map' && mapRef.current) {
      setTimeout(() => {
        mapRef.current?.resize()
      }, 100)
    }
  }, [mobileView])

  return (
    <div className="space-y-4">
      {/* Interactive A -> B Search Box */}
      <section className="bg-white rounded-2xl p-4 border border-neutral-200 shadow-sm space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            executeSearch(fromInput, toInput)
          }}
          className="space-y-3"
        >
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {/* Origin Input A */}
            <div className="relative flex-1">
              <span className="absolute left-3 top-3 text-blue-600">
                <i className="ri-record-circle-line"></i>
              </span>
              <input
                type="text"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                placeholder="A — Qayerdan?"
                className="w-full pl-9 pr-8 py-2.5 bg-neutral-50 hover:bg-neutral-100/60 focus:bg-white border border-neutral-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleFetchGps}
                title="Joriy joylashuv"
                className="absolute right-2.5 top-2.5 text-neutral-400 hover:text-blue-600 p-0.5"
              >
                <i className={`ri-crosshair-2-line ${gpsLoading ? 'animate-spin' : ''}`}></i>
              </button>
            </div>

            {/* Swap Button */}
            <button
              type="button"
              onClick={handleSwap}
              title="A va B joylarini almashtirish"
              className="self-center p-2 rounded-xl bg-neutral-100 hover:bg-blue-50 hover:text-blue-600 text-neutral-600 transition-colors"
            >
              <i className="ri-arrow-up-down-line sm:ri-arrow-left-right-line text-base font-bold"></i>
            </button>

            {/* Destination Input B */}
            <div className="relative flex-1">
              <span className="absolute left-3 top-3 text-red-500">
                <i className="ri-map-pin-2-fill"></i>
              </span>
              <input
                type="text"
                value={toInput}
                onChange={(e) => handleToInputChange(e.target.value)}
                onFocus={() => setShowToSuggestions(true)}
                placeholder="B — Qayerga?"
                className="w-full pl-9 pr-8 py-2.5 bg-neutral-50 hover:bg-neutral-100/60 focus:bg-white border border-neutral-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {toInput && (
                <button
                  type="button"
                  onClick={() => {
                    setToInput('')
                    setShowToSuggestions(true)
                  }}
                  className="absolute right-2.5 top-2.5 text-neutral-400 hover:text-neutral-600 p-0.5"
                >
                  <i className="ri-close-circle-fill"></i>
                </button>
              )}

              {/* Suggestions Dropdown */}
              {showToSuggestions && toSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-neutral-200 rounded-xl shadow-lg z-30 overflow-hidden divide-y divide-neutral-100 max-h-52 overflow-y-auto">
                  {toSuggestions.map((item) => (
                    <div
                      key={item.name}
                      className="px-3 py-2 hover:bg-blue-50 hover:text-blue-700 cursor-pointer flex items-center justify-between text-xs"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleSelectLandmark(item.name)
                      }}
                    >
                      <div>
                        <div className="font-semibold text-neutral-800">{item.name}</div>
                        <div className="text-[10px] text-neutral-400">{item.description}</div>
                      </div>
                      <i className="ri-arrow-right-s-line text-neutral-400"></i>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Search Submit Button */}
            <button
              type="submit"
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-xl text-xs sm:text-sm transition-colors shadow-xs flex items-center justify-center gap-1.5"
            >
              <i className="ri-search-2-line"></i>
              <span>Qidirish</span>
            </button>
          </div>

          {/* Quick Destination Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 text-xs">
            <span className="text-[11px] text-neutral-400 font-medium whitespace-nowrap">
              Tezkor:
            </span>
            {['Eski Shahar (Registon)', 'Yangi Bozor (Dehqon)', 'Andijon Vokzali', 'Bobur Bog‘i'].map((place) => (
              <button
                key={place}
                type="button"
                onClick={() => {
                  setToInput(place)
                  executeSearch(fromInput, place)
                }}
                className="px-2 py-0.5 rounded-lg bg-neutral-100 hover:bg-blue-50 hover:text-blue-700 text-neutral-600 text-[11px] font-medium whitespace-nowrap transition-colors"
              >
                {place}
              </button>
            ))}
          </div>
        </form>
      </section>

      {/* Active Route Header Summary */}
      <div className="bg-white rounded-2xl p-3.5 border border-neutral-200 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-neutral-800">
          <span className="text-blue-600 font-bold">{fromParam}</span>
          <i className="ri-arrow-right-line text-neutral-400"></i>
          <span className="text-red-600 font-bold">{toParam}</span>
        </div>
        <div className="text-[11px] text-neutral-500 font-medium">
          {loading ? 'Yo‘nalishlar hisoblanmoqda...' : `${filteredItineraries.length} ta variant topildi`}
        </div>
      </div>

      {/* Filter Tabs (Fastest, Cheapest, Least Walking, Least Transfers) */}
      <RouteFilterTabs
        activeMode={selectedMode}
        onSelectMode={(mode) => {
          setSelectedMode(mode)
          const found = itineraries.find((i) => i.mode === mode)
          if (found) setSelectedItinerary(found)
        }}
      />

      {/* Mobile view segmented control [ Ro‘yxat | Xarita ] */}
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

      {/* Responsive Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left column: Itinerary Cards & Step-by-Step Breakdown */}
        <div className={`lg:col-span-6 space-y-3.5 ${mobileView === 'map' ? 'hidden lg:block' : 'block'}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs sm:text-sm font-bold text-neutral-800 flex items-center gap-1.5">
              <i className="ri-route-line text-blue-600"></i>
              <span>{uz.alternatives.title}</span>
            </h2>
            <span className="text-xs font-normal text-neutral-500">
              {filteredItineraries.length} ta natija
            </span>
          </div>

          {loading ? (
            <div className="space-y-3">
              <LoadingSkeleton className="h-24 rounded-xl" />
              <LoadingSkeleton className="h-24 rounded-xl" />
              <LoadingSkeleton className="h-24 rounded-xl" />
            </div>
          ) : filteredItineraries.length === 0 ? (
            <EmptyState
              title={uz.search.noResults}
              description="Boshqa manzilni tanlang yoki filtrni o‘zgartiring"
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
                <h3 className="text-xs sm:text-sm font-bold text-neutral-900 flex items-center gap-1.5">
                  <i className="ri-footprint-line text-blue-600"></i>
                  <span>{uz.routeDetails.title} (Bosqichma-bosqich)</span>
                </h3>
                {selectedItinerary.routeNumbers.length > 0 && (
                  <button
                    onClick={() => navigate(`/route/${selectedItinerary.routeNumbers[0]}`)}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-0.5"
                  >
                    <span>{selectedItinerary.routeNumbers[0]}-marshrut jonli kuzatuvi</span>
                    <i className="ri-arrow-right-line"></i>
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
                <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">
                  {selectedItinerary.totalDurationMinutes} daqiqa (~{selectedItinerary.totalFareSoM.toLocaleString('uz-UZ')} so‘m)
                </span>
              )}
            </div>
            <div className="h-80 sm:h-[460px] w-full relative">
              <AppMap ref={mapRef} onMapReady={handleMapReady} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
