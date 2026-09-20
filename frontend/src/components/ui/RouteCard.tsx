import React from 'react'
import { Itinerary } from '@/types/client'
import { uz } from '@/locales/uz'
import { formatSom } from '@/utils/format'

interface Props {
  itinerary: Itinerary
  isSelected?: boolean
  onClick?: () => void
}

const MODE_BADGE: Record<string, { cls: string; icon: string }> = {
  fastest: { cls: 'bg-blue-100 text-blue-800', icon: 'ri-flashlight-line' },
  cheapest: { cls: 'bg-green-100 text-green-800', icon: 'ri-money-dollar-circle-line' },
  least_walking: { cls: 'bg-amber-100 text-amber-800', icon: 'ri-walk-line' },
  least_transfers: { cls: 'bg-purple-100 text-purple-800', icon: 'ri-arrow-left-right-line' },
}

// Re-exported for the client pages that already import it from here; one implementation app-wide.
export { formatSom }

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`
}

export default function RouteCard({ itinerary, isSelected = false, onClick }: Props) {
  const price = itinerary.isWalkingOnly ? '0 so‘m' : itinerary.fareKnown ? formatSom(itinerary.totalFareSoM) : 'Tarif belgilanmagan'

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      className={`p-4 border rounded-xl bg-white transition-all cursor-pointer select-none text-left ${
        isSelected ? 'border-blue-600 ring-2 ring-blue-500/20 shadow-md' : 'border-neutral-200 hover:border-neutral-300 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <h3 className="font-semibold text-neutral-900">{itinerary.title}</h3>
            {itinerary.modeTags.map((tag) => (
              <span key={tag} className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${MODE_BADGE[tag]?.cls}`}>
                <i className={`${MODE_BADGE[tag]?.icon} mr-1`}></i> {uz.alternatives.modes[tag]}
              </span>
            ))}
          </div>
          <div className="text-sm font-medium text-neutral-700 flex items-center gap-1.5 flex-wrap">
            {itinerary.legs.map((leg, idx) => (
              <React.Fragment key={leg.id}>
                {idx > 0 && <span className="text-neutral-400 text-xs">→</span>}
                {leg.type === 'transit' ? (
                  <span className="inline-flex items-center text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                    <i className="ri-bus-line mr-1"></i> {leg.routeNumber}
                  </span>
                ) : (
                  <span className="inline-flex items-center text-xs text-neutral-600 bg-neutral-100 px-1.5 py-0.5 rounded">
                    <i className="ri-walk-line mr-0.5"></i> {leg.durationMinutes} daq
                  </span>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          <div className="text-lg font-bold text-neutral-900">{itinerary.totalDurationMinutes} daqiqa</div>
          <div className={`text-sm font-semibold ${itinerary.fareKnown || itinerary.isWalkingOnly ? 'text-neutral-600' : 'text-amber-600'}`}>{price}</div>
        </div>
      </div>

      <div className="mt-3 pt-2.5 border-t border-neutral-100 flex items-center justify-between gap-2 text-xs text-neutral-500 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center">
            <i className="ri-walk-line mr-1 text-neutral-400"></i> {formatDistance(itinerary.totalWalkingMeters)}
          </span>
          <span className="inline-flex items-center">
            <i className="ri-transfer-line mr-1 text-neutral-400"></i>
            {uz.alternatives.transfersCount(itinerary.transferCount)}
          </span>
        </div>

        {!itinerary.isWalkingOnly &&
          (itinerary.liveVehiclesCount > 0 ? (
            <span className="inline-flex items-center font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
              {uz.alternatives.liveVehiclesOnline(itinerary.liveVehiclesCount)}
            </span>
          ) : (
            <span className="inline-flex items-center text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 mr-1.5"></span>
              {uz.alternatives.noLiveVehicles}
            </span>
          ))}
      </div>
    </div>
  )
}
