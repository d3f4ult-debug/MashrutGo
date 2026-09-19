import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import AppMap from '@/components/map/AppMap'
import RouteCard from '@/components/ui/RouteCard'
import { getCurrentPosition } from '@/services/geolocation'
import { useAuth } from '@/services/auth/AuthProvider'
import {
  searchLandmarks,
  ANDIJON_LANDMARKS,
  ANDIJON_ROUTES
} from '@/services/routing/routingService'
import { addMarker } from '@/services/map/maptiler'
import { uz } from '@/locales/uz'

const RECENT_SEARCHES_KEY = 'mashrutgo_recent_searches'
const FAVORITES_KEY = 'mashrutgo_favorite_places'

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [map, setMap] = useState<any | null>(null)
  const [originText, setOriginText] = useState(uz.search.useCurrentLocation)
  const [originCoords, setOriginCoords] = useState<[number, number] | null>(null)
  const [destText, setDestText] = useState('')
  const [destCoords, setDestCoords] = useState<[number, number] | null>(null)
  const [routeNumberQuery, setRouteNumberQuery] = useState('')
  const [gpsLoading, setGpsLoading] = useState(false)
  const [gpsDenied, setGpsDenied] = useState(false)
  const [destSuggestions, setDestSuggestions] = useState(ANDIJON_LANDMARKS.slice(0, 4))
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [favorites, setFavorites] = useState<string[]>([])

  // Load recent searches and favorites from localStorage
  useEffect(() => {
    try {
      const savedRecents = localStorage.getItem(RECENT_SEARCHES_KEY)
      if (savedRecents) {
        setRecentSearches(JSON.parse(savedRecents))
      }
      if (user) {
        const savedFavs = localStorage.getItem(FAVORITES_KEY)
        if (savedFavs) {
          setFavorites(JSON.parse(savedFavs))
        }
      }
    } catch (e) {}
  }, [user])

  // Attempt initial GPS acquisition
  useEffect(() => {
    let active = true
    setGpsLoading(true)
    getCurrentPosition()
      .then((pos) => {
        if (!active) return
        setOriginCoords([pos.coords.longitude, pos.coords.latitude])
        setOriginText(uz.search.useCurrentLocation)
        setGpsDenied(false)
      })
      .catch(() => {
        if (!active) return
        // Location denied or unavailable — fallback smoothly without crashing
        setGpsDenied(true)
        setOriginText('Eski Shahar (Registon)')
        setOriginCoords([72.342, 40.782])
      })
      .finally(() => {
        if (active) setGpsLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const handleMapReady = useCallback((m: any) => {
    setMap(m)
    // Add default user marker in Andijon center or current GPS
    addMarker(m, 'user-loc', [72.342, 40.782], { type: 'user' })
  }, [])

  const handleFetchGps = () => {
    setGpsLoading(true)
    getCurrentPosition()
      .then((pos) => {
        const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude]
        setOriginCoords(coords)
        setOriginText(uz.search.useCurrentLocation)
        setGpsDenied(false)
        if (map) {
          addMarker(map, 'user-loc', coords, { type: 'user' })
        }
      })
      .catch(() => {
        setGpsDenied(true)
      })
      .finally(() => setGpsLoading(false))
  }

  const handleDestChange = (text: string) => {
    setDestText(text)
    setDestSuggestions(searchLandmarks(text))
    setShowSuggestions(true)
  }

  const handleSelectLandmark = (item: (typeof ANDIJON_LANDMARKS)[0]) => {
    setDestText(item.name)
    setDestCoords(item.coordinates)
    setShowSuggestions(false)
    if (map) {
      addMarker(map, 'dest-loc', item.coordinates, { type: 'alighting', label: 'B' })
    }
  }

  const saveRecentSearch = (text: string) => {
    if (!text) return
    const updated = [text, ...recentSearches.filter((s) => s !== text)].slice(0, 5)
    setRecentSearches(updated)
    try {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
    } catch (e) {}
  }

  const handleToggleFavorite = (name: string) => {
    if (!user) return
    const updated = favorites.includes(name)
      ? favorites.filter((f) => f !== name)
      : [...favorites, name]
    setFavorites(updated)
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(updated))
    } catch (e) {}
  }

  const handleSearchRoutes = (e: React.FormEvent) => {
    e.preventDefault()
    if (destText) {
      saveRecentSearch(destText)
    }
    const queryParams = new URLSearchParams()
    if (originText) queryParams.set('from', originText)
    if (destText) queryParams.set('to', destText)
    navigate(`/search?${queryParams.toString()}`)
  }

  const handleRouteNumberSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const clean = routeNumberQuery.trim().replace(/[^0-9]/g, '')
    if (clean) {
      navigate(`/route/${clean}`)
    }
  }

  return (
    <div className="space-y-6">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-3xl p-5 sm:p-7 text-white shadow-md relative overflow-hidden">
        <div className="absolute right-[-20px] bottom-[-20px] text-blue-500/20 text-9xl select-none pointer-events-none">
          <i className="ri-bus-fill"></i>
        </div>

        <div className="relative z-10 max-w-xl">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2">
            {uz.search.heading}
          </h1>
          <p className="text-blue-100 text-xs sm:text-sm mb-5">
            Andijon shahar marshrutlari, real vaqtdagi mashinalar va qulay almashish yo‘llari
          </p>

          {/* Main A -> B Search Card */}
          <form
            onSubmit={handleSearchRoutes}
            className="bg-white rounded-2xl p-4 text-neutral-900 shadow-xl space-y-3"
          >
            {/* Origin A */}
            <div className="relative">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-1">
                A — Qayerdan
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-blue-600 text-base">
                  <i className="ri-record-circle-line"></i>
                </span>
                <input
                  type="text"
                  value={originText}
                  onChange={(e) => setOriginText(e.target.value)}
                  placeholder={uz.search.originPlaceholder}
                  className="w-full pl-9 pr-10 py-2.5 bg-neutral-50 hover:bg-neutral-100/70 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={handleFetchGps}
                  title="Joriy GPS joylashuvni aniqlash"
                  className="absolute right-2.5 p-1 text-neutral-400 hover:text-blue-600"
                >
                  <i className={`ri-crosshair-2-line text-lg ${gpsLoading ? 'animate-spin' : ''}`}></i>
                </button>
              </div>
              {gpsDenied && (
                <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1">
                  <i className="ri-information-line"></i>
                  {uz.search.locationDenied}
                </p>
              )}
            </div>

            {/* Destination B */}
            <div className="relative">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-1">
                B — Qayerga
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-red-500 text-base">
                  <i className="ri-map-pin-2-fill"></i>
                </span>
                <input
                  type="text"
                  value={destText}
                  onChange={(e) => handleDestChange(e.target.value)}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder={uz.search.destPlaceholder}
                  className="w-full pl-9 pr-8 py-2.5 bg-neutral-50 hover:bg-neutral-100/70 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                />
                {destText && (
                  <button
                    type="button"
                    onClick={() => {
                      setDestText('')
                      setDestCoords(null)
                    }}
                    className="absolute right-2.5 text-neutral-400 hover:text-neutral-600 text-sm"
                  >
                    <i className="ri-close-circle-fill"></i>
                  </button>
                )}
              </div>

              {/* Suggestions Dropdown */}
              {showSuggestions && destSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-neutral-200 rounded-xl shadow-lg z-20 overflow-hidden divide-y divide-neutral-100 max-h-56 overflow-y-auto">
                  {destSuggestions.map((item) => (
                    <div
                      key={item.name}
                      className="px-3 py-2.5 hover:bg-neutral-50 flex items-center justify-between cursor-pointer"
                      onClick={() => handleSelectLandmark(item)}
                    >
                      <div>
                        <div className="font-semibold text-neutral-800 text-xs">{item.name}</div>
                        <div className="text-neutral-400 text-[10px]">{item.description}</div>
                      </div>
                      {user && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleFavorite(item.name)
                          }}
                          className="p-1 text-neutral-300 hover:text-amber-500"
                        >
                          <i
                            className={
                              favorites.includes(item.name)
                                ? 'ri-star-fill text-amber-500 text-sm'
                                : 'ri-star-line text-sm'
                            }
                          ></i>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Searches (if available) */}
            {recentSearches.length > 0 && (
              <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-neutral-400 font-medium">So‘nggi:</span>
                {recentSearches.map((rec) => (
                  <button
                    key={rec}
                    type="button"
                    onClick={() => {
                      setDestText(rec)
                      setShowSuggestions(false)
                    }}
                    className="px-2 py-0.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md text-[10px] truncate max-w-[140px]"
                  >
                    {rec}
                  </button>
                ))}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-md min-h-[44px]"
            >
              <i className="ri-search-eye-line text-base"></i>
              <span>{uz.search.findRoute}</span>
            </button>
          </form>
        </div>
      </section>

      {/* Secondary Route Number Search Bar */}
      <section className="bg-white rounded-2xl p-4 border border-neutral-200 shadow-xs">
        <form onSubmit={handleRouteNumberSearch} className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-2.5 text-neutral-400">
              <i className="ri-search-line"></i>
            </span>
            <input
              type="text"
              value={routeNumberQuery}
              onChange={(e) => setRouteNumberQuery(e.target.value)}
              placeholder={uz.search.routeNumberPlaceholder}
              className="w-full pl-9 pr-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white font-semibold rounded-xl text-xs sm:text-sm transition-colors min-h-[40px]"
          >
            Ko‘rish
          </button>
        </form>

        {/* Quick route chips */}
        <div className="flex items-center gap-2 mt-3 overflow-x-auto no-scrollbar text-xs">
          <span className="text-neutral-400 text-[11px] font-medium whitespace-nowrap">
            Ommabop marshrutlar:
          </span>
          {['15', '22', '7', '33'].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => navigate(`/route/${num}`)}
              className="px-2.5 py-1 bg-neutral-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 border border-transparent rounded-lg font-bold text-neutral-700 transition-colors"
            >
              {num}-marshrut
            </button>
          ))}
        </div>
      </section>

      {/* Interactive Map Preview */}
      <section className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-xs">
        <div className="p-3 border-b border-neutral-100 flex items-center justify-between">
          <span className="text-xs font-bold text-neutral-800 flex items-center gap-1.5">
            <i className="ri-map-2-line text-blue-600"></i>
            <span>Andijon shahar xaritasi</span>
          </span>
          <span className="text-[11px] text-neutral-500">MapTiler Streets</span>
        </div>
        <div className="h-64 sm:h-80 w-full relative">
          <AppMap onMapReady={handleMapReady} />
        </div>
      </section>

      {/* Featured Route Alternatives Preview */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-neutral-900">
            Tavsiya etilgan marshrutlar
          </h2>
          <button
            onClick={() => navigate('/search')}
            className="text-xs font-semibold text-blue-600 hover:underline"
          >
            Barchasini ko‘rish →
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <RouteCard
            title="Eski Shahar — Yangi Bozor"
            eta="19 daqiqa"
            price="2 000 so‘m"
            walking="380 m"
            transfers={0}
            routeNumbers="15"
            onClick={() => navigate('/route/15')}
          />
          <RouteCard
            title="Vokzal — Bobur Bog‘i"
            eta="22 daqiqa"
            price="2 000 so‘m"
            walking="420 m"
            transfers={0}
            routeNumbers="22"
            onClick={() => navigate('/route/22')}
          />
        </div>
      </section>
    </div>
  )
}
