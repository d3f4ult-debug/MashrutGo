// ── Payment & Financial Types for Driver Operations (Stage 3) ──

export type PaymentStatus = 'completed' | 'refunded' | 'pending' | 'failed';

export type PaymentMethod = 'click' | 'payme' | 'wallet' | 'cash' | 'nfc';

export interface DriverPayment {
  id: string;
  reference_id: string;      // e.g. "TXN-7392-CL"
  vehicle_id: string;        // strictly isolated to driver's vehicle
  driver_id: string;
  route_id: string;
  amount: number;            // in UZS (e.g. 3000)
  fare_name?: string;        // e.g. "Standart tarif"
  status: PaymentStatus;
  method: PaymentMethod;
  created_at: string;        // ISO timestamp
  refundable: boolean;       // computed based on window & status
  refund_window_minutes: number;
  refund_reason?: string;
  refunded_at?: string;
  passenger_identifier?: string; // masked, e.g. "Mijoz #748" (No full PII)
}

export interface DriverBalanceSummary {
  vehicle_id: string;
  available_balance: number;   // ready for cashout
  today_earnings: number;      // completed minus refunds today
  today_gross: number;         // gross before refunds
  total_refunded_today: number;
  rides_count_today: number;
  shift_earnings: number;
  pending_cashout: number;
}

export type LedgerEntryType =
  | 'ride_payment'
  | 'refund'
  | 'cashout'
  | 'commission'
  | 'adjustment';

export interface LedgerEntry {
  id: string;
  entry_type: LedgerEntryType;
  amount: number;             // positive for credits (+), negative for debits (-)
  balance_after: number;      // running balance after transaction
  reference_id: string;       // links to payment or cashout ref
  description: string;
  created_at: string;
}

export type CashoutStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export type CashoutMethod = 'card' | 'bank' | 'cash';

export interface CashoutRequest {
  id: string;
  driver_id: string;
  vehicle_id: string;
  amount: number;
  method: CashoutMethod;
  payout_details: string;     // e.g. "8600 •••• 4123" or "Uyushma kassasi"
  status: CashoutStatus;
  created_at: string;
  processed_at?: string;
  rejection_reason?: string;
}

// ── WebSocket events for payments ──

export interface PaymentReceivedPayload {
  payment: DriverPayment;
}

export interface PaymentRefundedPayload {
  payment_id: string;
  vehicle_id: string;
  amount: number;
  refund_reason: string;
  refunded_at: string;
}

export interface CashoutStatusPayload {
  cashout_id: string;
  status: CashoutStatus;
  rejection_reason?: string;
}
