/**
 * Driver live map.
 *
 * - Assigned route geometry (both directions; the current shift direction is highlighted)
 * - Passengers in "Kutayapman" state on this route, live over the driver WebSocket.
 *   A marker disappears as soon as the passenger presses "Mashinadaman" (client.nearby.removed).
 *   No PII: only an anonymous watch id and the waiting time are shown.
 * - Stoyanka geofences with live vehicle counts; presence is detected automatically by the backend.
 * - The driver's own position from the GPS transmitter.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useDriverSession } from '../../contexts/DriverSessionContext'
import { driverApi } from '../../services/api/driverApi'
import { ANDIJON_CENTER, attachStyleFallback, getMapStyle } from '../../services/map/maptiler'
import { publicChannel } from '../../services/realtime/websocket'
import { useChannel, useChannelEvent } from '../../hooks/useRealtime'
import { timeAgo } from '../../utils/format'
import type { DriverParking, WaitingPassenger } from '../../types/driver'
import type { ParkingCountPayload } from '../../types/map'
import './DriverMap.css'

const ROUTE_COLORS = { outbound: '#3b82f6', inbound: '#22c55e' } as const
const PARKING_REFRESH_MS = 30_000

type LngLat = [number, number]

function circlePolygon(lat: number, lng: number, radiusM: number): LngLat[] {
  const points = 48
  const coords: LngLat[] = []
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * 2 * Math.PI
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)])
  }
  return coords
}

function distanceMeters(a: LngLat, b: LngLat): number {
  const R = 6_371_000
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`
}

function passengerElement(sameDirection: boolean): HTMLDivElement {
  const el = document.createElement('div')
  el.className = `waiting-client-marker${sameDirection ? '' : ' waiting-client-marker--other'}`
  el.innerHTML =
    '<div class="waiting-client-marker__pulse"></div><div class="waiting-client-marker__dot"><i class="ri-user-location-fill"></i></div>'
  return el
}

function selfElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'driver-self-marker'
  el.innerHTML = '<i class="ri-bus-2-fill"></i>'
  return el
}

export function DriverMap() {
  const { me, shift, waiting, gps, wsState, parking: presence } = useDriverSession()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const passengerMarkers = useRef(new Map<string, maplibregl.Marker>())
  const selfMarker = useRef<maplibregl.Marker | null>(null)
  const fittedRef = useRef(false)
  const [styleVersion, setStyleVersion] = useState(0)
  const [mapError, setMapError] = useState<string | null>(null)
  const [parkings, setParkings] = useState<DriverParking[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  // ── Map lifecycle ──
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let map: maplibregl.Map
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: getMapStyle('dark'),
        center: ANDIJON_CENTER,
        zoom: 13,
        attributionControl: false,
      })
    } catch (err) {
      console.warn('Map initialization failed', err)
      setMapError('Xarita bu qurilmada yuklanmadi (WebGL qo‘llab-quvvatlanmaydi).')
      return
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
    attachStyleFallback(map, 'dark')
    // Sources/layers must be (re)created after the first load and after any style switch
    map.on('style.load', () => setStyleVersion((v) => v + 1))
    mapRef.current = map
    const markers = passengerMarkers.current
    return () => {
      markers.forEach((m) => m.remove())
      markers.clear()
      selfMarker.current?.remove()
      selfMarker.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ── Route geometry + stops ──
  const route = me?.route ?? null
  const activeDirection = shift?.direction ?? null
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion || !route) return
    const lines = {
      type: 'FeatureCollection' as const,
      features: route.directions.map((d) => ({
        type: 'Feature' as const,
        properties: { direction: d.type, active: activeDirection === null || activeDirection === d.type ? 1 : 0 },
        geometry: { type: 'LineString' as const, coordinates: d.geometry },
      })),
    }
    const stops = {
      type: 'FeatureCollection' as const,
      features: route.directions
        .filter((d) => activeDirection === null || d.type === activeDirection)
        .flatMap((d) =>
          d.stops.map((s) => ({
            type: 'Feature' as const,
            properties: { name: s.name, direction: d.type },
            geometry: { type: 'Point' as const, coordinates: s.coordinates },
          })),
        ),
    }
    const lineSrc = map.getSource('driver-route') as maplibregl.GeoJSONSource | undefined
    if (lineSrc) lineSrc.setData(lines)
    else {
      map.addSource('driver-route', { type: 'geojson', data: lines })
      map.addLayer({
        id: 'driver-route-line',
        type: 'line',
        source: 'driver-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'direction'], 'inbound', ROUTE_COLORS.inbound, ROUTE_COLORS.outbound],
          'line-width': ['case', ['==', ['get', 'active'], 1], 5, 3],
          'line-opacity': ['case', ['==', ['get', 'active'], 1], 0.9, 0.35],
        },
      })
    }
    const stopSrc = map.getSource('driver-stops') as maplibregl.GeoJSONSource | undefined
    if (stopSrc) stopSrc.setData(stops)
    else {
      map.addSource('driver-stops', { type: 'geojson', data: stops })
      map.addLayer({
        id: 'driver-stops-circle',
        type: 'circle',
        source: 'driver-stops',
        paint: {
          'circle-radius': 4,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': ['match', ['get', 'direction'], 'inbound', ROUTE_COLORS.inbound, ROUTE_COLORS.outbound],
        },
      })
    }
    if (!fittedRef.current) {
      const bounds = new maplibregl.LngLatBounds()
      route.directions.forEach((d) => d.geometry.forEach((c) => bounds.extend(c)))
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 })
        fittedRef.current = true
      }
    }
  }, [styleVersion, route, activeDirection])

  // ── Stoyankas (REST + live counts) ──
  const loadParkings = useCallback(() => {
    driverApi
      .parkings()
      .then(setParkings)
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    loadParkings()
    const t = setInterval(loadParkings, PARKING_REFRESH_MS)
    return () => clearInterval(t)
  }, [loadParkings])
  useEffect(() => {
    loadParkings()
  }, [presence?.parkingId, presence?.isInside, loadParkings])
  useChannel(publicChannel)
  useChannelEvent<ParkingCountPayload>(publicChannel, 'parking.count.updated', (evt) => {
    setParkings((list) => list.map((p) => (p.id === evt.payload.parking_id ? { ...p, vehicleCount: evt.payload.vehicle_count } : p)))
  })

  const parkingsView = useMemo(
    () =>
      parkings.map((p) => ({
        ...p,
        isDriverInside: presence ? presence.isInside && presence.parkingId === p.id : p.isDriverInside,
      })),
    [parkings, presence],
  )

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion) return
    const data = {
      type: 'FeatureCollection' as const,
      features: parkingsView.map((p) => ({
        type: 'Feature' as const,
        properties: { inside: p.isDriverInside ? 1 : 0, name: p.name },
        geometry: { type: 'Polygon' as const, coordinates: [circlePolygon(p.lat, p.lng, p.radiusMeters)] },
      })),
    }
    const src = map.getSource('driver-parkings') as maplibregl.GeoJSONSource | undefined
    if (src) {
      src.setData(data)
      return
    }
    map.addSource('driver-parkings', { type: 'geojson', data })
    const beforeId = map.getLayer('driver-route-line') ? 'driver-route-line' : undefined
    map.addLayer(
      {
        id: 'driver-parkings-fill',
        type: 'fill',
        source: 'driver-parkings',
        paint: { 'fill-color': ['case', ['==', ['get', 'inside'], 1], '#22c55e', '#f59e0b'], 'fill-opacity': 0.15 },
      },
      beforeId,
    )
    map.addLayer(
      {
        id: 'driver-parkings-line',
        type: 'line',
        source: 'driver-parkings',
        paint: {
          'line-color': ['case', ['==', ['get', 'inside'], 1], '#22c55e', '#f59e0b'],
          'line-width': 2,
          'line-dasharray': [3, 2],
          'line-opacity': 0.7,
        },
      },
      beforeId,
    )
  }, [styleVersion, parkingsView])

  // ── Waiting passengers ──
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const markers = passengerMarkers.current
    const ids = new Set(waiting.map((p) => p.watchId))
    markers.forEach((marker, id) => {
      if (!ids.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    })
    waiting.forEach((p) => {
      const existing = markers.get(p.watchId)
      if (existing) {
        existing.setLngLat([p.lng, p.lat])
        return
      }
      const marker = new maplibregl.Marker({ element: passengerElement(!activeDirection || p.direction === activeDirection) })
        .setLngLat([p.lng, p.lat])
        .setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setText(`Kutayapti · ${timeAgo(p.waitingSinceMs)}`))
        .addTo(map)
      markers.set(p.watchId, marker)
    })
  }, [waiting, activeDirection])

  // ── Own position ──
  const fix = gps.lastFix
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!fix || !shift) {
      selfMarker.current?.remove()
      selfMarker.current = null
      return
    }
    if (!selfMarker.current) selfMarker.current = new maplibregl.Marker({ element: selfElement() }).setLngLat([fix.lng, fix.lat]).addTo(map)
    else selfMarker.current.setLngLat([fix.lng, fix.lat])
  }, [fix, shift])

  const myPos: LngLat | null = fix && shift ? [fix.lng, fix.lat] : null
  const nearest = useMemo(() => {
    const list: (WaitingPassenger & { distance: number | null })[] = waiting.map((p) => ({
      ...p,
      distance: myPos ? distanceMeters(myPos, [p.lng, p.lat]) : null,
    }))
    return list.sort((a, b) => (a.distance ?? a.waitingSinceMs) - (b.distance ?? b.waitingSinceMs)).slice(0, 5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, fix?.lat, fix?.lng])

  const focus = (lng: number, lat: number) => mapRef.current?.easeTo({ center: [lng, lat], zoom: 16, duration: 600 })

  return (
    <div className="driver-map-page">
      <div className={`map-status-bar map-status-bar--${wsState}`}>
        <div className="map-status-bar__indicator" />
        <span>
          {wsState === 'connected' && 'Real-time ulangan'}
          {wsState === 'connecting' && 'Ulanmoqda…'}
          {wsState === 'reconnecting' && 'Qayta ulanmoqda…'}
          {wsState === 'disconnected' && 'Aloqa uzilgan'}
        </span>
        {shift && (
          <span className="map-status-bar__badge">
            <i className="ri-user-location-fill" /> {waiting.length} kutmoqda
          </span>
        )}
      </div>

      <div className="driver-map-container" ref={containerRef}>
        {mapError && (
          <div className="map-error-overlay">
            <i className="ri-error-warning-line" />
            <p>{mapError}</p>
          </div>
        )}
      </div>

      {route && (
        <div className="map-route-pill">
          <i className="ri-route-line" />
          <span className="map-route-pill__number">{route.routeNumber}</span>
          <span className="map-route-pill__name">{route.name}</span>
        </div>
      )}

      {myPos && (
        <button className="map-locate-btn" onClick={() => focus(myPos[0], myPos[1])} aria-label="Mening joylashuvim">
          <i className="ri-focus-3-line" />
        </button>
      )}

      {!shift && (
        <div className="map-shift-hint">
          <i className="ri-information-line" />
          <span>
            Smena faol emas. Kutayotgan yo‘lovchilar faqat smena davomida ko‘rinadi.{' '}
            <Link to="/driver">Smenani boshlash</Link>
          </span>
        </div>
      )}

      <div className="map-bottom-panels">
        {shift && nearest.length > 0 && (
          <div className="map-waiting-list">
            {nearest.map((p) => (
              <button key={p.watchId} className="map-waiting-item" onClick={() => focus(p.lng, p.lat)}>
                <i className="ri-user-location-fill" />
                <span>{p.distance !== null ? formatDistance(p.distance) : 'Masofa noma’lum'}</span>
                <small>
                  {timeAgo(p.waitingSinceMs, now)}
                  {activeDirection && p.direction !== activeDirection ? ' · qarama-qarshi yo‘nalish' : ''}
                </small>
              </button>
            ))}
          </div>
        )}

        {parkingsView.length > 0 && (
          <div className="map-parking-panel">
            {parkingsView.map((p) => (
              <button
                key={p.id}
                className={`map-parking-card ${p.isDriverInside ? 'map-parking-card--inside' : ''}`}
                onClick={() => focus(p.lng, p.lat)}
              >
                <div className="map-parking-card__icon">
                  <i className={p.isDriverInside ? 'ri-parking-box-fill' : 'ri-parking-box-line'} />
                </div>
                <div className="map-parking-card__info">
                  <span className="map-parking-card__name">{p.name}</span>
                  <span className="map-parking-card__count">
                    {p.vehicleCount} transport
                    {p.isDriverInside && <span className="map-parking-card__inside-badge">Siz shu yerdasiz</span>}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="map-legend">
        <div className="map-legend__item">
          <span className="map-legend__color" style={{ background: ROUTE_COLORS.outbound }} />
          <span>Borish</span>
        </div>
        <div className="map-legend__item">
          <span className="map-legend__color" style={{ background: ROUTE_COLORS.inbound }} />
          <span>Qaytish</span>
        </div>
        <div className="map-legend__item">
          <span className="map-legend__color map-legend__color--client" />
          <span>Kutayapman</span>
        </div>
      </div>
    </div>
  )
}
