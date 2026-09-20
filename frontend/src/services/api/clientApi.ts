// Client (passenger) API: routing, places, routes, live vehicles, ETA, wallet, payments.
// Thin typed wrappers + mappers from backend DTOs to UI view models. No mock data.
import { apiClient, newIdempotencyKey } from './client'
import { parseUtc } from '../../utils/format'
import type {
  Coordinates,
  EtaInfo,
  Itinerary,
  ItineraryLeg,
  LiveVehicle,
  OptimizationMode,
  PaymentConfig,
  PaymentReceipt,
  Place,
  ResolvedVehicle,
  RouteDirectionView,
  RouteListItem,
  RouteView,
  TopupOrder,
  WalletTransaction,
} from '../../types/client'

// ---------------------------------------------------------------- backend DTOs

interface CoordDto {
  lat: number
  lng: number
  name?: string | null
}

interface LegDto {
  leg_type: 'walking' | 'transit'
  route_id?: number | null
  route_number?: string | null
  route_name?: string | null
  direction_type?: 'outbound' | 'inbound' | null
  origin_name: string
  origin_coord: CoordDto
  destination_name: string
  destination_coord: CoordDto
  distance_meters: number
  duration_minutes: number
  fare_uzs: number
  fare_known?: boolean
  stops_count?: number | null
  polyline?: string | null
  live_status?: string | null
}

interface ItineraryDto {
  id: string
  mode_classification: string
  mode_tags: string[]
  total_duration_minutes: number
  total_distance_meters: number
  walking_distance_meters: number
  walking_duration_minutes: number
  transit_duration_minutes: number
  wait_duration_minutes: number
  transfers_count: number
  total_fare_uzs: number
  fare_known?: boolean
  online_vehicles_count?: number
  live_status: string
  live_confidence: number
  legs: LegDto[]
}

interface SearchResponseDto {
  recommended: Record<string, ItineraryDto>
  itineraries: ItineraryDto[]
}

interface WaypointDto {
  id: number
  order: number
  name?: string | null
  lat: number
  lng: number
  is_stop: boolean
}

interface DirectionDto {
  id: number
  direction_type: 'outbound' | 'inbound'
  origin_name: string
  destination_name: string
  origin_lat: number
  origin_lng: number
  destination_lat: number
  destination_lng: number
  polyline?: string | null
  distance_meters: number
  duration_seconds: number
  waypoints: WaypointDto[]
}

export interface RouteDto {
  id: number
  uyushma_id: number
  route_number: string
  name: string
  description?: string | null
  is_published: boolean
  directions: DirectionDto[]
  uyushma_name?: string
  fare_uzs?: number | null
  online_vehicles_count?: number
}

export interface LiveVehicleDto {
  vehicle_id: string
  plate_number?: string | null
  route_id: number
  route_number: string
  direction: 'outbound' | 'inbound'
  lat: number
  lng: number
  speed_kmh: number
  heading: number
  captured_at: string
  is_stale: boolean
  parking_id?: number | null
}

interface EtaDto {
  has_approaching_vehicle: boolean
  approaching_vehicle_id?: string | null
  plate_number?: string | null
  eta_minutes?: number | null
  distance_meters?: number | null
  confidence: number
  status: string
}

interface PlaceDto {
  id: string
  name: string
  lat: number
  lng: number
  address: string
  kind: string
  source: 'db' | 'maptiler'
}

interface LedgerDto {
  id: number
  entry_type: WalletTransaction['type']
  amount_uzs: number
  balance_after_uzs: number
  reference_id?: string | null
  description: string
  created_at: string
}

interface TopupDto {
  id: number
  merchant_trans_id: string
  amount_uzs: number
  status: TopupOrder['status']
  checkout_url?: string | null
  is_sandbox: boolean
  error_note?: string | null
}

interface ResolvedDto {
  vehicle_id: string
  plate_number?: string | null
  model?: string | null
  route_id: number
  route_number: string
  route_name: string
  uyushma_name: string
  driver_name: string
  fare_uzs: number
  fare_rule_name: string
  is_on_shift: boolean
}

interface PaymentDto {
  payment_id: string
  reference: string
  status: PaymentReceipt['status']
  amount_uzs: number
  payment_method: 'wallet' | 'click'
  identification_method: 'qr' | 'nfc' | 'manual'
  paid_at: string
  vehicle: ResolvedDto
  balance_after_uzs?: number | null
  refund_reason?: string | null
}

