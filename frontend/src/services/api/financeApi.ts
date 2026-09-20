// Uyushma finance API (tenant-scoped on the backend): payments & refunds, period summary and
// driver cash-out approvals. Maps backend DTOs -> UI view models. Nothing is fabricated: every failure
// surfaces as an ApiError (with the backend `detail`) or a validation Error.
import { apiClient, type Query } from './client'
import type {
  CashoutMethod,
  CashoutRequest,
  CashoutStatus,
  FinancePaymentMethod,
  FinancePaymentStatus,
  FinancePeriod,
  FinanceSummary,
  IdentificationMethod,
  Paginated,
  PaymentFilters,
  UyushmaPayment,
} from '../../types/finance'

// ---------------------------------------------------------------- DTOs (backend/app/schemas/finance.py)

export interface UyushmaPaymentDto {
  id: string
  reference: string
  uyushma_id: number
  route_id: number
  route_number: string
  vehicle_id: number
  vehicle_internal_id: string
  vehicle_plate?: string | null
  driver_id: number
  driver_name: string
  amount_uzs: number
  commission_uzs: number
  net_amount_uzs: number
  status: FinancePaymentStatus
  payment_method: FinancePaymentMethod
  identification_method: IdentificationMethod
  created_at: string
  refund_reason?: string | null
  refunded_at?: string | null
  passenger_label: string
}

export interface CashoutDto {
  id: number
  driver_id: number
  driver_name: string
  driver_phone: string
  uyushma_id: number
  vehicle_id?: number | null
  vehicle_internal_id?: string | null
  vehicle_plate?: string | null
  amount_uzs: number
  method: CashoutMethod
  payout_details?: string | null
  status: CashoutStatus
  created_at: string
  processed_at?: string | null
  paid_at?: string | null
  processed_by?: string | null
  rejection_reason?: string | null
  payment_reference?: string | null
}

export type FinanceSummaryDto = FinanceSummary

interface PaginatedDto<T> {
  items: T[]
  total: number
  page: number
  size: number
  pages: number
}

// ---------------------------------------------------------------- constants & labels

export const PAYMENTS_MAX_PAGE_SIZE = 200
export const PAYMENTS_SEARCH_MAX_LENGTH = 50
export const REJECT_REASON_MIN_LENGTH = 3
export const REJECT_REASON_MAX_LENGTH = 255
export const PAYMENT_REFERENCE_MIN_LENGTH = 2
export const PAYMENT_REFERENCE_MAX_LENGTH = 100

/** Backend day boundaries are Asia/Tashkent (UTC+5, no DST). */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const PAYMENT_METHOD_LABELS: Record<FinancePaymentMethod, string> = {
  wallet: 'Hamyon',
  click: 'Click',
}

export const IDENTIFICATION_METHOD_LABELS: Record<IdentificationMethod, string> = {
  qr: 'QR kod',
  nfc: 'NFC',
  manual: 'Qo‘lda kiritilgan',
}

export const PAYMENT_STATUS_LABELS: Record<FinancePaymentStatus, string> = {
  completed: 'Muvaffaqiyatli',
  refunded: 'Qaytarilgan',
  failed: 'Muvaffaqiyatsiz',
}

export const CASHOUT_STATUS_LABELS: Record<CashoutStatus, string> = {
  pending: 'Kutilmoqda',
  approved: 'Tasdiqlangan',
  paid: 'To‘langan',
  rejected: 'Rad etilgan',
}

export const CASHOUT_METHOD_LABELS: Record<CashoutMethod, string> = {
  cash: 'Naqd (kassa)',
  card: 'Bank kartasi',
  bank: 'Bank hisob raqami',
}

export const FINANCE_PERIOD_LABELS: Record<FinancePeriod, string> = {
  today: 'Bugun',
  '7d': '7 kun',
  '30d': '30 kun',
  all: 'Barcha davr',
}

/** Label for any backend value, including ones added after this build. */
export function labelOf<K extends string>(labels: Record<K, string>, value: string | null | undefined): string {
  if (!value) return '—'
  return (labels as Record<string, string>)[value] ?? value
}

