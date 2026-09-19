import { Itinerary } from '@/services/mock/itineraries'

type Vehicle = { id: string; lng: number; lat: number }

export function startMockVehicleStream(onUpdate: (vehicles: Vehicle[]) => void) {
  const vehicles: Vehicle[] = [
    { id: 'v1', lng: 72.34, lat: 40.78 },
    { id: 'v2', lng: 72.346, lat: 40.783 }
  ]

  const iv = setInterval(() => {
    // jitter positions a bit
    vehicles.forEach((v) => {
      v.lng += (Math.random() - 0.5) * 0.001
      v.lat += (Math.random() - 0.5) * 0.001
    })
    onUpdate(vehicles.map((v) => ({ ...v })))
  }, 1200)

  return () => clearInterval(iv)
}
