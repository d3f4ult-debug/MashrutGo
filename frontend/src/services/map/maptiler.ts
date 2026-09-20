import maplibregl from 'maplibre-gl'

export type MapVariant = 'streets' | 'dark'

export const ANDIJON_CENTER: [number, number] = [72.3442, 40.7829]

/** MapTiler key from VITE_MAPTILER_KEY (never hardcoded). Empty => OpenStreetMap raster fallback. */
export function getMapTilerKey(): string {
  const key = (import.meta.env?.VITE_MAPTILER_KEY as string | undefined) || ''
  return key && !/get_your|placeholder/i.test(key) ? key : ''
}

export function hasMapTilerKey(): boolean {
  return Boolean(getMapTilerKey())
}

/** Real OpenStreetMap raster tiles (development / low traffic; use MapTiler in production). */
export function buildOsmStyle(variant: MapVariant = 'streets'): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
        paint:
          variant === 'dark'
            ? { 'raster-brightness-max': 0.55, 'raster-saturation': -0.7, 'raster-contrast': 0.1 }
            : {},
      },
    ],
  } as maplibregl.StyleSpecification
}

/** MapTiler vector style when a key is configured, otherwise OpenStreetMap tiles. */
export function getMapStyle(variant: MapVariant = 'streets'): string | maplibregl.StyleSpecification {
  const key = getMapTilerKey()
  if (!key) return buildOsmStyle(variant)
  const style = variant === 'dark' ? 'dataviz-dark' : 'streets-v2'
  return `https://api.maptiler.com/maps/${style}/style.json?key=${key}`
}

/** A revoked/exhausted MapTiler key must not leave users without a map. */
export function attachStyleFallback(map: maplibregl.Map, variant: MapVariant = 'streets') {
  let switched = false
  map.on('error', (e: any) => {
    const status = e?.error?.status
    if (!switched && hasMapTilerKey() && (status === 401 || status === 403)) {
      switched = true
      console.warn('MapTiler key rejected — switching to OpenStreetMap tiles')
      try {
        map.setStyle(buildOsmStyle(variant))
      } catch {
        // ignore
      }
    }
  })
}

export function initMap(
  container: HTMLElement,
  opts: { center?: [number, number]; zoom?: number; variant?: MapVariant } = {}
) {
  // Center convention: [lng, lat]; [lat, lng] is accepted and swapped (Andijon lat ~40, lng ~72)
  let centerLngLat: [number, number] = ANDIJON_CENTER
  if (opts.center) {
    centerLngLat = opts.center[0] > 50 ? [opts.center[0], opts.center[1]] : [opts.center[1], opts.center[0]]
  }

  const map = new maplibregl.Map({
    container,
    style: getMapStyle(opts.variant),
    center: centerLngLat,
    zoom: opts.zoom ?? 13
  })

  try {
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
  } catch {
    // controls are optional (tests / old browsers)
  }
  attachStyleFallback(map, opts.variant)
  return map
}

// --- Marker & Polyline helpers ---

export interface MarkerOptions {
  label?: string
  color?: string
  type?: 'vehicle' | 'stop' | 'user' | 'boarding' | 'alighting' | 'transfer'
  isStale?: boolean
}

