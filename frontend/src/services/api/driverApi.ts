// Driver API (backend: app/api/v1/driver.py). Typed DTOs + mappers to driver view models.
// The backend scopes every call to the caller's own vehicle/shift; nothing here trusts client ids.
import { apiClient, newIdempotencyKey } from './client'
import { mapRoute, type RouteDto } from './clientApi'
import { parseUtc } from '../../utils/format'
import type {
  Cashout,
  CashoutMethod,
  DirectionType,
  DriverBalance,
  DriverMe,
  DriverParking,
  DriverPayment,
  DriverShift,
  GpsBatchResult,
  GpsPoint,
  LedgerEntry,
  PaymentPeriod,
  WaitingPassenger,
} from '../../types/driver'

// ---------------------------------------------------------------- DTOs

export interface ShiftDto {
  id: number
  driver_id: number
  vehicle_id: number
  route_id: number
  direction: DirectionType
  status: DriverShift['status']
  started_at: string
  ended_at?: string | null
  last_gps_at?: string | null
  end_reason?: string | null
}

interface DriverMeDto {
  driver_id: number
  user_id: number
  full_name: string
  phone: string
  license_number?: string | null
  uyushma: { id: number; name: string; phone: string }
  vehicle?: {
    id: number
    internal_id: string
    plate_number?: string | null
    model?: string | null
    color?: string | null
    vehicle_type?: string | null
  } | null
  route?: RouteDto | null
  fare_uzs?: number | null
  active_shift?: ShiftDto | null
  gps_interval_seconds: number
  stale_threshold_seconds: number
}

interface ParkingStatusDto {
  parking_id: number
  name: string
  lat: number
  lng: number
  radius_meters: number
  vehicle_count: number
  is_driver_inside: boolean
}

export interface WaitingPassengerDto {
  watch_id: number | string
  route_id: number
  direction: DirectionType
  client_lat: number
  client_lng: number
  waiting_since: string | null
}

interface WaitingListDto {
  route_id: number
  total_waiting: number
  passengers: WaitingPassengerDto[]
}

interface BatchResultDto {
  batch_id: string
  processed_count: number
  duplicate_count: number
  discarded_count: number
  server_time?: string
}

export interface DriverPaymentDto {
  id: string
  reference: string
  vehicle_id: string | null
  route_id: number
  amount_uzs: number
  commission_uzs: number
  net_amount_uzs: number
  fare_name?: string | null
  status: DriverPayment['status']
  payment_method: string
  identification_method: string
  created_at: string | null
  refundable: boolean
  refundable_until?: string | null
  refund_window_minutes: number
  refund_reason?: string | null
  refunded_at?: string | null
  passenger_label: string
}

interface BalanceDto {
  vehicle_id?: string | null
  balance: number
  available_balance: number
  pending_cashout: number
  today_gross: number
  today_earnings: number
  total_refunded_today: number
  rides_count_today: number
  shift_earnings: number
}

interface LedgerDto {
  id: number
  entry_type: string
  amount_uzs: number
  balance_after_uzs: number
  reference_type?: string | null
  reference_id?: string | null
  description: string
  created_at: string
}

interface CashoutDto {
  id: number
  amount_uzs: number
  method: CashoutMethod
  payout_details?: string | null
  status: Cashout['status']
  created_at: string
  processed_at?: string | null
  paid_at?: string | null
  rejection_reason?: string | null
  payment_reference?: string | null
}

// ---------------------------------------------------------------- mappers

const msOrNull = (v: string | null | undefined): number | null => (v ? parseUtc(v) : null)

export function mapShift(s: ShiftDto): DriverShift {
  return {
    id: s.id,
    vehicleId: s.vehicle_id,
    routeId: s.route_id,
    direction: s.direction,
    status: s.status,
    startedAtMs: parseUtc(s.started_at),
    endedAtMs: msOrNull(s.ended_at),
    lastGpsAtMs: msOrNull(s.last_gps_at),
    endReason: s.end_reason ?? null,
  }
}

