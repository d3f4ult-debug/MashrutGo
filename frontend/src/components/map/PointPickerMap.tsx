import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ANDIJON_CENTER, attachStyleFallback, getMapStyle } from '../../services/map/maptiler'

interface Props {
  lat: number | null
  lng: number | null
  /** Optional geofence radius drawn around the point (meters). */
  radiusMeters?: number
  onChange: (lat: number, lng: number) => void
  height?: number
}

const SOURCE = 'picker-radius'

function circle(lat: number, lng: number, radiusM: number): [number, number][] {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
  return Array.from({ length: 49 }, (_, i) => {
    const a = (i / 48) * 2 * Math.PI
    return [lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)] as [number, number]
  })
}

/** Click (or drag the pin) to choose a location; used for stoyanka geofences. */
export function PointPickerMap({ lat, lng, radiusMeters, onChange, height = 260 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [styleVersion, setStyleVersion] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return
    let map: maplibregl.Map
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: getMapStyle('dark'),
        center: lat !== null && lng !== null ? [lng, lat] : ANDIJON_CENTER,
        zoom: lat !== null ? 15 : 13,
      })
    } catch {
      setFailed(true)
      return
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    attachStyleFallback(map, 'dark')
    map.on('style.load', () => setStyleVersion((v) => v + 1))
    map.on('click', (e) => onChangeRef.current(Number(e.lngLat.lat.toFixed(6)), Number(e.lngLat.lng.toFixed(6))))
    mapRef.current = map
    return () => {
      markerRef.current?.remove()
      markerRef.current = null
      map.remove()
      mapRef.current = null
    }
    // the map is created once; the point is synced below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) return
    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ draggable: true, color: '#06b6d4' }).setLngLat([lng, lat]).addTo(map)
      markerRef.current.on('dragend', () => {
        const p = markerRef.current!.getLngLat()
        onChangeRef.current(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)))
      })
    } else {
      markerRef.current.setLngLat([lng, lat])
    }
  }, [lat, lng])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion) return
    const valid = lat !== null && lng !== null && radiusMeters && !Number.isNaN(lat) && !Number.isNaN(lng)
    const data = {
      type: 'FeatureCollection' as const,
      features: valid
        ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [circle(lat!, lng!, radiusMeters!)] } }]
        : [],
    }
    const src = map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined
    if (src) {
      src.setData(data)
      return
    }
    map.addSource(SOURCE, { type: 'geojson', data })
    map.addLayer({ id: `${SOURCE}-fill`, type: 'fill', source: SOURCE, paint: { 'fill-color': '#06b6d4', 'fill-opacity': 0.18 } })
    map.addLayer({ id: `${SOURCE}-line`, type: 'line', source: SOURCE, paint: { 'line-color': '#06b6d4', 'line-width': 2 } })
  }, [styleVersion, lat, lng, radiusMeters])

  if (failed) {
    return <div style={{ padding: '1rem', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>Xarita yuklanmadi — koordinatalarni qo‘lda kiriting.</div>
  }

  return (
    <div
      ref={containerRef}
      style={{ height, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border-medium)' }}
      aria-label="Xaritadan joy tanlash"
    />
  )
}

export default PointPickerMap