export function addMarker(
  map: any,
  id: string,
  lnglat: [number, number],
  labelOrOpts: string | MarkerOptions = 'V'
) {
  if (!map) return null
  ;(map as any)._markers = (map as any)._markers || new Map()

  // remove existing with same id
  if ((map as any)._markers.has(id)) {
    const existing = (map as any)._markers.get(id)
    try {
      existing.remove()
    } catch {}
  }

  const opts: MarkerOptions =
    typeof labelOrOpts === 'string' ? { label: labelOrOpts } : labelOrOpts

  const el = document.createElement('div')
  el.className = `marker-custom marker-${opts.type || 'default'}`
  el.style.width = '32px'
  el.style.height = '32px'
  el.style.borderRadius = '50%'
  el.style.display = 'flex'
  el.style.alignItems = 'center'
  el.style.justifyContent = 'center'
  el.style.color = 'white'
  el.style.fontSize = '12px'
  el.style.fontWeight = 'bold'
  el.style.boxShadow = '0 3px 8px rgba(0,0,0,0.35)'
  el.style.transition = 'transform 0.3s ease, opacity 0.3s ease'
  el.style.cursor = 'pointer'

  if (opts.type === 'user') {
    el.style.background = '#2563eb'
    el.style.border = '2.5px solid white'
    el.innerHTML = '<i class="ri-user-location-fill text-base"></i>'
  } else if (opts.type === 'boarding') {
    el.style.background = '#16a34a'
    el.style.border = '2.5px solid white'
    el.innerHTML = '<i class="ri-map-pin-user-fill text-base"></i>'
  } else if (opts.type === 'alighting') {
    el.style.background = '#dc2626'
    el.style.border = '2.5px solid white'
    el.innerHTML = '<i class="ri-map-pin-5-fill text-base"></i>'
  } else if (opts.type === 'transfer') {
    el.style.background = '#d97706'
    el.style.border = '2.5px solid white'
    el.innerHTML = '<i class="ri-arrow-left-right-line text-xs"></i>'
  } else if (opts.type === 'stop') {
    el.style.background = '#ffffff'
    el.style.border = '3px solid #2563eb'
    el.style.color = '#2563eb'
    el.style.width = '24px'
    el.style.height = '24px'
    el.style.fontSize = '10px'
    el.innerText = opts.label || ''
  } else {
    // vehicle
    el.style.background = opts.isStale ? '#94a3b8' : opts.color || '#2563eb'
    el.style.border = opts.isStale ? '2px dashed #64748b' : '2.5px solid white'
    el.innerText = opts.label || 'V'
    if (opts.isStale) {
      el.title = 'Stale vehicle location (>30s)'
      el.style.opacity = '0.75'
    }
  }

  // Ensure lnglat format is [lng, lat]
  let coord: [number, number] = [lnglat[0], lnglat[1]]
  if (coord[0] < 50 && coord[1] > 50) {
    coord = [coord[1], coord[0]]
  }

  try {
    const marker = new maplibregl.Marker({ element: el }).setLngLat(coord).addTo(map)
    ;(map as any)._markers.set(id, marker)
    return marker
  } catch {
    // fallback in case mock/environment uses older constructor signature
    try {
      const marker = new (maplibregl as any).Marker(el).setLngLat(coord).addTo(map)
      ;(map as any)._markers.set(id, marker)
      return marker
    } catch {
      return null
    }
  }
}

export function removeMarker(map: any, id: string) {
  if (!map) return
  const m = (map as any)._markers?.get(id)
  if (m) {
    try {
      m.remove()
    } catch {}
    (map as any)._markers.delete(id)
  }
}

export function clearAllMarkers(map: any) {
  if (!map) return
  const markers: Map<string, any> = (map as any)._markers
  if (!markers) return
  for (const [, marker] of markers.entries()) {
    try {
      marker.remove()
    } catch {}
  }
  markers.clear()
}

export interface PolylineOptions {
  color?: string
  width?: number
  dashed?: boolean
}

export function drawPolyline(
  map: any,
  id: string,
  coords: [number, number][],
  options: PolylineOptions = {}
) {
  if (!map || !coords || coords.length === 0) return
  const sourceId = `line-${id}`
  const geojson = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: coords
    }
  }

  if (map.getSource && map.getSource(sourceId)) {
    try {
      (map.getSource(sourceId) as any).setData(geojson)
    } catch {}
    return
  }

  try {
    if (map.addSource) {
      map.addSource(sourceId, { type: 'geojson', data: geojson })
    }
    const layerDef: any = {
      id: sourceId,
      type: 'line',
      source: sourceId,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': options.color || '#2563eb',
        'line-width': options.width || 5
      }
    }

    if (options.dashed) {
      layerDef.paint['line-dasharray'] = [2, 2]
    }

    if (map.addLayer) {
      map.addLayer(layerDef)
    }
  } catch {
    // ignore
  }
}

export function clearPolyline(map: any, id: string) {
  if (!map) return
  const sourceId = `line-${id}`
  try {
    if (map.getLayer && map.getLayer(sourceId)) {
      map.removeLayer(sourceId)
    }
    if (map.getSource && map.getSource(sourceId)) {
      map.removeSource(sourceId)
    }
  } catch {
    // ignore
  }
}

export function fitBoundsToCoordinates(map: any, coords: [number, number][]) {
  if (!map || !coords || coords.length === 0) return
  try {
    const LngLatBounds = (maplibregl as any).LngLatBounds
    if (LngLatBounds) {
      const bounds = new LngLatBounds()
      coords.forEach((coord) => bounds.extend(coord))
      map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 800 })
    }
  } catch {
    // ignore
  }
}