// ---------------------------------------------------------------- cash-out lifecycle

export function canApproveCashout(status: CashoutStatus): boolean {
  return status === 'pending'
}

export function canRejectCashout(status: CashoutStatus): boolean {
  return status === 'pending' || status === 'approved'
}

export function canMarkCashoutPaid(status: CashoutStatus): boolean {
  return status === 'approved'
}

// ---------------------------------------------------------------- mappers

const optStr = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v))

function requireScope(uyushmaId: string): string {
  if (!uyushmaId) throw new Error('Uyushma tanlanmagan')
  return uyushmaId
}

export function mapUyushmaPayment(p: UyushmaPaymentDto): UyushmaPayment {
  return {
    id: p.id,
    reference: p.reference,
    uyushma_id: String(p.uyushma_id),
    route_id: String(p.route_id),
    route_number: p.route_number,
    vehicle_id: String(p.vehicle_id),
    vehicle_internal_id: p.vehicle_internal_id,
    vehicle_plate: p.vehicle_plate ?? null,
    driver_id: String(p.driver_id),
    driver_name: p.driver_name,
    amount_uzs: p.amount_uzs,
    commission_uzs: p.commission_uzs,
    net_amount_uzs: p.net_amount_uzs,
    status: p.status,
    payment_method: p.payment_method,
    identification_method: p.identification_method,
    created_at: p.created_at,
    refund_reason: p.refund_reason ?? null,
    refunded_at: p.refunded_at ?? null,
    passenger_label: p.passenger_label,
  }
}

export function mapCashout(c: CashoutDto): CashoutRequest {
  return {
    id: String(c.id),
    driver_id: String(c.driver_id),
    driver_name: c.driver_name,
    driver_phone: c.driver_phone,
    uyushma_id: String(c.uyushma_id),
    vehicle_id: optStr(c.vehicle_id),
    vehicle_internal_id: c.vehicle_internal_id ?? null,
    vehicle_plate: c.vehicle_plate ?? null,
    amount_uzs: c.amount_uzs,
    method: c.method,
    payout_details: c.payout_details ?? null,
    status: c.status,
    created_at: c.created_at,
    processed_at: c.processed_at ?? null,
    paid_at: c.paid_at ?? null,
    processed_by: c.processed_by ?? null,
    rejection_reason: c.rejection_reason ?? null,
    payment_reference: c.payment_reference ?? null,
  }
}

/** Query string for GET /uyushma/{id}/payments (empty values are dropped by the client). */
export function buildPaymentQuery(filters: PaymentFilters = {}): Query {
  const search = filters.search?.trim().slice(0, PAYMENTS_SEARCH_MAX_LENGTH)
  const size = filters.size ? Math.min(Math.max(1, Math.floor(filters.size)), PAYMENTS_MAX_PAGE_SIZE) : undefined
  return {
    route_id: filters.routeId || undefined,
    status: filters.status || undefined,
    method: filters.method || undefined,
    search: search || undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
    page: filters.page && filters.page > 0 ? Math.floor(filters.page) : undefined,
    size,
  }
}

/** Start of the calendar day in Asia/Tashkent that contains `nowMs`, as epoch ms. */
export function tashkentDayStart(nowMs: number): number {
  const local = nowMs + TASHKENT_OFFSET_MS
  return local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - TASHKENT_OFFSET_MS
}

/**
 * `date_from` (ISO, UTC) for a period preset; calendar days in Asia/Tashkent like the backend KPIs.
 * "7d" = today and the 6 previous days. `all` => no lower bound.
 */
export function periodStartIso(period: FinancePeriod, nowMs: number = Date.now()): string | undefined {
  const today = tashkentDayStart(nowMs)
  switch (period) {
    case 'today':
      return new Date(today).toISOString()
    case '7d':
      return new Date(today - 6 * DAY_MS).toISOString()
    case '30d':
      return new Date(today - 29 * DAY_MS).toISOString()
    default:
      return undefined
  }
}

// ---------------------------------------------------------------- validation (mirrors the backend)

