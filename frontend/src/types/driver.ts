// Driver app view models (mapped from backend DTOs in services/api/driverApi.ts).
import type { RouteView } from './client'

export type DirectionType = 'outbound' | 'inbound'

export interface DriverShift {
  id: number
  vehicleId: number
  routeId: number
  direction: DirectionType
  status: 'active' | 'completed' | 'force_ended'
  startedAtMs: number
  endedAtMs: number | null
  lastGpsAtMs: number | null
  endReason: string | null
}

export interface DriverVehicle {
  id: number
  internalId: string
  plateNumber: string | null
  model: string | null
  color: string | null
  vehicleType: string | null
}

export interface DriverMe {
  driverId: number
  userId: number
  fullName: string
  phone: string
  licenseNumber: string | null
  uyushma: { id: number; name: string; phone: string }
  vehicle: DriverVehicle | null
  route: RouteView | null
  fareUzs: number | null
  activeShift: DriverShift | null
  gpsIntervalSeconds: number
  staleThresholdSeconds: number
}

/** One GPS fix as sent to the backend (also the offline queue record). */
export interface GpsPoint {
  idempotency_key: string
  lat: number
  lng: number
  speed_kmh: number
  heading: number
  accuracy_meters: number
  captured_at: string // ISO UTC
}

export interface GpsBatchResult {
  batchId: string
  processed: number
  duplicates: number
  discarded: number
  /** Server clock at the time of the response; used to correct a wrong device clock. */
  serverTimeMs: number | null
}

export interface DriverParking {
  id: number
  name: string
  lat: number
  lng: number
  radiusMeters: number
  vehicleCount: number
  isDriverInside: boolean
}

/** A passenger in "Kutayapman" state on the driver's route (no PII: watch id only). */
export interface WaitingPassenger {
  watchId: string
  routeId: number
  direction: DirectionType
  lat: number
  lng: number
  waitingSinceMs: number
}

// ---------------------------------------------------------------- finance

export type DriverPaymentStatus = 'completed' | 'refunded' | 'failed'
export type PaymentPeriod = 'today' | 'week' | 'month' | 'all'

export interface DriverPayment {
  id: string
  reference: string
  vehicleId: string
  routeId: number
  amountUzs: number
  commissionUzs: number
  netAmountUzs: number
  fareName: string | null
  status: DriverPaymentStatus
  paymentMethod: 'wallet' | 'click' | string
  identificationMethod: 'qr' | 'nfc' | 'manual' | string
  createdAtMs: number
  refundable: boolean
  refundableUntilMs: number | null
  refundWindowMinutes: number
  refundReason: string | null
  refundedAtMs: number | null
  passengerLabel: string
}

export interface DriverBalance {
  vehicleId: string | null
  balance: number
  availableBalance: number
  pendingCashout: number
  todayGross: number
  todayEarnings: number
  totalRefundedToday: number
  ridesCountToday: number
  shiftEarnings: number
}

export type LedgerEntryType =
  | 'topup'
  | 'ride_payment'
  | 'ride_earning'
  | 'refund'
  | 'refund_reversal'
  | 'cashout'
  | 'adjustment'
  | string

export interface LedgerEntry {
  id: number
  entryType: LedgerEntryType
  amountUzs: number
  balanceAfterUzs: number
  referenceType: string | null
  referenceId: string | null
  description: string
  createdAtMs: number
}

export type CashoutStatus = 'pending' | 'approved' | 'rejected' | 'paid'
export type CashoutMethod = 'cash' | 'card' | 'bank'

export interface Cashout {
  id: number
  amountUzs: number
  method: CashoutMethod
  payoutDetails: string | null
  status: CashoutStatus
  createdAtMs: number
  processedAtMs: number | null
  paidAtMs: number | null
  rejectionReason: string | null
  paymentReference: string | null
}
