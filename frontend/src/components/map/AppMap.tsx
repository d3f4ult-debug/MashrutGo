import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { hasMapTilerKey, initMap } from '@/services/map/maptiler'

type Marker = { id: string; lat: number; lng: number }

interface Props {
  center?: [number, number]
  zoom?: number
  markers?: Marker[]
  onMapClick?: (lng: number, lat: number) => void
  className?: string
}

export type AppMapHandle = {
  centerOn: (lng: number, lat: number, zoom?: number) => void
}

const AppMap = forwardRef<AppMapHandle | null, Props & { onMapReady?: (map: any) => void }>(
  function AppMap({ center = [40.782, 72.342], zoom = 13, markers = [], onMapReady, className = '' }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const mapRef = useRef<any | null>(null)
    const hasKey = hasMapTilerKey()

    useImperativeHandle(
      ref,
      () => ({
        centerOn(lng: number, lat: number, z = 14) {
          if (mapRef.current) {
            try {
              mapRef.current.setCenter([lng, lat])
              mapRef.current.setZoom(z)
            } catch (e) {
              // ignore
            }
          }
        }
      }),
      []
    )

    useEffect(() => {
      const el = containerRef.current
      if (!el || !hasKey) return

      try {
        const map = initMap(el, { center, zoom })
        mapRef.current = map
        if (onMapReady) onMapReady(map)
      } catch (e) {
        console.warn('Map initialization fallback:', e)
      }

      return () => {
        if (mapRef.current) {
          try {
            mapRef.current.remove()
          } catch (err) {
            // ignore
          }
          mapRef.current = null
        }
      }
    }, [center, zoom, onMapReady, hasKey])

    return (
      <div className={`w-full h-full relative overflow-hidden bg-neutral-100 ${className}`}>
        {hasKey ? (
          <div ref={containerRef} className="w-full h-full" />
        ) : (
          /* Simulated Andijon Vector Map Canvas fallback */
          <div className="w-full h-full relative flex flex-col items-center justify-center bg-slate-100 select-none">
            {/* Stylized streets background pattern */}
            <svg
              className="absolute inset-0 w-full h-full opacity-35"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <pattern id="streets-grid" width="80" height="80" patternUnits="userSpaceOnUse">
                  <path
                    d="M 80 0 L 0 0 0 80"
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M 0 40 L 80 40 M 40 0 L 40 80"
                    fill="none"
                    stroke="#cbd5e1"
                    strokeWidth="0.8"
                    strokeDasharray="4 4"
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#streets-grid)" />
              {/* Main arterial roads */}
              <line x1="10%" y1="90%" x2="90%" y2="10%" stroke="#60a5fa" strokeWidth="5" />
              <line x1="15%" y1="15%" x2="85%" y2="85%" stroke="#93c5fd" strokeWidth="3" />
            </svg>

            {/* City landmark pins on simulated map */}
            <div className="absolute top-1/4 left-1/3 flex items-center gap-1 text-[11px] font-bold text-slate-700 bg-white/90 px-2 py-1 rounded-md shadow-xs border border-slate-200">
              <span className="w-2 h-2 rounded-full bg-blue-600"></span>
              <span>Registon (Eski Shahar)</span>
            </div>

            <div className="absolute bottom-1/3 right-1/4 flex items-center gap-1 text-[11px] font-bold text-slate-700 bg-white/90 px-2 py-1 rounded-md shadow-xs border border-slate-200">
              <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
              <span>Yangi Bozor</span>
            </div>

            {/* Live animated vehicle indicators on simulated map */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 animate-pulse">
              <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shadow-md">
                15
              </div>
              <span className="text-[10px] font-bold bg-white/95 px-1.5 py-0.5 rounded shadow-xs text-neutral-800 border border-neutral-200">
                Liniyada
              </span>
            </div>

            {/* Key info pill at bottom */}
            <div className="absolute bottom-3 inset-x-4 mx-auto max-w-sm bg-white/95 backdrop-blur-xs border border-slate-200 text-slate-600 rounded-xl px-3 py-2 text-center text-xs shadow-md flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <i className="ri-map-pin-2-line text-blue-600 text-sm"></i>
                <span className="font-semibold text-slate-800">Andijon shahri</span>
              </div>
              <span className="text-[10px] text-slate-400">MapTiler simulyatsiyasi</span>
            </div>
          </div>
        )}
      </div>
    )
  }
)

export default AppMap
