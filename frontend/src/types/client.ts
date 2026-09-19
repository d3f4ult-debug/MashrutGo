// Types for MashrutGo Client PWA

export type Coordinates = [number, number] // [lng, lat]

export type OptimizationMode = 'fastest' | 'cheapest' | 'least_walking' | 'least_transfers'

export type LegType = 'walking' | 'transit' | 'transfer'

export interface StopPoint {
  id: string
  name: string
  coordinates: Coordinates
  departureTime?: string
  arrivalTime?: string
}

export interface ItineraryLeg {
  id: string
  type: LegType
  instruction: string
  routeNumber?: string
  directionName?: string
  distanceMeters: number
  durationMinutes: number
  geometry?: Coordinates[]
  fromStop?: StopPoint
  toStop?: StopPoint
  intermediateStopsCount?: number
  fareSoM?: number
}

export interface Itinerary {
  id: string
  title: string
  mode: OptimizationMode
  totalDurationMinutes: number
  totalFareSoM: number
  totalWalkingMeters: number
  transferCount: number
  legs: ItineraryLeg[]
  routeNumbers: string[]
  liveVehiclesCount: number // 0 means no online vehicles visible
  departureTime: string
  arrivalTime: string
}

export interface LiveVehicle {
  id: string
  routeNumber: string
  licensePlate: string
  coordinates: Coordinates
  speedKmh: number
  headingDeg: number
  lastUpdatedEpochMs: number
  isStale?: boolean
  etaMinutesToNextStop?: number | null
}

export type WatchStatus = 'IDLE' | 'WATCHING' | 'ON_VEHICLE' | 'COMPLETED'

export interface ClientWatchSession {
  status: WatchStatus
  routeNumber?: string
  directionId?: string
  targetStopId?: string
  startedAtEpochMs?: number
  lastGps?: Coordinates
}

export interface WalletTransaction {
  id: string
  type: 'topup' | 'ride_payment' | 'refund'
  amountSoM: number
  description: string
  createdAtEpochMs: number
  status: 'pending' | 'success' | 'failed'
  referenceId?: string
}

export interface ResolvedVehicle {
  vehicleId: string
  licensePlate: string
  routeNumber: string
  uyushmaName: string
  fareSoM: number
  driverName?: string
}

export interface PaymentReceipt {
  paymentId: string
  vehicle: ResolvedVehicle
  paidAmountSoM: number
  paymentMethod: 'wallet' | 'click'
  paidAtEpochMs: number
  status: 'success' | 'failed'
}