// ---------------------------------------------------------------- helpers

export { parseUtc }

function parseLine(polyline?: string | null): Coordinates[] | undefined {
  if (!polyline) return undefined
  try {
    const geo = JSON.parse(polyline) as { type?: string; coordinates?: [number, number][] }
    if (geo.type === 'LineString' && Array.isArray(geo.coordinates) && geo.coordinates.length >= 2) {
      return geo.coordinates.map(([lng, lat]) => [lng, lat] as Coordinates)
    }
  } catch {
    // invalid geometry is ignored (the leg is still listed)
  }
  return undefined
}

function clock(date: Date): string {
  return date.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
}

const MODE_TITLES: Record<OptimizationMode, string> = {
  fastest: 'Tezkor yo‘nalish',
  cheapest: 'Hamyonbop variant',
  least_walking: 'Kam piyoda',
  least_transfers: 'Kam almashish',
}

const MODES: OptimizationMode[] = ['fastest', 'cheapest', 'least_walking', 'least_transfers']

function mapLeg(leg: LegDto, idx: number): ItineraryLeg {
  const from = { id: `${idx}-from`, name: leg.origin_name, coordinates: [leg.origin_coord.lng, leg.origin_coord.lat] as Coordinates }
  const to = { id: `${idx}-to`, name: leg.destination_name, coordinates: [leg.destination_coord.lng, leg.destination_coord.lat] as Coordinates }
  const geometry = parseLine(leg.polyline) ?? [from.coordinates, to.coordinates]
  if (leg.leg_type === 'transit') {
    return {
      id: `leg-${idx}`,
      type: 'transit',
      instruction: `${leg.route_number}-yo‘nalishga chiqing (${leg.destination_name} tomon)`,
      routeId: leg.route_id ?? undefined,
      routeNumber: leg.route_number ?? undefined,
      directionType: leg.direction_type ?? undefined,
      directionName: leg.route_name ?? undefined,
      distanceMeters: leg.distance_meters,
      durationMinutes: leg.duration_minutes,
      geometry,
      fromStop: from,
      toStop: to,
      intermediateStopsCount: leg.stops_count ?? undefined,
      fareSoM: leg.fare_uzs,
      fareKnown: leg.fare_known ?? true,
      liveStatus: leg.live_status,
    }
  }
  return {
    id: `leg-${idx}`,
    type: 'walking',
    instruction: `${leg.destination_name}gacha piyoda`,
    distanceMeters: leg.distance_meters,
    durationMinutes: leg.duration_minutes,
    geometry,
    fromStop: from,
    toStop: to,
  }
}

export function mapItinerary(dto: ItineraryDto, now = new Date()): Itinerary {
  const legs = dto.legs.map(mapLeg)
  const transit = legs.filter((l) => l.type === 'transit')
  const mode = (MODES.includes(dto.mode_classification as OptimizationMode) ? dto.mode_classification : 'fastest') as OptimizationMode
  const tags = dto.mode_tags.filter((t): t is OptimizationMode => MODES.includes(t as OptimizationMode))
  const isWalkingOnly = transit.length === 0
  return {
    id: dto.id,
    title: isWalkingOnly ? 'Faqat piyoda' : dto.transfers_count > 0 ? 'Almashish bilan' : MODE_TITLES[mode],
    mode,
    modeTags: tags,
    totalDurationMinutes: dto.total_duration_minutes,
    totalFareSoM: dto.total_fare_uzs,
    fareKnown: dto.fare_known ?? true,
    totalWalkingMeters: dto.walking_distance_meters,
    walkingDurationMinutes: dto.walking_duration_minutes,
    waitMinutes: dto.wait_duration_minutes,
    transferCount: dto.transfers_count,
    legs,
    routeNumbers: transit.map((l) => l.routeNumber ?? ''),
    routeIds: transit.map((l) => l.routeId ?? 0).filter(Boolean),
    liveVehiclesCount: dto.online_vehicles_count ?? 0,
    liveStatus: dto.live_status,
    isWalkingOnly,
    departureTime: clock(now),
    arrivalTime: clock(new Date(now.getTime() + dto.total_duration_minutes * 60_000)),
  }
}