export function validateRejectReason(reason: string): string | null {
  const v = reason.trim()
  if (v.length < REJECT_REASON_MIN_LENGTH) return `Rad etish sababi kamida ${REJECT_REASON_MIN_LENGTH} ta belgidan iborat bo‘lishi kerak`
  if (v.length > REJECT_REASON_MAX_LENGTH) return `Rad etish sababi ${REJECT_REASON_MAX_LENGTH} ta belgidan oshmasligi kerak`
  return null
}

export function validatePaymentReference(reference: string): string | null {
  const v = reference.trim()
  if (v.length < PAYMENT_REFERENCE_MIN_LENGTH) return `To‘lov cheki / tranzaksiya raqami kamida ${PAYMENT_REFERENCE_MIN_LENGTH} ta belgidan iborat bo‘lishi kerak`
  if (v.length > PAYMENT_REFERENCE_MAX_LENGTH) return `To‘lov cheki / tranzaksiya raqami ${PAYMENT_REFERENCE_MAX_LENGTH} ta belgidan oshmasligi kerak`
  return null
}

// ---------------------------------------------------------------- API

const base = (uyushmaId: string) => `/uyushma/${encodeURIComponent(requireScope(uyushmaId))}`
const cashoutPath = (uyushmaId: string, cashoutId: string, action: string) =>
  `${base(uyushmaId)}/cashouts/${encodeURIComponent(cashoutId)}/${action}`

export const financeApi = {
  /** Server-side filtered & paginated payments (refunded ones included), newest first. */
  async getPayments(uyushmaId: string, filters: PaymentFilters = {}, signal?: AbortSignal): Promise<Paginated<UyushmaPayment>> {
    const dto = await apiClient.get<PaginatedDto<UyushmaPaymentDto>>(`${base(uyushmaId)}/payments`, {
      query: buildPaymentQuery(filters),
      signal,
    })
    return { items: dto.items.map(mapUyushmaPayment), total: dto.total, page: dto.page, size: dto.size, pages: dto.pages }
  },

  /** Revenue / refund / commission totals since `dateFrom` (all time when omitted). */
  async getFinanceSummary(uyushmaId: string, dateFrom?: string, signal?: AbortSignal): Promise<FinanceSummary> {
    return apiClient.get<FinanceSummaryDto>(`${base(uyushmaId)}/finance/summary`, { query: { date_from: dateFrom }, signal })
  },

  /** Driver cash-out requests, newest first (backend caps the list at 500). */
  async getCashouts(uyushmaId: string, status?: CashoutStatus, signal?: AbortSignal): Promise<CashoutRequest[]> {
    const list = await apiClient.get<CashoutDto[]>(`${base(uyushmaId)}/cashouts`, { query: { status }, signal })
    return list.map(mapCashout)
  },

  /** pending → approved. Does not touch the driver's balance yet. */
  async approveCashout(uyushmaId: string, cashoutId: string): Promise<CashoutRequest> {
    return mapCashout(await apiClient.post<CashoutDto>(cashoutPath(uyushmaId, cashoutId, 'approve')))
  },

  /** pending | approved → rejected, with a mandatory audit reason. */
  async rejectCashout(uyushmaId: string, cashoutId: string, reason: string): Promise<CashoutRequest> {
    const invalid = validateRejectReason(reason)
    if (invalid) throw new Error(invalid)
    return mapCashout(await apiClient.post<CashoutDto>(cashoutPath(uyushmaId, cashoutId, 'reject'), { reason: reason.trim() }))
  },

  /** approved → paid. The backend debits the driver's ledger exactly once, at this step. */
  async markCashoutPaid(uyushmaId: string, cashoutId: string, paymentReference: string): Promise<CashoutRequest> {
    const invalid = validatePaymentReference(paymentReference)
    if (invalid) throw new Error(invalid)
    return mapCashout(
      await apiClient.post<CashoutDto>(cashoutPath(uyushmaId, cashoutId, 'mark-paid'), {
        payment_reference: paymentReference.trim(),
      }),
    )
  },
}
