import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useAuth } from '../../contexts/AuthContext'
import { useUyushmaScope } from '../../contexts/UyushmaScopeContext'
import { usePortalBase } from '../../hooks/usePortalBase'
import { filterFleet, scopeKey, summarizeFleet, useLiveFleet } from '../../hooks/useLiveFleet'
import { ANDIJON_CENTER, attachStyleFallback, getMapStyle } from '../../services/map/maptiler'
import { timeAgo } from '../../utils/format'
import type { ConnectionState } from '../../services/realtime/websocket'
import type { FleetParking, FleetScope, FleetStatus, LiveFleetVehicle } from '../../types/realtimeFleet'
import { VehicleDetailDrawer } from './VehicleDetailDrawer'
import { FLEET_STATUS_ICONS, FLEET_STATUS_LABELS, FLEET_STATUS_ORDER, circleRing, lastSeenText, vehicleTitle } from './fleetUi'
import './OperationsLiveMap.css'

const DEFAULT_ZOOM = 12.5
const FOCUS_ZOOM = 15.5
const PARKING_SOURCE = 'fleet-parkings'
const PARKING_FILL_LAYER = 'fleet-parkings-fill'
const PARKING_LINE_LAYER = 'fleet-parkings-line'

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connected: 'Jonli',
  connecting: 'Ulanmoqda…',
  reconnecting: 'Qayta ulanmoqda…',
  disconnected: 'Jonli aloqa yo‘q',
}

type MarkerEntry = { marker: maplibregl.Marker; el: HTMLDivElement }

// ---------------------------------------------------------------- marker DOM (textContent only: no HTML injection)

function createVehicleMarkerEl(onSelect: () => void): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'fleet-marker'
  el.tabIndex = 0
  el.setAttribute('role', 'button')
  const bubble = document.createElement('div')
  bubble.className = 'fleet-marker__bubble'
  const route = document.createElement('span')
  route.className = 'fleet-marker__route'
  const plate = document.createElement('span')
  plate.className = 'fleet-marker__plate'
  const arrow = document.createElement('span')
  arrow.className = 'fleet-marker__arrow'
  const icon = document.createElement('i')
  icon.className = 'ri-navigation-fill'
  arrow.appendChild(icon)
  bubble.append(route, plate, arrow)
  el.appendChild(bubble)
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    onSelect()
  })
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  })
  return el
}

function updateVehicleMarkerEl(el: HTMLDivElement, v: LiveFleetVehicle, selected: boolean, now: number) {
  el.className = `fleet-marker fleet-marker--${v.status}${selected ? ' is-selected' : ''}`
  const label = `${vehicleTitle(v)} · № ${v.route_number} · ${FLEET_STATUS_LABELS[v.status]} · ${lastSeenText(v, now)}`
  el.title = label
  el.setAttribute('aria-label', label)
  const [route, plate, arrow] = Array.from(el.firstElementChild?.children ?? []) as HTMLElement[]
  if (route) route.textContent = `№ ${v.route_number}`
  if (plate) plate.textContent = vehicleTitle(v)
  // ri-navigation-fill points north-east (45°); heading 0° = north.
  if (arrow) {
    arrow.style.transform = `rotate(${Math.round(v.heading) - 45}deg)`
    arrow.style.visibility = v.status === 'on_route' ? 'visible' : 'hidden'
  }
}

function createParkingMarkerEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'fleet-parking'
  const icon = document.createElement('i')
  icon.className = 'ri-parking-box-fill'
  const name = document.createElement('span')
  name.className = 'fleet-parking__name'
  const count = document.createElement('span')
  count.className = 'fleet-parking__count'
  el.append(icon, name, count)
  return el
}

function updateParkingMarkerEl(el: HTMLDivElement, p: FleetParking) {
  const [, name, count] = Array.from(el.children) as HTMLElement[]
  name.textContent = p.name
  count.textContent = p.capacity ? `${p.vehicle_count}/${p.capacity}` : `${p.vehicle_count}`
  el.classList.toggle('is-occupied', p.vehicle_count > 0)
  el.title = `${p.name}: ${p.vehicle_count} ta transport${p.capacity ? ` (sig‘im ${p.capacity})` : ''}`
}

