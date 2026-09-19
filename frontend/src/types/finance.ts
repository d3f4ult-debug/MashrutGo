// ── Finance & Operations Types (Stage 6) ──

import type { PaymentMethod, PaymentStatus } from './payment';

export interface UyushmaPaymentTransaction {
  id: string;
  reference_id: string;        // e.g. "CLK-904821"
  uyushma_id: string;
  route_id: string;
  route_number: string;
  vehicle_id: string;
  vehicle_plate: string;
  driver_id: string;
  driver_name: string;
  amount: number;              // in UZS
  commission_amount: number;   // platform fee in UZS
  net_amount: number;          // amount to organization
  status: PaymentStatus;
  method: PaymentMethod;
  created_at: string;
  refund_reason?: string;
  refunded_at?: string;
  passenger_identifier?: string;
}

export type CashoutActionStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export interface UyushmaCashoutRequest {
  id: string;
  uyushma_id: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string;
  vehicle_id: string;
  vehicle_plate: string;
  amount: number;
  method: 'card' | 'bank' | 'cash';
  payout_details: string;       // Card number or cash desk note
  status: CashoutActionStatus;
  created_at: string;
  processed_at?: string;
  processed_by?: string;
  rejection_reason?: string;
  payment_reference?: string;   // receipt or transfer transaction ID
}

export interface FinanceSummary {
  gross_revenue: number;        // Jami tushum
  total_refunds: number;        // Qaytarilgan to'lovlar
  net_revenue: number;          // Sof tushum
  platform_commission: number;  // Tizim xizmat haqi
  completed_rides_count: number;// Muvaffaqiyatli qatnovlar
  refunded_rides_count: number; // Bekor qilingan qatnovlar
  pending_cashouts_total: number;
  paid_cashouts_total: number;
}

// ── Extensible Fare Rule Types ──
export type ExtensibleFareType = 'fixed' | 'distance' | 'zone' | 'time_based';

export interface FixedFareConfig {
  base_amount: number;
}

export interface DistanceFareConfig {
  base_amount: number;
  per_km_rate: number;
  included_km: number;
}

export interface ZoneFareConfig {
  base_amount: number;
  cross_zone_extra: number;
}

export interface TimeFareConfig {
  base_amount: number;
  peak_multiplier: number;
  peak_start_hour: number;
  peak_end_hour: number;
}

export interface ExtensibleFareRule {
  id: string;
  uyushma_id: string;
  name: string;
  rule_type: ExtensibleFareType;
  amount: number;               // display/base amount
  target_route_id?: string;
  target_route_number?: string;
  config: FixedFareConfig | DistanceFareConfig | ZoneFareConfig | TimeFareConfig;
  is_active: boolean;
  description?: string;
  created_at: string;
}
