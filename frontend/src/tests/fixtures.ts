import type { Itinerary, ItineraryLeg } from '@/types/client'

export function makeLeg(overrides: Partial<ItineraryLeg> = {}): ItineraryLeg {
  return {
    id: 'leg-0',
    type: 'walking',
    instruction: 'Bekatgacha piyoda',
    distanceMeters: 200,
    durationMinutes: 3,
    ...overrides,
  }
}

export function makeItinerary(overrides: Partial<Itinerary> = {}): Itinerary {
  return {
    id: 'itn-1',
    title: 'Tezkor yo‘nalish',
    mode: 'fastest',
    modeTags: [],
    totalDurationMinutes: 20,
    totalFareSoM: 2500,
    fareKnown: true,
    totalWalkingMeters: 300,
    walkingDurationMinutes: 4,
    waitMinutes: 0,
    transferCount: 0,
    legs: [],
    routeNumbers: ['15'],
    routeIds: [1],
    liveVehiclesCount: 0,
    liveStatus: 'no_online_vehicle_visible',
    isWalkingOnly: false,
    departureTime: '10:00',
    arrivalTime: '10:20',
    ...overrides,
  }
}
