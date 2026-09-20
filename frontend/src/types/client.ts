// Types for MashrutGo Client PWA (view models built from backend responses)

export type Coordinates = [number, number] // [lng, lat]

export type OptimizationMode = 'fastest' | 'cheapest' | 'least_walking' | 'least_transfers'

export type LegType = 'walking' | 'transit' | 'transfer'

export interface StopPoint {
  id: string
  name: string
  coordinates: Coordinates
}

export interface ItineraryLeg {
  id: string
  type: LegType
  instruction: string
  routeId?: number
  routeNumber?: string
  directionType?: 'outbound' | 'inbound'
  directionName?: string
  distanceMeters: number
  durationMinutes: number
  geometry?: Coordinates[]
  fromStop?: StopPoint
  toStop?: StopPoint
  intermediateStopsCount?: number
  fareSoM?: number
  fareKnown?: boolean
  liveStatus?: string | null
}

export interface Itinerary {
  id: string
  title: string
  mode: OptimizationMode
  modeTags: OptimizationMode[]
  totalDurationMinutes: number
  totalFareSoM: number
  fareKnown: boolean
  totalWalkingMeters: number
  walkingDurationMinutes: number
  waitMinutes: number
  transferCount: number
  legs: ItineraryLeg[]
  routeNumbers: string[]
  routeIds: number[]
  /** Online vehicles on the transit part; 0 means "no online vehicle visible" (not "no service"). */
  liveVehiclesCount: number
  liveStatus: string
  isWalkingOnly: boolean
  departureTime: string
  arrivalTime: string
}

export interface Place {
  id: string
  name: string
  address: string
  coordinates: Coordinates
  kind: string
  source: 'db' | 'maptiler' | 'gps'
}

export interface RouteStop {
  id: string
  name: string
  coordinates: Coordinates
}

export interface RouteDirectionView {
  id: number
  type: 'outbound' | 'inbound'
  originName: string
  destinationName: string
  geometry: Coordinates[]
  stops: RouteStop[]
  distanceMeters: number
  durationMinutes: number
}

export interface RouteView {
  id: number
  routeNumber: string
  name: string
  uyushmaName: string
  fareSoM: number | null
  onlineVehiclesCount: number
  directions: RouteDirectionView[]
}

export interface RouteListItem {
  id: number
  routeNumber: string
  name: string
  originName: string
  destinationName: string
}

export interface LiveVehicle {
  id: string
  routeId: number
  routeNumber: string
  direction: 'outbound' | 'inbound'
  licensePlate: string | null
  coordinates: Coordinates
  speedKmh: number
  headingDeg: number
  lastUpdatedEpochMs: number
  isStale?: boolean
  parkingId?: number | null
}

export interface EtaInfo {
  hasApproachingVehicle: boolean
  vehicleId: string | null
  plateNumber: string | null
  etaMinutes: number | null
  distanceMeters: number | null
  confidence: number
  status: string
}

export type WatchStatus = 'IDLE' | 'WATCHING' | 'ON_VEHICLE'

export interface ClientWatchSession {
  status: WatchStatus
  watchId?: number
  sessionSecret?: string
  routeId?: number
  routeNumber?: string
  direction?: 'outbound' | 'inbound'
  startedAtEpochMs?: number
  lastGps?: Coordinates
}

export type WalletEntryType =
  | 'topup'
  | 'ride_payment'
  | 'ride_earning'
  | 'refund'
  | 'refund_reversal'
  | 'cashout'
  | 'adjustment'

export interface WalletTransaction {
  id: number
  type: WalletEntryType
  amountSoM: number
  balanceAfterSoM: number
  description: string
  createdAtEpochMs: number
  referenceId?: string | null
}

export interface TopupOrder {
  id: number
  merchantTransId: string
  amountSoM: number
  status: 'created' | 'prepared' | 'completed' | 'cancelled' | 'failed'
  checkoutUrl: string | null
  isSandbox: boolean
  errorNote?: string | null
}

export interface PaymentConfig {
  clickConfigured: boolean
  sandboxEnabled: boolean
  minTopupSoM: number
  maxTopupSoM: number
  maintenanceMode: boolean
}

export interface ResolvedVehicle {
  vehicleId: string
  licensePlate: string | null
  model?: string | null
  routeId: number
  routeNumber: string
  routeName: string
  uyushmaName: string
  fareSoM: number
  fareRuleName: string
  driverName?: string
  isOnShift: boolean
}

export interface PaymentReceipt {
  paymentId: string
  reference: string
  vehicle: ResolvedVehicle
  paidAmountSoM: number
  paymentMethod: 'wallet' | 'click'
  identificationMethod: 'qr' | 'nfc' | 'manual'
  paidAtEpochMs: number
  status: 'completed' | 'refunded' | 'failed'
  balanceAfterSoM?: number | null
  refundReason?: string | null
}
