import React, { useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { getRouteByNumber } from '@/services/routing/routingService'
import AppMap from '@/components/map/AppMap'
import { drawPolyline, addMarker, fitBoundsToCoordinates } from '@/services/map/maptiler'

export default function RouteOverview() {
  const { number } = useParams()
  const route = number ? getRouteByNumber(number) : null

  const handleMapReady = useCallback((map: any) => {
    if (!route) return
    try {
      // draw route geometry
      if (route.geometry && route.geometry.length > 0) {
        drawPolyline(map, `route-${route.routeNumber}`, route.geometry as any)
      }
      // draw stops
      route.stops.forEach((s) => {
        addMarker(map, `stop-${s.id}`, s.coordinates as [number, number], { label: s.name })
      })
      // fit to route bounds
      if (route.geometry && route.geometry.length > 0) {
        fitBoundsToCoordinates(map, route.geometry as any)
      }
    } catch (e) {
      // ignore map draw errors
    }
  }, [route])

  if (!route) {
    return (
      <div>
        <h2>Yo‘nalish topilmadi</h2>
      </div>
    )
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold">{route.name}</h2>
      <p className="text-sm text-neutral-600">{route.originName} → {route.destinationName}</p>
      <div className="mt-3 text-sm">
        <div>Fare: {route.fareSoM.toLocaleString('uz-UZ')} so‘m</div>
        <div>Interval: {route.intervalMinutes} min</div>
        <div>Active vehicles: {route.activeVehiclesCount}</div>
        <div>Parked vehicles: {route.parkedVehiclesCount}</div>
        <div>Stops: {route.stops.length}</div>
      </div>

      <div className="mt-4 rounded-lg overflow-hidden border border-neutral-200">
        <AppMap onMapReady={handleMapReady} />
      </div>
    </div>
  )
}
