import { Itinerary } from '@/types/client'
import { formatDistance, formatSom } from '@/components/ui/RouteCard'
import { uz } from '@/locales/uz'

interface Props {
  itinerary: Itinerary
  showDetailedSteps?: boolean
}

export default function ItineraryLegs({ itinerary, showDetailedSteps = true }: Props) {
  const legs = itinerary.legs
  const price = itinerary.isWalkingOnly ? '0 so‘m' : itinerary.fareKnown ? formatSom(itinerary.totalFareSoM) : 'Tarif belgilanmagan'

  return (
    <div className="p-4 bg-white rounded-xl border border-neutral-200 shadow-sm space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
        <div>
          <h4 className="font-bold text-neutral-900 text-base">{itinerary.title}</h4>
          <div className="text-xs text-neutral-500">
            {itinerary.departureTime} → {itinerary.arrivalTime}
            {itinerary.waitMinutes > 0 && ` · kutish ~${itinerary.waitMinutes} daq`}
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-bold text-blue-600">{itinerary.totalDurationMinutes} daqiqa</div>
          <div className="text-xs font-semibold text-neutral-600">{price}</div>
        </div>
      </div>

      {showDetailedSteps && legs.length > 0 ? (
        <div className="space-y-4 pt-1">
          {legs.map((leg, index) => {
            const isLast = index === legs.length - 1
            return (
              <div key={leg.id} className="relative flex items-start gap-3">
                {!isLast && (
                  <div
                    className={`absolute left-3.5 top-6 bottom-[-16px] w-0.5 ${
                      leg.type === 'walking' ? 'border-l-2 border-dashed border-neutral-300' : 'bg-blue-500'
                    }`}
                  />
                )}
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 z-10 text-xs shadow-sm ${
                    leg.type === 'walking' ? 'bg-neutral-100 text-neutral-600 border border-neutral-300' : 'bg-blue-600 text-white font-bold'
                  }`}
                >
                  <i className={leg.type === 'walking' ? 'ri-walk-line' : 'ri-bus-fill'}></i>
                </div>

                <div className="flex-1 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-neutral-800">{leg.instruction}</span>
                    <span className="text-xs font-medium text-neutral-500 whitespace-nowrap">
                      {leg.durationMinutes} daq ({formatDistance(leg.distanceMeters)})
                    </span>
                  </div>

                  {leg.type === 'transit' && (
                    <div className="mt-1.5 p-2 bg-blue-50/60 rounded-lg text-xs space-y-1 text-blue-900 border border-blue-100">
                      {leg.fromStop && (
                        <div className="flex items-center gap-1.5 font-medium">
                          <i className="ri-map-pin-user-fill text-green-600"></i>
                          <span>
                            {uz.routeDetails.boarding}: <strong>{leg.fromStop.name}</strong>
                          </span>
                        </div>
                      )}
                      {leg.intermediateStopsCount !== undefined && leg.intermediateStopsCount > 1 && (
                        <div className="text-neutral-500 pl-4">{uz.routeDetails.stopsCount(leg.intermediateStopsCount - 1)}</div>
                      )}
                      {leg.toStop && (
                        <div className="flex items-center gap-1.5 font-medium">
                          <i className="ri-map-pin-5-fill text-red-600"></i>
                          <span>
                            {uz.routeDetails.alighting}: <strong>{leg.toStop.name}</strong>
                          </span>
                        </div>
                      )}
                      <div className="text-neutral-600 pl-4 font-semibold">
                        Yo‘l haqi: {leg.fareKnown === false ? 'belgilanmagan' : formatSom(leg.fareSoM ?? 0)}
                      </div>
                      {leg.liveStatus === 'no_online_vehicle_visible' && (
                        <div className="text-neutral-500 pl-4">{uz.alternatives.noLiveVehicles}</div>
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
          <div>Piyoda: {formatDistance(itinerary.totalWalkingMeters)}</div>
          <div>Almashishlar: {itinerary.transferCount}</div>
          {itinerary.routeNumbers.length > 0 && <div>Marshrutlar: {itinerary.routeNumbers.join(', ')}</div>}
        </div>
      )}
    </div>
  )
}
