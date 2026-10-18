import maplibregl from 'maplibre-gl'

export const VIR_CITY_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

export function getMapTilerKey(): string {
  return import.meta.env.VITE_MAPTILER_API_KEY || ''
}

export function hasMapTilerKey(): boolean {
  return true // VirCity / OpenFreeMap requires no key
}

export function initMap(
  container: HTMLElement,
  opts: { center?: [number, number]; zoom?: number } = {}
) {
  const maptilerKey = getMapTilerKey()
  // Use custom MapTiler key if provided by env; otherwise use VirCity's OpenFreeMap Liberty style
  const style = maptilerKey
    ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${maptilerKey}`
    : VIR_CITY_MAP_STYLE

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
    zoom: opts.zoom ?? 13.2,
    pitch: 30, // 3D tilt perspective like VirCity
    attributionControl: { compact: true }
  })

  // Add navigation controls (+, -, compass pitch)
  try {
    if (maplibregl.NavigationControl) {
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    }
    if (maplibregl.FullscreenControl) {
      map.addControl(new maplibregl.FullscreenControl(), 'top-right')
    }
  } catch (e) {
    // ignore
  }

  // Add 3D building extrusions & lighting once style is loaded (like VirCity 3D)
  map.on('style.load', () => {
    try {
      // If 3D buildings layer isn't already present, add fill-extrusion from vector tiles
      if (!map.getLayer('3d-buildings')) {
        const layers = map.getStyle().layers || []
        // Find label layer to place buildings underneath labels
        let labelLayerId: string | undefined
        for (let i = 0; i < layers.length; i++) {
          if (layers[i].type === 'symbol' && (layers[i].layout as any)?.['text-field']) {
            labelLayerId = layers[i].id
            break
          }
        }

        map.addLayer(
          {
            id: '3d-buildings',
            source: 'openmaptiles',
            'source-layer': 'building',
            filter: ['!=', ['get', 'hide_3d'], true],
            type: 'fill-extrusion',
            minzoom: 13,
            paint: {
              'fill-extrusion-color': [
                'interpolate',
                ['linear'],
                ['coalesce', ['get', 'render_height'], ['get', 'height'], 5],
                0, '#e2e8f0',
                15, '#cbd5e1',
                30, '#94a3b8',
                60, '#64748b'
              ],
              'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['zoom'],
                13, 0,
                14.5, ['coalesce', ['get', 'render_height'], ['get', 'height'], 8]
              ],
              'fill-extrusion-base': [
                'interpolate',
                ['linear'],
                ['zoom'],
                13, 0,
                14.5, ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0]
              ],
              'fill-extrusion-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                13, 0,
                14.2, 0.88
              ],
              'fill-extrusion-vertical-gradient': true
            }
          },
          labelLayerId
        )
      }
    } catch (e) {
      console.warn('3D building extrusions could not be initialized:', e)
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
  heading?: number // direction in degrees 0-360
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
  el.style.display = 'flex'
  el.style.alignItems = 'center'
  el.style.justifyContent = 'center'
  el.style.transition = 'transform 0.8s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s ease'
  el.style.cursor = 'pointer'

  if (opts.type === 'user') {
    // Clean, modern passenger location indicator with directional heading cone
    el.style.width = '32px'
    el.style.height = '32px'
    el.style.position = 'relative'

    const rot = typeof opts.heading === 'number' ? opts.heading : 0

    el.innerHTML = `
      <div style="
        position: relative;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <!-- Pulse radar wave -->
        <div style="
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          background: rgba(37, 99, 235, 0.25);
          animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
        "></div>

        <!-- Heading beam cone -->
        <div style="
          position: absolute;
          width: 32px;
          height: 32px;
          transform: rotate(${rot}deg);
          pointer-events: none;
        ">
          <div style="
            position: absolute;
            top: -12px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-bottom: 10px solid #2563eb;
          "></div>
        </div>

        <!-- Center user dot -->
        <div style="
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #2563eb;
          border: 3px solid #ffffff;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          z-index: 2;
        "></div>
      </div>
    `
  } else if (opts.type === 'boarding') {
    // Clean, modern start pin 'A'
    el.style.width = '28px'
    el.style.height = '28px'
    el.innerHTML = `
      <div style="
        background: #059669;
        color: white;
        font-weight: 800;
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 8px;
        border: 2px solid white;
        box-shadow: 0 4px 10px rgba(0,0,0,0.25);
        display: flex;
        align-items: center;
        gap: 3px;
      ">
        <span>A</span>
      </div>
    `
  } else if (opts.type === 'alighting') {
    // Clean, modern destination pin 'B'
    el.style.width = '28px'
    el.style.height = '28px'
    el.innerHTML = `
      <div style="
        background: #dc2626;
        color: white;
        font-weight: 800;
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 8px;
        border: 2px solid white;
        box-shadow: 0 4px 10px rgba(0,0,0,0.25);
        display: flex;
        align-items: center;
        gap: 3px;
      ">
        <span>B</span>
      </div>
    `
  } else if (opts.type === 'transfer') {
    el.style.width = '24px'
    el.style.height = '24px'
    el.style.borderRadius = '50%'
    el.style.background = '#d97706'
    el.style.border = '2px solid white'
    el.innerHTML = '<i class="ri-arrow-left-right-line text-xs text-white"></i>'
  } else if (opts.type === 'stop') {
    el.style.width = '12px'
    el.style.height = '12px'
    el.style.borderRadius = '50%'
    el.style.background = '#ffffff'
    el.style.border = '2.5px solid #3b82f6'
    el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'
  } else {
    // Real 3D Car / Minibus Model (Top-Down isometric perspective like GTA/Yandex Navigator)
    el.style.width = '48px'
    el.style.height = '48px'
    el.style.position = 'relative'

    const rot = typeof opts.heading === 'number' ? opts.heading : 0
    const bodyColor = opts.isStale ? '#64748b' : opts.color || '#2563eb'

    el.innerHTML = `
      <div style="
        position: relative;
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        transform: rotate(${rot}deg);
        transform-origin: center center;
        transition: transform 0.6s ease;
      ">
        <!-- 3D Car Shadow on road -->
        <div style="
          position: absolute;
          width: 22px;
          height: 38px;
          border-radius: 8px;
          background: rgba(0,0,0,0.35);
          filter: blur(3px);
          transform: translateY(3px);
        "></div>

        <!-- Headlight Beam -->
        <div style="
          position: absolute;
          top: -18px;
          width: 28px;
          height: 24px;
          background: linear-gradient(to top, rgba(254, 240, 138, 0.7), transparent);
          clip-path: polygon(30% 100%, 70% 100%, 100% 0%, 0% 0%);
          pointer-events: none;
          opacity: ${opts.isStale ? 0 : 0.9};
        "></div>

        <!-- 3D Car Body (Chassis) -->
        <div style="
          position: relative;
          width: 22px;
          height: 36px;
          background: ${bodyColor};
          border-radius: 6px;
          border: 1.5px solid #ffffff;
          box-shadow: inset 0 2px 4px rgba(255,255,255,0.4), inset 0 -2px 4px rgba(0,0,0,0.4);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 3px 2px;
          z-index: 2;
        ">
          <!-- Front windshield -->
          <div style="
            width: 14px;
            height: 6px;
            background: #0f172a;
            border-radius: 2px 2px 1px 1px;
            opacity: 0.9;
          "></div>

          <!-- Roof Route Badge -->
          <div style="
            font-size: 8px;
            font-weight: 900;
            color: #ffffff;
            line-height: 1;
            text-shadow: 0 1px 2px rgba(0,0,0,0.6);
            letter-spacing: -0.5px;
          ">
            ${opts.label || '15'}
          </div>

          <!-- Rear window -->
          <div style="
            width: 12px;
            height: 4px;
            background: #0f172a;
            border-radius: 1px 1px 2px 2px;
            opacity: 0.85;
          "></div>
        </div>

        <!-- Wheels / Tires -->
        <div style="position: absolute; left: 9px; top: 10px; width: 3px; height: 7px; background: #1e293b; border-radius: 1px;"></div>
        <div style="position: absolute; right: 9px; top: 10px; width: 3px; height: 7px; background: #1e293b; border-radius: 1px;"></div>
        <div style="position: absolute; left: 9px; bottom: 10px; width: 3px; height: 7px; background: #1e293b; border-radius: 1px;"></div>
        <div style="position: absolute; right: 9px; bottom: 10px; width: 3px; height: 7px; background: #1e293b; border-radius: 1px;"></div>
      </div>
    `
    if (opts.isStale) {
      el.title = 'Ma’lumot yangilanmagan (>30s)'
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
