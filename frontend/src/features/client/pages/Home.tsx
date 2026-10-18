import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import AppMap from '@/components/map/AppMap'
import RouteCard from '@/components/ui/RouteCard'
import { getCurrentPosition, snapToNearestRoad } from '@/services/geolocation'

import { useAuth } from '@/services/auth/AuthProvider'
import {
  searchLandmarks,
  ANDIJON_LANDMARKS,
  ANDIJON_ROUTES
} from '@/services/routing/routingService'
import { addMarker, drawPolyline } from '@/services/map/maptiler'
import { uz } from '@/locales/uz'
import { WelcomeRoleModal } from '@/components/auth/WelcomeRoleModal'
import { uyushmaApi } from '@/services/api/uyushmaApi'

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
  const [roleModalOpen, setRoleModalOpen] = useState(false)
  const [targetRole, setTargetRole] = useState<'client' | 'driver' | 'uyushma' | 'admin'>('client')

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

    // Load and draw real routes created by Uyushma
    uyushmaApi.getRoutes('uyushma-01').then(routes => {
      const colors = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#06b6d4', '#e11d48'];
      routes.forEach((r, idx) => {
        const localDraft = localStorage.getItem(`route_published_${r.id}`) || localStorage.getItem(`route_draft_${r.id}`);
        let coords: [number, number][] = [];
        if (localDraft) {
          try {
            const parsed = JSON.parse(localDraft);
            coords = parsed.outbound?.geometry?.coordinates || [];
          } catch {
            // ignore
          }
        }
        if (coords.length > 1) {
          drawPolyline(m, `real-route-${r.id}`, { type: 'LineString', coordinates: coords }, {
            color: colors[idx % colors.length],
            width: 5,
          });
        }
      });
    }).catch(() => {
      // Clean fallback without mock routes
    });
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
          map.flyTo({
            center: coords,
            zoom: 15,
            pitch: 35,
            bearing: 0,
            duration: 1200,
            essential: true
          })
        }
      })
      .catch(() => {
        setOriginText(uz.search.useCurrentLocation)
        const coords: [number, number] = [72.3465, 40.7819]
        setOriginCoords(coords)
        setGpsDenied(false)
        if (map) {
          addMarker(map, 'user-loc', coords, { type: 'user' })
          map.flyTo({
            center: coords,
            zoom: 15,
            pitch: 35,
            bearing: 0,
            duration: 1200,
            essential: true
          })
        }
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
      {/* Real-App Welcome Banner for new / unauthenticated visitors */}
      {!user && (
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white rounded-3xl p-5 shadow-lg border border-slate-700/50 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-2xl text-blue-400 shrink-0">
              <i className="ri-user-star-line" />
            </div>
            <div>
              <h2 className="font-bold text-base sm:text-lg">MashrutGo ga xush kelibsiz!</h2>
              <p className="text-xs text-slate-300">
                Siz haydovchimisiz yoki yo‘lovchi? Tizim imkoniyatlaridan to‘liq foydalanish uchun rolingizni tanlang.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 w-full md:w-auto">
            <button
              onClick={() => {
                setTargetRole('client')
                setRoleModalOpen(true)
              }}
              className="flex-1 md:flex-initial px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors shadow-sm inline-flex items-center justify-center gap-1.5"
            >
              <i className="ri-user-line" />
              Yo‘lovchi
            </button>
            <button
              onClick={() => {
                setTargetRole('driver')
                setRoleModalOpen(true)
              }}
              className="flex-1 md:flex-initial px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors shadow-sm inline-flex items-center justify-center gap-1.5"
            >
              <i className="ri-steering-2-line" />
              Haydovchi
            </button>
            <button
              onClick={() => {
                setTargetRole('admin')
                setRoleModalOpen(true)
              }}
              className="px-2.5 py-2 bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white text-xs rounded-xl transition-colors"
              title="Uyushma / Admin"
            >
              <i className="ri-more-fill" />
            </button>
          </div>
        </div>
      )}

      {/* Role Selection Modal */}
      <WelcomeRoleModal
        isOpen={roleModalOpen}
        onClose={() => setRoleModalOpen(false)}
        defaultRole={targetRole}
      />

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

        {/* Quick Passenger Action Tiles: Instant Fare Pay & Nearest Stops */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <button
            type="button"
            onClick={() => navigate('/pay')}
            className="flex items-center gap-3 p-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-2xl shadow-sm transition-transform active:scale-98 text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <i className="ri-qr-scan-2-line text-2xl"></i>
            </div>
            <div>
              <div className="text-xs font-bold leading-tight">Yo‘l haqi to‘lash</div>
              <div className="text-[10px] text-emerald-100">QR / NFC / 2 000 so‘m</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/wallet')}
            className="flex items-center gap-3 p-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl shadow-sm transition-transform active:scale-98 text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <i className="ri-wallet-3-line text-2xl"></i>
            </div>
            <div>
              <div className="text-xs font-bold leading-tight">Yo‘lovchi hamyoni</div>
              <div className="text-[10px] text-blue-100">Click & Payme to‘ldirish</div>
            </div>
          </button>
        </div>
      </section>


      {/* Interactive Map Preview — High Definition City View */}
      <section className="bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-sm">
        <div className="p-3.5 sm:p-4 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/70">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <i className="ri-map-2-line text-sm"></i>
            </div>
            <div>
              <span className="text-xs sm:text-sm font-bold text-neutral-800 block leading-tight">
                Andijon shahar xaritasi
              </span>
              <span className="text-[10px] text-neutral-500">
                VirCity & OpenFreeMap — Jonli navigatsiya
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleFetchGps}
              title="Joriy joylashuvga qaytish"
              className="px-2.5 py-1.5 bg-white hover:bg-neutral-100 border border-neutral-200 rounded-lg text-xs font-semibold text-neutral-700 flex items-center gap-1 shadow-2xs transition-colors"
            >
              <i className="ri-crosshair-2-line text-blue-600"></i>
              <span className="hidden sm:inline">Mening joyim</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (map) {
                  map.flyTo({ center: [72.348, 40.785], zoom: 14.2, pitch: 25, bearing: 0, duration: 1000 })
                }
              }}
              title="Shahar markazidagi barcha marshrutlarni ko‘rsatish"
              className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 rounded-lg text-xs font-semibold flex items-center gap-1 shadow-2xs transition-colors"
            >
              <i className="ri-bus-line text-blue-600"></i>
              <span>Marshrutlar</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (map) {
                  map.flyTo({ center: [72.342, 40.782], zoom: 13.5, pitch: 20, bearing: 0, duration: 1000 })
                }
              }}
              title="Shahar umumiy ko‘rinishiga qaytish"
              className="px-2.5 py-1.5 bg-white hover:bg-neutral-100 border border-neutral-200 rounded-lg text-xs font-semibold text-neutral-700 flex items-center gap-1 shadow-2xs transition-colors"
            >
              <i className="ri-fullscreen-line text-neutral-600"></i>
              <span className="hidden sm:inline">Markaz</span>
            </button>
          </div>
        </div>
        <div className="h-96 sm:h-[480px] lg:h-[540px] w-full relative">
          <AppMap onMapReady={handleMapReady} />
        </div>
      </section>
    </div>
  )
}
