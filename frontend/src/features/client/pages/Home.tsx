import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppMap from '@/components/map/AppMap'
import PlaceSearchInput from '@/components/client/PlaceSearchInput'
import { getCurrentPosition } from '@/services/geolocation'
import { clientApi } from '@/services/api/clientApi'
import { errorMessage } from '@/services/api/client'
import { addMarker, ANDIJON_CENTER } from '@/services/map/maptiler'
import type { Coordinates, Place, RouteListItem } from '@/types/client'
import { uz } from '@/locales/uz'

const RECENT_KEY = 'mashrutgo_recent_places'

export function buildSearchUrl(origin: { name: string; coordinates: Coordinates }, dest: { name: string; coordinates: Coordinates }) {
  const q = new URLSearchParams({
    from: origin.name,
    fromLng: origin.coordinates[0].toFixed(6),
    fromLat: origin.coordinates[1].toFixed(6),
    to: dest.name,
    toLng: dest.coordinates[0].toFixed(6),
    toLat: dest.coordinates[1].toFixed(6),
  })
  return `/search?${q.toString()}`
}

function loadRecent(): Place[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as Place[]).slice(0, 5) : []
  } catch {
    return []
  }
}

export default function Home() {
  const navigate = useNavigate()
  const [map, setMap] = useState<any | null>(null)

  const [originText, setOriginText] = useState(uz.search.useCurrentLocation)
  const [origin, setOrigin] = useState<Place | null>(null)
  const [destText, setDestText] = useState('')
  const [dest, setDest] = useState<Place | null>(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [gpsDenied, setGpsDenied] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [recent, setRecent] = useState<Place[]>(loadRecent)

  const [routes, setRoutes] = useState<RouteListItem[]>([])
  const [routesError, setRoutesError] = useState<string | null>(null)
  const [routesLoading, setRoutesLoading] = useState(true)
  const [routeQuery, setRouteQuery] = useState('')

  const locate = useCallback(() => {
    setGpsLoading(true)
    getCurrentPosition()
      .then((pos) => {
        const coords: Coordinates = [pos.coords.longitude, pos.coords.latitude]
        setOrigin({ id: 'gps', name: uz.search.useCurrentLocation, address: '', coordinates: coords, kind: 'gps', source: 'gps' })
        setOriginText(uz.search.useCurrentLocation)
        setGpsDenied(false)
      })
      .catch(() => {
        // Location denied/unavailable: the user picks A manually, nothing is invented
        setGpsDenied(true)
        setOrigin(null)
        setOriginText('')
      })
      .finally(() => setGpsLoading(false))
  }, [])

  useEffect(() => {
    locate()
  }, [locate])

  useEffect(() => {
    setRoutesLoading(true)
    const timer = setTimeout(() => {
      clientApi
        .listRoutes(routeQuery.trim() || undefined)
        .then((list) => {
          setRoutes(list)
          setRoutesError(null)
        })
        .catch((err) => setRoutesError(errorMessage(err, 'Marshrutlarni yuklab bo‘lmadi')))
        .finally(() => setRoutesLoading(false))
    }, routeQuery ? 300 : 0)
    return () => clearTimeout(timer)
  }, [routeQuery])

  useEffect(() => {
    if (!map) return
    if (origin) addMarker(map, 'user-loc', origin.coordinates, { type: 'user' })
    if (dest) addMarker(map, 'dest-loc', dest.coordinates, { type: 'alighting', label: 'B' })
    const focus = dest ?? origin
    if (focus) map.easeTo?.({ center: focus.coordinates, zoom: 14, duration: 600 })
  }, [map, origin, dest])

  const rememberPlace = (place: Place) => {
    const updated = [place, ...recent.filter((p) => p.name !== place.name)].slice(0, 5)
    setRecent(updated)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(updated))
    } catch {
      // storage unavailable
    }
  }

  const handleSearchRoutes = (e: React.FormEvent) => {
    e.preventDefault()
    if (!origin) {
      setFormError(gpsDenied ? 'Joylashuv aniqlanmadi: A nuqtani ro‘yxatdan tanlang' : 'A nuqtani tanlang')
      return
    }
    if (!dest) {
      setFormError('B nuqtani takliflar ro‘yxatidan tanlang')
      return
    }
    setFormError(null)
    rememberPlace(dest)
    navigate(buildSearchUrl(origin, dest))
  }

  const handleRouteNumberSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const exact = routes.find((r) => r.routeNumber.toLowerCase() === routeQuery.trim().toLowerCase())
    const target = exact ?? (routes.length === 1 ? routes[0] : null)
    if (target) navigate(`/route/${target.id}`)
  }

  return (
    <div className="space-y-6">
      <section className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-3xl p-5 sm:p-7 text-white shadow-md relative overflow-visible">
        <div className="absolute right-[-20px] bottom-[-20px] text-blue-500/20 text-9xl select-none pointer-events-none">
          <i className="ri-bus-fill"></i>
        </div>

        <div className="relative z-10 max-w-xl">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2">{uz.search.heading}</h1>
          <p className="text-blue-100 text-xs sm:text-sm mb-5">
            Andijon marshrutlari, jonli transport va qulay almashish yo‘llari
          </p>

          <form onSubmit={handleSearchRoutes} className="bg-white rounded-2xl p-4 text-neutral-900 shadow-xl space-y-3">
            <PlaceSearchInput
              label="A — Qayerdan"
              icon="ri-record-circle-line"
              iconClass="text-blue-600"
              placeholder={uz.search.originPlaceholder}
              value={originText}
              onTextChange={(t) => {
                setOriginText(t)
                setOrigin(null)
              }}
              onSelect={(p) => {
                setOrigin(p)
                setOriginText(p.name)
              }}
              near={dest?.coordinates}
              trailing={
                <button
                  type="button"
                  onClick={locate}
                  title="Joriy GPS joylashuvni aniqlash"
                  aria-label="Joriy joylashuv"
                  className="absolute right-2.5 p-1 text-neutral-400 hover:text-blue-600"
                >
                  <i className={`ri-crosshair-2-line text-lg ${gpsLoading ? 'animate-spin' : ''}`}></i>
                </button>
              }
            />
            {gpsDenied && (
              <p className="text-[11px] text-amber-600 -mt-2 flex items-center gap-1">
                <i className="ri-information-line"></i>
                {uz.search.locationDenied}
              </p>
            )}

            <PlaceSearchInput
              label="B — Qayerga"
              icon="ri-map-pin-2-fill"
              iconClass="text-red-500"
              placeholder={uz.search.destPlaceholder}
              value={destText}
              onTextChange={(t) => {
                setDestText(t)
                setDest(null)
              }}
              onSelect={(p) => {
                setDest(p)
                setDestText(p.name)
              }}
              near={origin?.coordinates}
              extraSuggestions={recent}
            />

            {formError && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <i className="ri-error-warning-line"></i>
                {formError}
              </p>
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

      <section className="bg-white rounded-2xl p-4 border border-neutral-200 shadow-xs">
        <form onSubmit={handleRouteNumberSearch} className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-2.5 text-neutral-400">
              <i className="ri-search-line"></i>
            </span>
            <input
              type="text"
              value={routeQuery}
              onChange={(e) => setRouteQuery(e.target.value)}
              placeholder={uz.search.routeNumberPlaceholder}
              aria-label="Marshrut raqami"
              className="w-full pl-9 pr-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button type="submit" className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white font-semibold rounded-xl text-xs sm:text-sm min-h-[40px]">
            Ko‘rish
          </button>
        </form>

        <div className="mt-3 space-y-2">
          {routesLoading && <div className="text-xs text-neutral-400">Marshrutlar yuklanmoqda…</div>}
          {routesError && <div className="text-xs text-red-600">{routesError}</div>}
          {!routesLoading && !routesError && routes.length === 0 && (
            <div className="text-xs text-neutral-500">Hozircha chop etilgan marshrut topilmadi.</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {routes.slice(0, 8).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => navigate(`/route/${r.id}`)}
                className="flex items-center gap-3 p-2.5 rounded-xl border border-neutral-200 hover:border-blue-300 hover:bg-blue-50/40 text-left transition-colors"
              >
                <span className="w-10 h-10 rounded-lg bg-blue-600 text-white font-black flex items-center justify-center text-sm shrink-0">
                  {r.routeNumber}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-neutral-800 truncate">{r.name}</span>
                  <span className="block text-[11px] text-neutral-500 truncate">
                    {r.originName} → {r.destinationName}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-xs">
        <div className="p-3 border-b border-neutral-100 flex items-center justify-between">
          <span className="text-xs font-bold text-neutral-800 flex items-center gap-1.5">
            <i className="ri-map-2-line text-blue-600"></i>
            <span>Andijon shahar xaritasi</span>
          </span>
        </div>
        <div className="h-64 sm:h-80 w-full relative">
          <AppMap center={origin?.coordinates ?? ANDIJON_CENTER} onMapReady={setMap} />
        </div>
      </section>
    </div>
  )
}