function mapDirection(d: DirectionDto): RouteDirectionView {
  const stops = [
    { id: `${d.id}-A`, name: d.origin_name, coordinates: [d.origin_lng, d.origin_lat] as Coordinates },
    ...d.waypoints
      .filter((w) => w.is_stop)
      .sort((a, b) => a.order - b.order)
      .map((w) => ({ id: String(w.id), name: w.name || `Bekat ${w.order}`, coordinates: [w.lng, w.lat] as Coordinates })),
    { id: `${d.id}-B`, name: d.destination_name, coordinates: [d.destination_lng, d.destination_lat] as Coordinates },
  ]
  return {
    id: d.id,
    type: d.direction_type,
    originName: d.origin_name,
    destinationName: d.destination_name,
    geometry: parseLine(d.polyline) ?? stops.map((s) => s.coordinates),
    stops,
    distanceMeters: d.distance_meters,
    durationMinutes: Math.round(d.duration_seconds / 60),
  }
}

export function mapRoute(dto: RouteDto): RouteView {
  return {
    id: dto.id,
    routeNumber: dto.route_number,
    name: dto.name,
    uyushmaName: dto.uyushma_name ?? '',
    fareSoM: dto.fare_uzs ?? null,
    onlineVehiclesCount: dto.online_vehicles_count ?? 0,
    directions: [...dto.directions]
      .sort((a, b) => (a.direction_type === b.direction_type ? 0 : a.direction_type === 'outbound' ? -1 : 1))
      .map(mapDirection),
  }
}

export function mapLiveVehicle(v: LiveVehicleDto): LiveVehicle {
  return {
    id: v.vehicle_id,
    routeId: v.route_id,
    routeNumber: v.route_number,
    direction: v.direction,
    licensePlate: v.plate_number ?? null,
    coordinates: [v.lng, v.lat],
    speedKmh: Math.round(v.speed_kmh),
    headingDeg: v.heading,
    lastUpdatedEpochMs: parseUtc(v.captured_at),
    isStale: v.is_stale,
    parkingId: v.parking_id ?? null,
  }
}

function mapResolved(v: ResolvedDto): ResolvedVehicle {
  return {
    vehicleId: v.vehicle_id,
    licensePlate: v.plate_number ?? null,
    model: v.model,
    routeId: v.route_id,
    routeNumber: v.route_number,
    routeName: v.route_name,
    uyushmaName: v.uyushma_name,
    fareSoM: v.fare_uzs,
    fareRuleName: v.fare_rule_name,
    driverName: v.driver_name,
    isOnShift: v.is_on_shift,
  }
}

function mapPayment(p: PaymentDto): PaymentReceipt {
  return {
    paymentId: p.payment_id,
    reference: p.reference,
    vehicle: mapResolved(p.vehicle),
    paidAmountSoM: p.amount_uzs,
    paymentMethod: p.payment_method,
    identificationMethod: p.identification_method,
    paidAtEpochMs: parseUtc(p.paid_at),
    status: p.status,
    balanceAfterSoM: p.balance_after_uzs,
    refundReason: p.refund_reason,
  }
}

function mapTopup(t: TopupDto): TopupOrder {
  return {
    id: t.id,
    merchantTransId: t.merchant_trans_id,
    amountSoM: t.amount_uzs,
    status: t.status,
    checkoutUrl: t.checkout_url ?? null,
    isSandbox: t.is_sandbox,
    errorNote: t.error_note,
  }
}

// ---------------------------------------------------------------- API

export interface SearchPoint {
  name: string
  coordinates: Coordinates
}

