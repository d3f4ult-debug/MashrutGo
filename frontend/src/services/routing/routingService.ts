// Routing and Geocoding Service for MashrutGo Client
import { Coordinates, Itinerary, OptimizationMode, StopPoint } from '@/types/client'

export interface RouteSearchResult {
  itineraries: Itinerary[]
  searchedAt: number
}

export interface RouteOverview {
  routeNumber: string
  name: string
  originName: string
  destinationName: string
  fareSoM: number
  intervalMinutes: number
  geometry: Coordinates[]
  stops: StopPoint[]
  activeVehiclesCount: number
  parkedVehiclesCount: number
}

// Famous landmarks in Andijon for instant search suggestions
export const ANDIJON_LANDMARKS = [
  { name: 'Andijon Temir Yo‘l Vokzali', coordinates: [72.348, 40.789] as Coordinates, description: 'Temir yo‘l vokzali' },
  { name: 'Eski Shahar (Registon)', coordinates: [72.342, 40.782] as Coordinates, description: 'Tarixiy markaz' },
  { name: 'Yangi Bozor (Beshchinor)', coordinates: [72.361, 40.774] as Coordinates, description: 'Savdo markazi' },
  { name: 'Zahiriddin Muhammad Bobur Bog‘i', coordinates: [72.378, 40.795] as Coordinates, description: 'Dam olish maskani' },
  { name: 'Viloyat Ko‘p Tarmoqli Shifoxonasi', coordinates: [72.331, 40.768] as Coordinates, description: 'Tibbiyot markazi' },
  { name: 'Andijon Shahar Avtovokzali', coordinates: [72.325, 40.801] as Coordinates, description: 'Shaharlararo avtovokzal' },
  { name: 'Andijon Davlat Universiteti (ADU)', coordinates: [72.355, 40.785] as Coordinates, description: 'Universitet bosh binosi' },
  { name: 'Navro‘z Savdo Majmuasi', coordinates: [72.345, 40.778] as Coordinates, description: 'Bozor va savdo rastalari' }
]

// Sample Route Catalog for Andijon Marshrutkas
export const ANDIJON_ROUTES: Record<string, RouteOverview> = {
  '15': {
    routeNumber: '15',
    name: '15-sonli Marshrut',
    originName: 'Eski Shahar',
    destinationName: 'Yangi Bozor',
    fareSoM: 2000,
    intervalMinutes: 4,
    geometry: [
      [72.342, 40.782],
      [72.345, 40.781],
      [72.350, 40.779],
      [72.355, 40.776],
      [72.361, 40.774]
    ],
    stops: [
      { id: 's1', name: 'Eski Shahar bekat', coordinates: [72.342, 40.782] },
      { id: 's2', name: 'Bobur maydoni', coordinates: [72.345, 40.781] },
      { id: 's3', name: 'ADU bekati', coordinates: [72.350, 40.779] },
      { id: 's4', name: 'Navro‘z majmuasi', coordinates: [72.355, 40.776] },
      { id: 's5', name: 'Yangi Bozor bekat', coordinates: [72.361, 40.774] }
    ],
    activeVehiclesCount: 6,
    parkedVehiclesCount: 2
  },
  '22': {
    routeNumber: '22',
    name: '22-sonli Marshrut',
    originName: 'Vokzal',
    destinationName: 'Bobur Bog‘i',
    fareSoM: 2000,
    intervalMinutes: 5,
    geometry: [
      [72.348, 40.789],
      [72.355, 40.787],
      [72.365, 40.791],
      [72.378, 40.795]
    ],
    stops: [
      { id: 's21', name: 'Vokzal bekat', coordinates: [72.348, 40.789] },
      { id: 's22', name: 'Viloyat Hokimligi', coordinates: [72.355, 40.787] },
      { id: 's23', name: 'Mashinasozlik kolleji', coordinates: [72.365, 40.791] },
      { id: 's24', name: 'Bobur Bog‘i asosiy kirish', coordinates: [72.378, 40.795] }
    ],
    activeVehiclesCount: 4,
    parkedVehiclesCount: 1
  },
  '7': {
    routeNumber: '7',
    name: '7-sonli Marshrut',
    originName: 'Shifoxona',
    destinationName: 'Vokzal',
    fareSoM: 2000,
    intervalMinutes: 6,
    geometry: [
      [72.331, 40.768],
      [72.338, 40.775],
      [72.342, 40.782],
      [72.348, 40.789]
    ],
    stops: [
      { id: 's71', name: 'Ko‘p Tarmoqli Shifoxona', coordinates: [72.331, 40.768] },
      { id: 's72', name: 'G‘o‘rxona bekati', coordinates: [72.338, 40.775] },
      { id: 's73', name: 'Eski Shahar', coordinates: [72.342, 40.782] },
      { id: 's74', name: 'Vokzal', coordinates: [72.348, 40.789] }
    ],
    activeVehiclesCount: 0, // neutral "no online vehicles visible" case
    parkedVehiclesCount: 1
  },
  '33': {
    routeNumber: '33',
    name: '33-sonli Marshrut',
    originName: 'Avtovokzal',
    destinationName: 'Yangi Bozor',
    fareSoM: 2000,
    intervalMinutes: 5,
    geometry: [
      [72.325, 40.801],
      [72.335, 40.792],
      [72.348, 40.785],
      [72.361, 40.774]
    ],
    stops: [
      { id: 's331', name: 'Avtovokzal', coordinates: [72.325, 40.801] },
      { id: 's332', name: 'Furqat bekati', coordinates: [72.335, 40.792] },
      { id: 's333', name: 'Teatr maydoni', coordinates: [72.348, 40.785] },
      { id: 's334', name: 'Yangi Bozor', coordinates: [72.361, 40.774] }
    ],
    activeVehiclesCount: 5,
    parkedVehiclesCount: 2
  }
}