export function mapDriverMe(d: DriverMeDto): DriverMe {
  return {
    driverId: d.driver_id,
    userId: d.user_id,
    fullName: d.full_name,
    phone: d.phone,
    licenseNumber: d.license_number ?? null,
    uyushma: d.uyushma,
    vehicle: d.vehicle
      ? {
          id: d.vehicle.id,
          internalId: d.vehicle.internal_id,
          plateNumber: d.vehicle.plate_number ?? null,
          model: d.vehicle.model ?? null,
          color: d.vehicle.color ?? null,
          vehicleType: d.vehicle.vehicle_type ?? null,
        }
      : null,
    route: d.route ? mapRoute(d.route) : null,
    fareUzs: d.fare_uzs ?? null,
    activeShift: d.active_shift ? mapShift(d.active_shift) : null,
    gpsIntervalSeconds: d.gps_interval_seconds,
    staleThresholdSeconds: d.stale_threshold_seconds,
  }
}

export function mapWaitingPassenger(p: WaitingPassengerDto): WaitingPassenger {
  return {
    watchId: String(p.watch_id),
    routeId: p.route_id,
    direction: p.direction,
    lat: p.client_lat,
    lng: p.client_lng,
    waitingSinceMs: parseUtc(p.waiting_since),
  }
}

export function mapDriverPayment(p: DriverPaymentDto): DriverPayment {
  return {
    id: p.id,
    reference: p.reference,
    vehicleId: p.vehicle_id ?? '',
    routeId: p.route_id,
    amountUzs: p.amount_uzs,
    commissionUzs: p.commission_uzs,
    netAmountUzs: p.net_amount_uzs,
    fareName: p.fare_name ?? null,
    status: p.status,
    paymentMethod: p.payment_method,
    identificationMethod: p.identification_method,
    createdAtMs: parseUtc(p.created_at),
    refundable: p.refundable,
    refundableUntilMs: msOrNull(p.refundable_until),
    refundWindowMinutes: p.refund_window_minutes,
    refundReason: p.refund_reason ?? null,
    refundedAtMs: msOrNull(p.refunded_at),
    passengerLabel: p.passenger_label,
  }
}

function mapBalance(b: BalanceDto): DriverBalance {
  return {
    vehicleId: b.vehicle_id ?? null,
    balance: b.balance,
    availableBalance: b.available_balance,
    pendingCashout: b.pending_cashout,
    todayGross: b.today_gross,
    todayEarnings: b.today_earnings,
    totalRefundedToday: b.total_refunded_today,
    ridesCountToday: b.rides_count_today,
    shiftEarnings: b.shift_earnings,
  }
}

function mapLedger(l: LedgerDto): LedgerEntry {
  return {
    id: l.id,
    entryType: l.entry_type,
    amountUzs: l.amount_uzs,
    balanceAfterUzs: l.balance_after_uzs,
    referenceType: l.reference_type ?? null,
    referenceId: l.reference_id ?? null,
    description: l.description,
    createdAtMs: parseUtc(l.created_at),
  }
}

function mapCashout(c: CashoutDto): Cashout {
  return {
    id: c.id,
    amountUzs: c.amount_uzs,
    method: c.method,
    payoutDetails: c.payout_details ?? null,
    status: c.status,
    createdAtMs: parseUtc(c.created_at),
    processedAtMs: msOrNull(c.processed_at),
    paidAtMs: msOrNull(c.paid_at),
    rejectionReason: c.rejection_reason ?? null,
    paymentReference: c.payment_reference ?? null,
  }
}

// ---------------------------------------------------------------- API

