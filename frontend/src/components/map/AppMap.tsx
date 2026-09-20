import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { initMap, type MapVariant } from '@/services/map/maptiler'

interface Props {
  center?: [number, number] // [lng, lat]
  zoom?: number
  variant?: MapVariant
  className?: string
  onMapReady?: (map: any) => void
}

export type AppMapHandle = {
  centerOn: (lng: number, lat: number, zoom?: number) => void
}

/**
 * MapLibre map (MapTiler style when configured, OpenStreetMap tiles otherwise).
 * Never renders fake/simulated vehicles: if WebGL is unavailable an explicit message is shown.
 */
const AppMap = forwardRef<AppMapHandle | null, Props>(function AppMap(
  { center, zoom = 13, variant = 'streets', className = '', onMapReady },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any | null>(null)
  const readyRef = useRef(onMapReady)
  readyRef.current = onMapReady
  const [failed, setFailed] = useState(false)

  useImperativeHandle(
    ref,
    () => ({
      centerOn(lng: number, lat: number, z = 14) {
        try {
          mapRef.current?.easeTo({ center: [lng, lat], zoom: z, duration: 600 })
        } catch {
          // map not ready
        }
      },
    }),
    [],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let map: any
    try {
      map = initMap(el, { center, zoom, variant })
      mapRef.current = map
      const notify = () => readyRef.current?.(map)
      if (map.loaded?.()) notify()
      else map.once?.('load', notify)
    } catch (e) {
      console.warn('Map initialization failed:', e)
      setFailed(true)
    }
    return () => {
      try {
        map?.remove()
      } catch {
        // ignore
      }
      mapRef.current = null
    }
    // The map is created once; later center/zoom changes are applied through the ref handle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={`w-full h-full relative overflow-hidden bg-neutral-100 ${className}`}>
      <div ref={containerRef} className="w-full h-full" data-testid="app-map" />
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center p-4 text-neutral-500 text-xs">
          <i className="ri-map-2-line text-3xl text-neutral-400" />
          <span>Xarita bu qurilmada yuklanmadi (WebGL qo‘llab-quvvatlanmaydi).</span>
        </div>
      )}
    </div>
  )
})

export default AppMap