export function searchLandmarks(query: string) {
  const q = query.toLowerCase().trim()
  if (!q) return ANDIJON_LANDMARKS.slice(0, 5)
  return ANDIJON_LANDMARKS.filter(
    (l) => l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)
  )
}

export function getRouteByNumber(routeNumber: string): RouteOverview | null {
  const clean = routeNumber.replace(/[^0-9]/g, '')
  return ANDIJON_ROUTES[clean] || ANDIJON_ROUTES[routeNumber] || null
}

/**
 * Searches for transit itinerary alternatives between origin and destination.
 * Incorporates:
 * - Fastest
 * - Cheapest
 * - Least Walking
 * - Least Transfers
 * - Walking-only variant
 */
export async function findItineraries(
  origin: Coordinates | string,
  destination: Coordinates | string,
  signal?: AbortSignal
): Promise<Itinerary[]> {
  // Check if caller aborted
  if (signal?.aborted) {
    throw new DOMException('Search aborted', 'AbortError')
  }

  // Simulate network latency if calling mock, or query backend API when available
  await new Promise((resolve) => setTimeout(resolve, 300))

  if (signal?.aborted) {
    throw new DOMException('Search aborted', 'AbortError')
  }

  const now = new Date()
  const depTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  // Construct diverse alternatives
  const itineraries: Itinerary[] = [
    {
      id: 'itn-fastest',
      title: 'Tezkor yo‘nalish',
      mode: 'fastest',
      totalDurationMinutes: 19,
      totalFareSoM: 2000,
      totalWalkingMeters: 380,
      transferCount: 0,
      routeNumbers: ['15'],
      liveVehiclesCount: 4,
      departureTime: depTime,
      arrivalTime: addMinutes(now, 19),
      legs: [
        {
          id: 'l1',
          type: 'walking',
          instruction: 'Eski Shahar bekatiga piyoda boring',
          distanceMeters: 250,
          durationMinutes: 3,
          geometry: [
            [72.340, 40.783],
            [72.342, 40.782]
          ]
        },
        {
          id: 'l2',
          type: 'transit',
          routeNumber: '15',
          directionName: 'Yangi Bozor tomon',
          instruction: '15-sonli marshrutga chiqing',
          distanceMeters: 3200,
          durationMinutes: 14,
          intermediateStopsCount: 4,
          fareSoM: 2000,
          fromStop: { id: 's1', name: 'Eski Shahar', coordinates: [72.342, 40.782] },
          toStop: { id: 's5', name: 'Yangi Bozor', coordinates: [72.361, 40.774] },
          geometry: ANDIJON_ROUTES['15'].geometry
        },
        {
          id: 'l3',
          type: 'walking',
          instruction: 'Manzilgacha piyoda boring',
          distanceMeters: 130,
          durationMinutes: 2,
          geometry: [
            [72.361, 40.774],
            [72.362, 40.773]
          ]
        }
      ]
    },
    {
      id: 'itn-cheapest',
      title: 'Hamyonbop variant',
      mode: 'cheapest',
      totalDurationMinutes: 26,
      totalFareSoM: 2000,
      totalWalkingMeters: 450,
      transferCount: 0,
      routeNumbers: ['33'],
      liveVehiclesCount: 3,
      departureTime: depTime,
      arrivalTime: addMinutes(now, 26),
      legs: [
        {
          id: 'l21',
          type: 'walking',
          instruction: 'Furqat bekatigacha piyoda boring',
          distanceMeters: 300,
          durationMinutes: 4,
          geometry: [
            [72.332, 40.793],
            [72.335, 40.792]
          ]
        },
        {
          id: 'l22',
          type: 'transit',
          routeNumber: '33',
          directionName: 'Yangi Bozor tomon',
          instruction: '33-sonli marshrutga chiqing',
          distanceMeters: 2900,
          durationMinutes: 20,
          intermediateStopsCount: 3,
          fareSoM: 2000,
          fromStop: { id: 's332', name: 'Furqat bekati', coordinates: [72.335, 40.792] },
          toStop: { id: 's334', name: 'Yangi Bozor', coordinates: [72.361, 40.774] },
          geometry: ANDIJON_ROUTES['33'].geometry
        },
        {
          id: 'l23',
          type: 'walking',
          instruction: 'Bozor ichiga piyoda',
          distanceMeters: 150,
          durationMinutes: 2
        }
      ]
    },
    {
      id: 'itn-transfer',
      title: 'Almashish bilan',
      mode: 'least_walking',
      totalDurationMinutes: 24,
      totalFareSoM: 4000,
      totalWalkingMeters: 180,
      transferCount: 1,
      routeNumbers: ['7', '22'],
      liveVehiclesCount: 0, // No online vehicle visible for Route 7
      departureTime: depTime,
      arrivalTime: addMinutes(now, 24),
      legs: [
        {
          id: 'l31',
          type: 'walking',
          instruction: 'Shifoxona bekatiga 80 m',
          distanceMeters: 80,
          durationMinutes: 1
        },
        {
          id: 'l32',
          type: 'transit',
          routeNumber: '7',
          directionName: 'Eski Shahar orqali Vokzal tomon',
          instruction: '7-sonli marshrutga chiqing',
          distanceMeters: 1800,
          durationMinutes: 9,
          intermediateStopsCount: 2,
          fareSoM: 2000,
          fromStop: { id: 's71', name: 'Shifoxona', coordinates: [72.331, 40.768] },
          toStop: { id: 's73', name: 'Eski Shahar', coordinates: [72.342, 40.782] }
        },
        {
          id: 'l33',
          type: 'transfer',
          instruction: 'Eski Shaharda 22-marshrutga almashing',
          distanceMeters: 30,
          durationMinutes: 1
        },
        {
          id: 'l34',
          type: 'transit',
          routeNumber: '22',
          directionName: 'Bobur Bog‘i tomon',
          instruction: '22-sonli marshrutga chiqing',
          distanceMeters: 2200,
          durationMinutes: 11,
          intermediateStopsCount: 3,
          fareSoM: 2000,
          fromStop: { id: 's21', name: 'Eski Shahar', coordinates: [72.342, 40.782] },
          toStop: { id: 's24', name: 'Bobur Bog‘i', coordinates: [72.378, 40.795] }
        },
        {
          id: 'l35',
          type: 'walking',
          instruction: 'Manzilgacha piyoda',
          distanceMeters: 70,
          durationMinutes: 2
        }
      ]
    },
    {
      id: 'itn-walking',
      title: 'Faqat piyoda',
      mode: 'least_transfers',
      totalDurationMinutes: 48,
      totalFareSoM: 0,
      totalWalkingMeters: 3900,
      transferCount: 0,
      routeNumbers: [],
      liveVehiclesCount: 0,
      departureTime: depTime,
      arrivalTime: addMinutes(now, 48),
      legs: [
        {
          id: 'l41',
          type: 'walking',
          instruction: 'To‘g‘ridan-to‘g‘ri piyoda yo‘l (Navoiy shoh ko‘chasi orqali)',
          distanceMeters: 3900,
          durationMinutes: 48,
          geometry: [
            [72.342, 40.782],
            [72.348, 40.781],
            [72.355, 40.777],
            [72.361, 40.774]
          ]
        }
      ]
    }
  ]

  return itineraries
}

function addMinutes(date: Date, minutes: number): string {
  const d = new Date(date.getTime() + minutes * 60000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
