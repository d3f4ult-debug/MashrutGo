import React from 'react'
import { Itinerary, ItineraryLeg } from '@/types/client'
import { uz } from '@/locales/uz'

interface Props {
  itinerary: Itinerary | any
  showDetailedSteps?: boolean
}

export default function ItineraryLegs({ itinerary, showDetailedSteps = true }: Props) {
  if (!itinerary) return null

  const legs: ItineraryLeg[] = itinerary.legs || []

  return (
    <div className="p-4 bg-white rounded-xl border border-neutral-200 shadow-sm space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
        <div>
          <h4 className="font-bold text-neutral-900 text-base">{itinerary.title}</h4>
          <div className="text-xs text-neutral-500">
            {itinerary.departureTime} → {itinerary.arrivalTime}
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-bold text-blue-600">
            {itinerary.totalDurationMinutes ? `${itinerary.totalDurationMinutes} daqiqa` : itinerary.eta}
          </div>
          <div className="text-xs font-semibold text-neutral-600">
            {itinerary.totalFareSoM !== undefined
              ? itinerary.totalFareSoM === 0
                ? '0 so‘m'
                : `${itinerary.totalFareSoM.toLocaleString('uz-UZ')} so‘m`
              : itinerary.price}
          </div>
        </div>
      </div>

      {showDetailedSteps && legs.length > 0 ? (
        <div className="space-y-4 pt-1">
          {legs.map((leg, index) => {
            const isLast = index === legs.length - 1

            return (
              <div key={leg.id || index} className="relative flex items-start gap-3">
                {/* Vertical connecting line */}
                {!isLast && (
                  <div
                    className={`absolute left-3.5 top-6 bottom-[-16px] w-0.5 ${
                      leg.type === 'walking'
                        ? 'border-l-2 border-dashed border-neutral-300'
                        : 'bg-blue-500'
                    }`}
                  />
                )}

                {/* Step icon */}
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 z-10 text-xs shadow-sm ${
                    leg.type === 'walking'
                      ? 'bg-neutral-100 text-neutral-600 border border-neutral-300'
                      : leg.type === 'transfer'
                      ? 'bg-amber-100 text-amber-700 border border-amber-300'
                      : 'bg-blue-600 text-white font-bold'
                  }`}
                >
                  {leg.type === 'walking' ? (
                    <i className="ri-walk-line"></i>
                  ) : leg.type === 'transfer' ? (
                    <i className="ri-arrow-left-right-line"></i>
                  ) : (
                    <i className="ri-bus-fill"></i>
                  )}
                </div>

                {/* Step details */}
                <div className="flex-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-neutral-800">
                      {leg.instruction}
                    </span>
                    <span className="text-xs font-medium text-neutral-500 ml-2">
                      {leg.durationMinutes} daq ({leg.distanceMeters} m)
                    </span>
                  </div>

                  {/* Transit specific sub-info */}
                  {leg.type === 'transit' && (
                    <div className="mt-1.5 p-2 bg-blue-50/60 rounded-lg text-xs space-y-1 text-blue-900 border border-blue-100">
                      {leg.fromStop && (
                        <div className="flex items-center gap-1.5 font-medium">
                          <i className="ri-map-pin-user-fill text-green-600"></i>
                          <span>{uz.routeDetails.boarding}: <strong>{leg.fromStop.name}</strong></span>
                        </div>
                      )}
                      {leg.intermediateStopsCount !== undefined && leg.intermediateStopsCount > 0 && (
                        <div className="text-neutral-500 pl-4">
                          {uz.routeDetails.stopsCount(leg.intermediateStopsCount)}
                        </div>
                      )}
                      {leg.toStop && (
                        <div className="flex items-center gap-1.5 font-medium">
                          <i className="ri-map-pin-5-fill text-red-600"></i>
                          <span>{uz.routeDetails.alighting}: <strong>{leg.toStop.name}</strong></span>
                        </div>
                      )}
                      {leg.fareSoM && (
                        <div className="text-neutral-600 pl-4 font-semibold">
                          Yo‘l haqi: {leg.fareSoM.toLocaleString('uz-UZ')} so‘m
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-sm text-neutral-600 space-y-1">
          <div>Piyoda: {itinerary.walking || `${itinerary.totalWalkingMeters} m`}</div>
          <div>Almashishlar: {itinerary.transfers ?? itinerary.transferCount}</div>
          {itinerary.routeNumbers && (
            <div>Marshrutlar: {Array.isArray(itinerary.routeNumbers) ? itinerary.routeNumbers.join(', ') : itinerary.routeNumbers}</div>
          )}
        </div>
      )}
    </div>
  )
}