export const driverApi = {
  async me(): Promise<DriverMe> {
    return mapDriverMe(await apiClient.get<DriverMeDto>('/driver/me'))
  },

  async currentShift(): Promise<DriverShift | null> {
    const shift = await apiClient.get<ShiftDto | null>('/driver/shift/current')
    return shift ? mapShift(shift) : null
  },

  async startShift(direction: DirectionType): Promise<DriverShift> {
    return mapShift(await apiClient.post<ShiftDto>('/driver/shift/start', { direction }))
  },

  async endShift(notes?: string): Promise<DriverShift> {
    return mapShift(await apiClient.post<ShiftDto>('/driver/shift/end', notes ? { notes } : undefined))
  },

  async switchDirection(direction: DirectionType): Promise<DriverShift> {
    return mapShift(await apiClient.post<ShiftDto>('/driver/shift/direction', { direction }))
  },

  async sendGps(point: GpsPoint): Promise<{ applied: boolean; duplicate: boolean; serverTimeMs: number | null }> {
    const res = await apiClient.post<{ applied_to_live: boolean; duplicate: boolean; server_time?: string }>(
      '/driver/gps/single',
      point,
      { timeoutMs: 10_000 },
    )
    return {
      applied: res.applied_to_live,
      duplicate: res.duplicate,
      serverTimeMs: res.server_time ? parseUtc(res.server_time) : null,
    }
  },

  /** `shiftId` keeps a backlog attributed to the shift that recorded it, not the active one. */
  async syncGpsBatch(points: GpsPoint[], shiftId?: number, batchId = newIdempotencyKey()): Promise<GpsBatchResult> {
    const res = await apiClient.post<BatchResultDto>(
      '/driver/gps/batch',
      { batch_id: batchId, points, shift_id: shiftId ?? null },
      { timeoutMs: 30_000 },
    )
    return {
      batchId: res.batch_id,
      processed: res.processed_count,
      duplicates: res.duplicate_count,
      discarded: res.discarded_count,
      serverTimeMs: res.server_time ? parseUtc(res.server_time) : null,
    }
  },

  async parkings(): Promise<DriverParking[]> {
    const res = await apiClient.get<ParkingStatusDto[]>('/driver/parkings')
    return res.map((p) => ({
      id: p.parking_id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      radiusMeters: p.radius_meters,
      vehicleCount: p.vehicle_count,
      isDriverInside: p.is_driver_inside,
    }))
  },

  async waitingPassengers(): Promise<WaitingPassenger[]> {
    const res = await apiClient.get<WaitingListDto>('/driver/passengers/waiting')
    return res.passengers.map(mapWaitingPassenger)
  },

  // ---- finance
  async payments(period: PaymentPeriod = 'today', status?: 'completed' | 'refunded'): Promise<DriverPayment[]> {
    const res = await apiClient.get<DriverPaymentDto[]>('/driver/payments', { query: { period, status, limit: 500 } })
    return res.map(mapDriverPayment)
  },

  /** Idempotent server side by payment id: a repeat answers 409 "allaqachon qaytarilgan". */
  async refund(paymentId: string, reason: string): Promise<DriverPayment> {
    return mapDriverPayment(
      await apiClient.post<DriverPaymentDto>(`/driver/payments/${encodeURIComponent(paymentId)}/refund`, {
        reason: reason.trim(),
      }),
    )
  },

  async balance(): Promise<DriverBalance> {
    return mapBalance(await apiClient.get<BalanceDto>('/driver/balance'))
  },

  async ledger(limit = 100): Promise<LedgerEntry[]> {
    return (await apiClient.get<LedgerDto[]>('/driver/ledger', { query: { limit } })).map(mapLedger)
  },

  async cashouts(): Promise<Cashout[]> {
    return (await apiClient.get<CashoutDto[]>('/driver/cashouts')).map(mapCashout)
  },

  /** Reuse `idempotencyKey` when retrying the same request (network errors) to avoid duplicates. */
  async requestCashout(
    data: { amountUzs: number; method: CashoutMethod; payoutDetails?: string },
    idempotencyKey: string,
  ): Promise<Cashout> {
    return mapCashout(
      await apiClient.post<CashoutDto>(
        '/driver/cashouts',
        { amount_uzs: Math.round(data.amountUzs), method: data.method, payout_details: data.payoutDetails?.trim() || null },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    )
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiClient.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword })
  },
}
