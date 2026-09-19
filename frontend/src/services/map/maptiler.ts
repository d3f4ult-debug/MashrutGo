import maplibregl from 'maplibre-gl'

export function getMapTilerKey(): string {
  return import.meta.env.VITE_MAPTILER_API_KEY || 'get_your_own_OpIi9ZULNHzrESv6T2vL'
}

export function hasMapTilerKey(): boolean {
  return Boolean(getMapTilerKey())
}

export function initMap(
  container: HTMLElement,
  opts: { center?: [number, number]; zoom?: number } = {}
) {
  const key = getMapTilerKey()
  const style = `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`

  // Center convention: opts.center can be [lat, lng] or [lng, lat]. In Andijon, lat ~ 40.78, lng ~ 72.34
  let centerLngLat: [number, number] = [72.342, 40.782]
  if (opts.center) {
    // If first element is > 50, it's lng; if < 50, it's lat
    if (opts.center[0] > 50) {
      centerLngLat = [opts.center[0], opts.center[1]]
    } else {
      centerLngLat = [opts.center[1], opts.center[0]]
    }
  }

  const map = new maplibregl.Map({
    container,
    style,
    center: centerLngLat,
    zoom: opts.zoom ?? 13
  })

  // Add navigation controls (+, -, compass)
  try {
    if (maplibregl.NavigationControl) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
    }
  } catch (e) {
    // ignore
  }

  // Gracefully handle style error if MapTiler key is invalid/exhausted
  map.on('error', (e: any) => {
    if (e?.error?.status === 403 || e?.error?.status === 401) {
      console.warn('MapTiler key unauthorized, falling back to open tiles...')
      try {
        map.setStyle('https://demotiles.maplibre.org/style.json')
      } catch (err) {}
    }
  })

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
    } catch (e) {}
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
  } catch (e) {
    // fallback in case mock/environment uses older constructor signature
    try {
      const marker = new (maplibregl as any).Marker(el).setLngLat(coord).addTo(map)
      ;(map as any)._markers.set(id, marker)
      return marker
    } catch (err) {
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
    } catch (e) {}
    ;(map as any)._markers.delete(id)
  }
}

export function clearAllMarkers(map: any) {
  if (!map) return
  const markers: Map<string, any> = (map as any)._markers
  if (!markers) return
  for (const [, marker] of markers.entries()) {
    try {
      marker.remove()
    } catch (e) {}
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
      ;(map.getSource(sourceId) as any).setData(geojson)
    } catch (e) {}
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
  } catch (e) {
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
  } catch (e) {
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
  } catch (e) {
    // ignore
  }
}