export const clientApi = {
  async searchItineraries(origin: SearchPoint, destination: SearchPoint, mode: OptimizationMode, signal?: AbortSignal) {
    const res = await apiClient.post<SearchResponseDto>(
      '/routing/search',
      {
        origin: { lat: origin.coordinates[1], lng: origin.coordinates[0], name: origin.name },
        destination: { lat: destination.coordinates[1], lng: destination.coordinates[0], name: destination.name },
        preferences: { mode },
      },
      { signal, anonymous: true },
    )
    const now = new Date()
    return res.itineraries.map((i) => mapItinerary(i, now))
  },

  async searchPlaces(query: string, near?: Coordinates, signal?: AbortSignal): Promise<Place[]> {
    if (query.trim().length < 2) return []
    const res = await apiClient.get<PlaceDto[]>('/geo/search', {
      query: { q: query.trim(), lat: near?.[1], lng: near?.[0], limit: 8 },
      signal,
      anonymous: true,
    })
    return res.map((p) => ({ id: p.id, name: p.name, address: p.address, coordinates: [p.lng, p.lat], kind: p.kind, source: p.source }))
  },

  async listRoutes(search?: string): Promise<RouteListItem[]> {
    const res = await apiClient.get<RouteDto[]>('/routes', { query: { search, limit: 100 }, anonymous: true })
    return res.map((r) => {
      const out = r.directions.find((d) => d.direction_type === 'outbound') ?? r.directions[0]
      return {
        id: r.id,
        routeNumber: r.route_number,
        name: r.name,
        originName: out?.origin_name ?? '',
        destinationName: out?.destination_name ?? '',
      }
    })
  },

  async getRoute(routeId: number): Promise<RouteView> {
    return mapRoute(await apiClient.get<RouteDto>(`/routes/${routeId}`, { anonymous: true }))
  },

  async liveVehicles(routeId: number): Promise<LiveVehicle[]> {
    const res = await apiClient.get<LiveVehicleDto[]>('/driver/vehicles/live', { query: { route_id: routeId }, anonymous: true })
    return res.map(mapLiveVehicle)
  },

  async eta(routeId: number, direction: 'outbound' | 'inbound', stop: Coordinates, stopName?: string): Promise<EtaInfo> {
    const res = await apiClient.get<EtaDto>('/routing/eta', {
      query: { route_id: routeId, direction, stop_lat: stop[1], stop_lng: stop[0], stop_name: stopName },
      anonymous: true,
    })
    return {
      hasApproachingVehicle: res.has_approaching_vehicle,
      vehicleId: res.approaching_vehicle_id ?? null,
      plateNumber: res.plate_number ?? null,
      etaMinutes: res.eta_minutes ?? null,
      distanceMeters: res.distance_meters ?? null,
      confidence: res.confidence,
      status: res.status,
    }
  },

  // ---- wallet
  async walletBalance(): Promise<number> {
    return (await apiClient.get<{ balance_uzs: number }>('/wallet/balance')).balance_uzs
  },

  async walletTransactions(beforeId?: number): Promise<WalletTransaction[]> {
    const res = await apiClient.get<LedgerDto[]>('/wallet/transactions', { query: { limit: 50, before_id: beforeId } })
    return res.map((t) => ({
      id: t.id,
      type: t.entry_type,
      amountSoM: t.amount_uzs,
      balanceAfterSoM: t.balance_after_uzs,
      description: t.description,
      createdAtEpochMs: parseUtc(t.created_at),
      referenceId: t.reference_id,
    }))
  },

  async paymentConfig(): Promise<PaymentConfig> {
    const res = await apiClient.get<{
      click_configured: boolean
      sandbox_enabled: boolean
      min_topup_uzs: number
      max_topup_uzs: number
      maintenance_mode: boolean
    }>('/wallet/config', { anonymous: true })
    return {
      clickConfigured: res.click_configured,
      sandboxEnabled: res.sandbox_enabled,
      minTopupSoM: res.min_topup_uzs,
      maxTopupSoM: res.max_topup_uzs,
      maintenanceMode: res.maintenance_mode,
    }
  },

  async createTopup(amount: number): Promise<TopupOrder> {
    return mapTopup(await apiClient.post<TopupDto>('/wallet/topup', { amount_uzs: amount, provider: 'click' }))
  },

  async getTopup(id: number): Promise<TopupOrder> {
    return mapTopup(await apiClient.get<TopupDto>(`/wallet/topup/${id}`))
  },

  async completeSandboxTopup(id: number): Promise<TopupOrder> {
    return mapTopup(await apiClient.post<TopupDto>(`/wallet/topup/${id}/sandbox-complete`))
  },

  // ---- transport payment
  async resolveVehicle(identifier: string, method: 'qr' | 'nfc' | 'manual'): Promise<ResolvedVehicle> {
    return mapResolved(await apiClient.post<ResolvedDto>('/payments/resolve-vehicle', { identifier, method }, { anonymous: true }))
  },

  /** `idempotencyKey` must be reused when retrying the same purchase. */
  async payFare(identifier: string, method: 'qr' | 'nfc' | 'manual', idempotencyKey = newIdempotencyKey()): Promise<PaymentReceipt> {
    return mapPayment(
      await apiClient.post<PaymentDto>('/payments/pay', { identifier, method }, { headers: { 'Idempotency-Key': idempotencyKey } }),
    )
  },

  async myPayments(): Promise<PaymentReceipt[]> {
    return (await apiClient.get<PaymentDto[]>('/payments/my')).map(mapPayment)
  },
}
