import React from 'react'
import { Itinerary } from '@/types/client'
import { uz } from '@/locales/uz'

interface Props {
  title?: string
  eta?: string
  price?: string
  walking?: string
  transfers?: number
  routeNumbers?: string
  itinerary?: Itinerary
  isSelected?: boolean
  onClick?: () => void
}

export default function RouteCard({
  title,
  eta,
  price,
  walking,
  transfers,
  routeNumbers,
  itinerary,
  isSelected = false,
  onClick
}: Props) {
  // If rich itinerary object is passed, extract values
  const displayTitle = itinerary ? itinerary.title : title || 'Yo‘nalish'
  const displayEta = itinerary ? `${itinerary.totalDurationMinutes} daqiqa` : eta || ''
  const displayPrice = itinerary
    ? itinerary.totalFareSoM === 0
      ? '0 so‘m'
      : `${itinerary.totalFareSoM.toLocaleString('uz-UZ')} so‘m`
    : price || ''
  const displayWalking = itinerary ? `${itinerary.totalWalkingMeters} m` : walking || ''
  const transferCount = itinerary ? itinerary.transferCount : transfers ?? 0
  const routesStr = itinerary
    ? itinerary.routeNumbers.length > 0
      ? itinerary.routeNumbers.join(' → ')
      : uz.alternatives.walkingOnly
    : routeNumbers || ''
  const liveCount = itinerary ? itinerary.liveVehiclesCount : undefined

  // Badge styling depending on mode
  const getModeBadge = () => {
    if (!itinerary) return null
    switch (itinerary.mode) {
      case 'fastest':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
            <i className="ri-flashlight-line mr-1"></i> {uz.alternatives.modes.fastest}
          </span>
        )
      case 'cheapest':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
            <i className="ri-money-dollar-circle-line mr-1"></i> {uz.alternatives.modes.cheapest}
          </span>
        )
      case 'least_walking':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
            <i className="ri-walk-line mr-1"></i> {uz.alternatives.modes.least_walking}
          </span>
        )
      case 'least_transfers':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
            <i className="ri-arrow-left-right-line mr-1"></i> {uz.alternatives.modes.least_transfers}
          </span>
        )
      default:
        return null
    }
  }

  return (
    <div
      onClick={() => {
        if (itinerary && itinerary.routeNumbers && itinerary.routeNumbers[0]) {
          navigate(`/route/${itinerary.routeNumbers[0]}`)
        } else {
          onClick?.()
        }
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      className={`p-4 border rounded-xl bg-white transition-all cursor-pointer select-none text-left ${
        isSelected
          ? 'border-blue-600 ring-2 ring-blue-500/20 shadow-md'
          : 'border-neutral-200 hover:border-neutral-300 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-neutral-900">{displayTitle}</h3>
            {getModeBadge()}
          </div>
          {routesStr && (
            <div className="text-sm font-medium text-neutral-700 flex items-center gap-1.5 flex-wrap">
              {itinerary && itinerary.legs ? (
                itinerary.legs.map((leg, idx) => (
                  <React.Fragment key={leg.id || idx}>
                    {idx > 0 && <span className="text-neutral-400 text-xs">→</span>}
                    {leg.type === 'walking' ? (
                      <span className="inline-flex items-center text-xs text-neutral-600 bg-neutral-100 px-1.5 py-0.5 rounded">
                        <i className="ri-walk-line mr-0.5"></i> {leg.durationMinutes}m
                      </span>
                    ) : leg.type === 'transit' ? (
                      <span className="inline-flex items-center text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                        <i className="ri-bus-line mr-1"></i> {leg.routeNumber}
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                        <i className="ri-exchange-line"></i>
                      </span>
                    )}
                  </React.Fragment>
                ))
              ) : (
                <span>{routesStr}</span>
              )}
            </div>
          )}
        </div>

        <div className="text-right flex-shrink-0">
          <div className="text-lg font-bold text-neutral-900">{displayEta}</div>
          <div className="text-sm font-semibold text-neutral-600">{displayPrice}</div>
        </div>
      </div>

      <div className="mt-3 pt-2.5 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center">
            <i className="ri-walk-line mr-1 text-neutral-400"></i> {displayWalking}
          </span>
          <span className="inline-flex items-center">
            <i className="ri-transfer-line mr-1 text-neutral-400"></i>
            {uz.alternatives.transfersCount(transferCount)}
          </span>
        </div>

        {/* Live availability indicator */}
        {liveCount !== undefined && (
          <div>
            {liveCount > 0 ? (
              <span className="inline-flex items-center font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
                {uz.alternatives.liveVehiclesOnline(liveCount)}
              </span>
            ) : (
              <span className="inline-flex items-center text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 mr-1.5"></span>
                {uz.alternatives.noLiveVehicles}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
