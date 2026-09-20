// ── Uyushma finance view models (mapped from backend DTOs in services/api/financeApi.ts) ──
// Self-contained on purpose: do not import from ./payment (client wallet types).

/** Backend `Payment.status` values exposed to the Uyushma. */
export type FinancePaymentStatus = 'completed' | 'refunded' | 'failed'

/** How the passenger paid. Only the wallet and Click exist on the backend. */
export type FinancePaymentMethod = 'wallet' | 'click'

/** How the vehicle was identified when paying (not a payment method). */
export type IdentificationMethod = 'qr' | 'nfc' | 'manual'

export interface UyushmaPayment {
  id: string
  reference: string
  uyushma_id: string
  route_id: string
  route_number: string
  /** vehicle database id */
  vehicle_id: string
  /** internal id printed on the QR sticker */
  vehicle_internal_id: string
  vehicle_plate: string | null
  driver_id: string
  driver_name: string
  amount_uzs: number
  commission_uzs: number
  net_amount_uzs: number
  status: FinancePaymentStatus
  payment_method: FinancePaymentMethod
  identification_method: IdentificationMethod
  created_at: string
  refund_reason: string | null
  refunded_at: string | null
  /** pseudonymous passenger label (no PII), e.g. "Mijoz #0007" */
  passenger_label: string
}

export interface PaymentFilters {
  routeId?: string
  status?: FinancePaymentStatus
  method?: FinancePaymentMethod
  /** reference, plate, internal id or driver name (max 50 chars on the backend) */
  search?: string
  /** ISO timestamp (inclusive) */
  dateFrom?: string
  /** ISO timestamp (inclusive) */
  dateTo?: string
  page?: number
  /** 1..200 */
  size?: number
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  size: number
  pages: number
}

/** Lifecycle: pending → approved → paid; pending | approved → rejected. */
export type CashoutStatus = 'pending' | 'approved' | 'rejected' | 'paid'

export type CashoutMethod = 'cash' | 'card' | 'bank'

export interface CashoutRequest {
  id: string
  driver_id: string
  driver_name: string
  driver_phone: string
  uyushma_id: string
  vehicle_id: string | null
  vehicle_internal_id: string | null
  vehicle_plate: string | null
  amount_uzs: number
  method: CashoutMethod
  payout_details: string | null
  status: CashoutStatus
  created_at: string
  /** approval / rejection time */
  processed_at: string | null
  paid_at: string | null
  /** full name of the operator who approved/rejected/paid */
  processed_by: string | null
  rejection_reason: string | null
  payment_reference: string | null
}

export interface FinanceSummary {
  /** every payment in the period, refunded ones included */
  gross_revenue: number
  total_refunds: number
  platform_commission: number
  /** gross − refunds − commission */
  net_revenue: number
  completed_rides_count: number
  refunded_rides_count: number
  /** pending + approved cash-outs (not period-bound) */
  pending_cashouts_total: number
  /** paid cash-outs (not period-bound) */
  paid_cashouts_total: number
}

export type FinancePeriod = 'today' | '7d' | '30d' | 'all'
