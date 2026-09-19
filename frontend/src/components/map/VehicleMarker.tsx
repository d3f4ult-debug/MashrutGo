import React from 'react'

export default function VehicleMarker({ label = 'V' }: { label?: string }) {
  return (
    <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center text-white text-xs shadow-md">{label}</div>
  )
}
import React from 'react'

export default function VehicleMarker({ label }: { label?: string }) {
  return (
    <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center text-white text-xs shadow-md">
      {label || 'V'}
    </div>
  )
}
