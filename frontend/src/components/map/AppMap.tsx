import React, { useEffect, useRef } from 'react'

type Marker = { id: string; lat: number; lng: number }

interface Props {
  center?: [number, number]
  zoom?: number
  markers?: Marker[]
  onMapClick?: (lng: number, lat: number) => void
}

export default function AppMap({ center = [40.782, 72.342], zoom = 9, markers = [] }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Map initialization will use MapTiler/maplibre in future. Fail gracefully if no key.
    // Placeholder: render simple box
  }, [])

  return (
    <div ref={ref} className="w-full h-64 bg-gray-100 rounded-md flex items-center justify-center">
      <div className="text-sm text-gray-600">Map placeholder (MapTiler)</div>
    </div>
  )
}