function parkingsGeoJson(parkings: FleetParking[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: parkings.map((p) => ({
      type: 'Feature',
      properties: { id: p.id, occupied: p.vehicle_count > 0 },
      geometry: { type: 'Polygon', coordinates: [circleRing(p.lat, p.lng, p.radius_m)] },
    })),
  }
}

// ---------------------------------------------------------------- page

export function OperationsLiveMap() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const portalBase = usePortalBase()
  const { uyushmaId, options: tenantOptions, setUyushmaId, loading: scopeLoading } = useUyushmaScope()

  // Super Admin: whole city by default, or the tenant chosen in the header selector.
  const [adminMode, setAdminMode] = useState<'all' | 'tenant'>('all')
  const scope: FleetScope | null = useMemo(() => {
    if (isAdmin) return adminMode === 'tenant' && uyushmaId ? { kind: 'tenant', uyushmaId } : { kind: 'all' }
    return uyushmaId ? { kind: 'tenant', uyushmaId } : null
  }, [isAdmin, adminMode, uyushmaId])
  const currentScopeKey = scopeKey(scope)
  const hasScope = scope !== null

  const { vehicles, parkings, routeOptions, routeDetails, connectionState, loading, syncing, error, parkingsError, lastSyncedAt, now, refresh } =
    useLiveFleet(scope)

  const [routeId, setRouteId] = useState<string | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<FleetStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 768)

  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const vehicleMarkers = useRef<Map<string, MarkerEntry>>(new Map())
  const parkingMarkers = useRef<Map<string, MarkerEntry>>(new Map())
  const selectRef = useRef<(id: string) => void>(() => undefined)
  const didFitRef = useRef(false)
  const parkingDataRef = useRef<GeoJSON.FeatureCollection>(parkingsGeoJson([]))

  // Scope switch: every filter and the selection belong to the previous tenant. A leftover search
  // term (a plate from the other uyushma) would silently show an empty fleet.
  useEffect(() => {
    setRouteId('all')
    setStatusFilter('all')
    setSearch('')
    setSelectedId(null)
    didFitRef.current = false
  }, [currentScopeKey])

  const counts = useMemo(() => summarizeFleet(vehicles), [vehicles])
  const filtered = useMemo(() => filterFleet(vehicles, { routeId, status: statusFilter, search }), [vehicles, routeId, statusFilter, search])
  const onMap = useMemo(() => filtered.filter((v) => v.status !== 'awaiting_gps' && v.lat !== null && v.lng !== null), [filtered])
  const selected = useMemo(() => vehicles.find((v) => v.vehicle_id === selectedId) ?? null, [vehicles, selectedId])

  // Selected vehicle left the fleet (shift ended) => close the drawer.
  useEffect(() => {
    if (selectedId && !loading && !vehicles.some((v) => v.vehicle_id === selectedId)) setSelectedId(null)
  }, [selectedId, vehicles, loading])

  const focusOn = useCallback((lat: number, lng: number) => {
    const map = mapRef.current
    if (!map) return
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), FOCUS_ZOOM), speed: 1.4, curve: 1.2 })
  }, [])

  const selectVehicle = useCallback(
    (id: string, fly = false) => {
      setSelectedId(id)
      const v = vehicles.find((x) => x.vehicle_id === id)
      if (fly && v && v.lat !== null && v.lng !== null) focusOn(v.lat, v.lng)
    },
    [vehicles, focusOn],
  )
  selectRef.current = (id: string) => selectVehicle(id)

  const closeDrawer = useCallback(() => setSelectedId(null), [])

  // ── Map lifecycle (the container only exists once a scope is known) ──
  useEffect(() => {
    const container = mapContainer.current
    if (!hasScope || !container) return
    let map: maplibregl.Map
    try {
      map = new maplibregl.Map({ container, style: getMapStyle('dark'), center: ANDIJON_CENTER, zoom: DEFAULT_ZOOM })
    } catch {
      setMapError('Xaritani ishga tushirib bo‘lmadi (brauzer WebGL’ni qo‘llab-quvvatlamaydi). Ro‘yxat ishlashda davom etadi.')
      return
    }
    attachStyleFallback(map, 'dark')
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')

    const ensureParkingLayers = () => {
      try {
        if (!map.getSource(PARKING_SOURCE)) map.addSource(PARKING_SOURCE, { type: 'geojson', data: parkingDataRef.current })
        if (!map.getLayer(PARKING_FILL_LAYER)) {
          map.addLayer({
            id: PARKING_FILL_LAYER,
            type: 'fill',
            source: PARKING_SOURCE,
            paint: { 'fill-color': ['case', ['get', 'occupied'], '#3b82f6', '#64748b'], 'fill-opacity': 0.14 },
          })
        }
        if (!map.getLayer(PARKING_LINE_LAYER)) {
          map.addLayer({
            id: PARKING_LINE_LAYER,
            type: 'line',
            source: PARKING_SOURCE,
            paint: { 'line-color': '#60a5fa', 'line-width': 1.5, 'line-dasharray': [2, 2] },
          })
        }
      } catch {
        // style not ready yet: retried on the next `styledata`
      }
    }

    const onLoad = () => {
      ensureParkingLayers()
      setMapReady(true)
    }
    map.on('load', onLoad)
    // A style switch (MapTiler key rejected -> OpenStreetMap tiles) drops custom layers.
    map.on('styledata', ensureParkingLayers)
    mapRef.current = map

    const markers = vehicleMarkers.current
    const parkingMarkerMap = parkingMarkers.current
    return () => {
      markers.forEach(({ marker }) => marker.remove())
      markers.clear()
      parkingMarkerMap.forEach(({ marker }) => marker.remove())
      parkingMarkerMap.clear()
      map.off('load', onLoad)
      map.off('styledata', ensureParkingLayers)
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [hasScope])

  // ── Vehicle markers ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const markers = vehicleMarkers.current
    const keep = new Set<string>()
    onMap.forEach((v) => {
      keep.add(v.vehicle_id)
      let entry = markers.get(v.vehicle_id)
      if (!entry) {
        const id = v.vehicle_id
        const el = createVehicleMarkerEl(() => selectRef.current(id))
        entry = { el, marker: new maplibregl.Marker({ element: el }).setLngLat([v.lng!, v.lat!]).addTo(map) }
        markers.set(id, entry)
      } else {
        entry.marker.setLngLat([v.lng!, v.lat!])
      }
      updateVehicleMarkerEl(entry.el, v, v.vehicle_id === selectedId, now)
    })
    markers.forEach((entry, id) => {
      if (!keep.has(id)) {
        entry.marker.remove()
        markers.delete(id)
      }
    })
  }, [onMap, selectedId, mapReady, now])

  // ── Parking markers + geofence circles ──
  useEffect(() => {
    parkingDataRef.current = parkingsGeoJson(parkings)
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(PARKING_SOURCE) as maplibregl.GeoJSONSource | undefined
    source?.setData(parkingDataRef.current)

    const markers = parkingMarkers.current
    const keep = new Set<string>()
    parkings.forEach((p) => {
      keep.add(p.id)
      let entry = markers.get(p.id)
      if (!entry) {
        const el = createParkingMarkerEl()
        entry = { el, marker: new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map) }
        markers.set(p.id, entry)
      } else {
        entry.marker.setLngLat([p.lng, p.lat])
      }
      updateParkingMarkerEl(entry.el, p)
    })
    markers.forEach((entry, id) => {
      if (!keep.has(id)) {
        entry.marker.remove()
        markers.delete(id)
      }
    })
  }, [parkings, mapReady])

  // ── Fit the view once per scope, after the first snapshot ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || loading || didFitRef.current) return
    const points: [number, number][] = vehicles.filter((v) => v.lat !== null && v.lng !== null).map((v) => [v.lng!, v.lat!])
    // No vehicle with a fix yet: frame the scope's parkings, but only once the fleet snapshot is in.
    const coords = points.length ? points : lastSyncedAt !== null ? parkings.map((p): [number, number] => [p.lng, p.lat]) : []
    if (!coords.length) return
    didFitRef.current = true
    const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
    map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 600 })
  }, [vehicles, parkings, mapReady, loading, lastSyncedAt])

  const showTenant = isAdmin && scope?.kind === 'all'
  const hasFilters = routeId !== 'all' || statusFilter !== 'all' || search.trim() !== ''
  const driversLink = scope?.kind === 'tenant' ? `${portalBase}/drivers` : undefined

  if (!scope) {
    return (
      <div className="live-map-page">
        <div className="fleet-page-empty">
          <i className={scopeLoading ? 'ri-loader-4-line ri-spin' : 'ri-building-2-line'} />
          <p>{scopeLoading ? 'Yuklanmoqda…' : 'Uyushma aniqlanmadi — hisobingiz uyushmaga biriktirilmagan.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="live-map-page">
      {/* ── Top bar ── */}
      <div className="live-map-topbar">
        <div className="live-map-glass-card fleet-filters-card">
          {isAdmin && (
            <select
              className="fleet-select"
              value={adminMode === 'tenant' && uyushmaId ? uyushmaId : 'all'}
              onChange={(e) => {
                const value = e.target.value
                if (value === 'all') setAdminMode('all')
                else {
                  setUyushmaId(value)
                  setAdminMode('tenant')
                }
              }}
              aria-label="Uyushma"
            >
              <option value="all">Barcha uyushmalar</option>
              {tenantOptions.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
          <div className="route-chips-scroll" role="group" aria-label="Yo‘nalish">
            <button type="button" className={`route-chip ${routeId === 'all' ? 'active' : ''}`} onClick={() => setRouteId('all')}>
              Barcha yo‘nalishlar
              <span className="route-chip__count">{counts.total}</span>
            </button>
            {routeOptions.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`route-chip ${routeId === r.id ? 'active' : ''}`}
                onClick={() => setRouteId(routeId === r.id ? 'all' : r.id)}
                title={[r.name, r.uyushma_name].filter(Boolean).join(' · ') || undefined}
              >
                № {r.route_number}
                {r.uyushma_name && <span className="fleet-chip-tenant">{r.uyushma_name}</span>}
                <span className="route-chip__count">{r.vehicles_count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="live-map-glass-card fleet-status-card">
          {FLEET_STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              className={`fleet-status-chip fleet-status-chip--${s} ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
              aria-pressed={statusFilter === s}
              title={FLEET_STATUS_LABELS[s]}
            >
              <i className={FLEET_STATUS_ICONS[s]} />
              <strong>{counts[s]}</strong>
              <span className="fleet-status-chip__label">{FLEET_STATUS_LABELS[s]}</span>
            </button>
          ))}
          <span
            className={`ws-status-badge ${connectionState}`}
            title={connectionState === 'connected' ? 'Joylashuvlar real vaqtda yangilanmoqda' : 'Ma’lumot har 20 soniyada qayta yuklanadi'}
          >
            <span className="ws-status-dot" />
            {CONNECTION_LABELS[connectionState]}
          </span>
          <button type="button" className="fleet-icon-btn" onClick={refresh} disabled={syncing} aria-label="Yangilash" title="Yangilash">
            <i className={`ri-refresh-line ${syncing ? 'ri-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="live-map-body">
      {/* ── Fleet list ── */}
      <section className={`fleet-panel ${panelOpen ? 'is-open' : ''}`} aria-label="Smenadagi transportlar">
        <button type="button" className="fleet-panel__toggle" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
          <i className={panelOpen ? 'ri-arrow-left-s-line' : 'ri-list-check'} />
          <span>{panelOpen ? 'Yashirish' : `Ro‘yxat (${counts.total})`}</span>
        </button>

        {panelOpen && (
          <div className="fleet-panel__body">
            <div className="fleet-panel__head">
              <strong>Smenadagi transportlar</strong>
              <span className="fleet-muted">
                {lastSyncedAt ? `Yangilandi: ${timeAgo(lastSyncedAt, now)}` : loading ? 'Yuklanmoqda…' : '—'}
              </span>
            </div>
            <div className="fleet-search">
              <i className="ri-search-line" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Davlat raqami, ichki ID, haydovchi…"
                aria-label="Transport qidirish"
              />
            </div>

            {error && (
              <div className="fleet-alert" role="alert">
                <i className="ri-error-warning-fill" />
                <div style={{ flex: 1 }}>
                  {error}
                  {lastSyncedAt && <div className="fleet-muted">Ko‘rsatilayotgan ma’lumot {timeAgo(lastSyncedAt, now)} holatida.</div>}
                </div>
                <button type="button" className="fleet-btn fleet-btn--small" onClick={refresh}>
                  Qayta urinish
                </button>
              </div>
            )}
            {parkingsError && !error && (
              <div className="fleet-alert fleet-alert--warning" role="status">
                <i className="ri-parking-box-line" />
                <div>{parkingsError}</div>
              </div>
            )}

            <ul className="fleet-list">
              {loading && vehicles.length === 0 ? (
                <li className="fleet-list__state">
                  <i className="ri-loader-4-line ri-spin" /> Transportlar yuklanmoqda…
                </li>
              ) : vehicles.length === 0 ? (
                !error && (
                  <li className="fleet-list__state">
                    <i className="ri-steering-2-line" />
                    <div>Hozir faol smenadagi transport yo‘q.</div>
                    <div className="fleet-muted">Haydovchi ilovada smenani boshlaganda shu yerda paydo bo‘ladi.</div>
                    {scope.kind === 'tenant' && (
                      <Link className="fleet-link" to={`${portalBase}/vehicles`}>
                        Transportlar va biriktirishlar
                      </Link>
                    )}
                  </li>
                )
              ) : filtered.length === 0 ? (
                <li className="fleet-list__state">
                  Filtr bo‘yicha transport topilmadi.
                  {hasFilters && (
                    <button
                      type="button"
                      className="fleet-btn fleet-btn--small"
                      onClick={() => {
                        setRouteId('all')
                        setStatusFilter('all')
                        setSearch('')
                      }}
                    >
                      Filtrlarni tozalash
                    </button>
                  )}
                </li>
              ) : (
                filtered.map((v) => (
                  <li key={v.vehicle_id}>
                    <button
                      type="button"
                      className={`fleet-row ${v.vehicle_id === selectedId ? 'is-selected' : ''}`}
                      onClick={() => selectVehicle(v.vehicle_id, true)}
                    >
                      <span className={`fleet-dot fleet-dot--${v.status}`} aria-hidden="true" />
                      <span className="fleet-route-pill">№ {v.route_number}</span>
                      <span className="fleet-row__main">
                        <span className="fleet-row__title">
                          <span className="fleet-mono">{vehicleTitle(v)}</span> · {v.driver_name}
                        </span>
                        <span className={`fleet-row__sub fleet-row__sub--${v.status}`}>
                          {v.status === 'in_parking' && v.parking_name ? `${v.parking_name} · ` : ''}
                          {lastSeenText(v, now)}
                        </span>
                        {showTenant && <span className="fleet-row__tenant">{v.uyushma_name}</span>}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </section>

      {/* ── Map ── */}
      <div ref={mapContainer} className="live-map-viewport" />
      {mapError && (
        <div className="fleet-map-error" role="alert">
          <i className="ri-map-2-line" /> {mapError}
        </div>
      )}

      {selected && (
        <VehicleDetailDrawer
          vehicle={selected}
          route={routeDetails.get(selected.route_id)}
          now={now}
          showTenant={isAdmin}
          driversLink={driversLink}
          onClose={closeDrawer}
          onCenterMap={focusOn}
        />
      )}
      </div>
    </div>
  )
}
