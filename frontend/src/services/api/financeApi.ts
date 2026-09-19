import { apiClient } from './client';
import type {
  UyushmaPaymentTransaction,
  UyushmaCashoutRequest,
  FinanceSummary,
  CashoutActionStatus,
} from '../../types/finance';

// In-memory dev store
let devTransactions: UyushmaPaymentTransaction[] = [];
let devCashouts: UyushmaCashoutRequest[] = [];

function initDevData(uyushmaId: string) {
  if (devTransactions.length > 0) return;

  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60 * 1000).toISOString();
  const hoursAgo = (h: number) => new Date(now - h * 3600 * 1000).toISOString();
  const daysAgo = (d: number) => new Date(now - d * 86400 * 1000).toISOString();

  devTransactions = [
    {
      id: 'tx-001',
      reference_id: 'CLK-904821',
      uyushma_id: uyushmaId,
      route_id: 'rt-101',
      route_number: '12',
      vehicle_id: 'veh-101',
      vehicle_plate: '60 A 777 AA',
      driver_id: 'usr-driver-1',
      driver_name: 'Anvar Qodirov',
      amount: 3000,
      commission_amount: 30, // 1%
      net_amount: 2970,
      status: 'completed',
      method: 'click',
      created_at: minutesAgo(4),
      passenger_identifier: 'Mijoz #4829',
    },
    {
      id: 'tx-002',
      reference_id: 'PAY-312984',
      uyushma_id: uyushmaId,
      route_id: 'rt-101',
      route_number: '12',
      vehicle_id: 'veh-101',
      vehicle_plate: '60 A 777 AA',
      driver_id: 'usr-driver-1',
      driver_name: 'Anvar Qodirov',
      amount: 3000,
      commission_amount: 30,
      net_amount: 2970,
      status: 'completed',
      method: 'payme',
      created_at: minutesAgo(12),
      passenger_identifier: 'Mijoz #7124',
    },
    {
      id: 'tx-003',
      reference_id: 'NFC-618402',
      uyushma_id: uyushmaId,
      route_id: 'rt-101',
      route_number: '12',
      vehicle_id: 'veh-102',
      vehicle_plate: '60 B 123 BB',
      driver_id: 'usr-driver-2',
      driver_name: 'Jasur Saidov',
      amount: 3000,
      commission_amount: 30,
      net_amount: 2970,
      status: 'completed',
      method: 'nfc',
      created_at: minutesAgo(26),
      passenger_identifier: 'Humo *** 8201',
    },
    {
      id: 'tx-004',
      reference_id: 'CLK-881203',
      uyushma_id: uyushmaId,
      route_id: 'rt-101',
      route_number: '12',
      vehicle_id: 'veh-101',
      vehicle_plate: '60 A 777 AA',
      driver_id: 'usr-driver-1',
      driver_name: 'Anvar Qodirov',
      amount: 3000,
      commission_amount: 0,
      net_amount: 0,
      status: 'refunded',
      method: 'click',
      created_at: hoursAgo(2.1),
      refund_reason: "Mijoz adashib to'ladi",
      refunded_at: hoursAgo(2.0),
      passenger_identifier: 'Mijoz #1042',
    },
    {
      id: 'tx-005',
      reference_id: 'WLT-812049',
      uyushma_id: uyushmaId,
      route_id: 'rt-102',
      route_number: '1',
      vehicle_id: 'veh-103',
      vehicle_plate: '60 C 456 CC',
      driver_id: 'usr-driver-3',
      driver_name: 'Olimjon Rustamov',
      amount: 3000,
      commission_amount: 30,
      net_amount: 2970,
      status: 'completed',
      method: 'wallet',
      created_at: hoursAgo(3.4),
      passenger_identifier: 'Hamyon #4190',
    },
    {
      id: 'tx-006',
      reference_id: 'PAY-741920',
      uyushma_id: uyushmaId,
      route_id: 'rt-103',
      route_number: '24',
      vehicle_id: 'veh-104',
      vehicle_plate: '60 D 999 DD',
      driver_id: 'usr-driver-4',
      driver_name: 'Bobur Xolmatov',
      amount: 3000,
      commission_amount: 30,
      net_amount: 2970,
      status: 'completed',
      method: 'payme',
      created_at: hoursAgo(5.1),
      passenger_identifier: 'Mijoz #9921',
    },
    {
      id: 'tx-007',
      reference_id: 'CLK-109284',
      uyushma_id: uyushmaId,
      route_id: 'rt-102',
      route_number: '1',
      vehicle_id: 'veh-103',
      vehicle_plate: '60 C 456 CC',
      driver_id: 'usr-driver-3',
      driver_name: 'Olimjon Rustamov',
      amount: 3000,
      commission_amount: 30,
      net_amount: 2970,
      status: 'completed',
      method: 'click',
      created_at: daysAgo(1),
      passenger_identifier: 'Mijoz #3812',
    },
  ];

  devCashouts = [
    {
      id: 'csh-101',
      uyushma_id: uyushmaId,
      driver_id: 'usr-driver-1',
      driver_name: 'Anvar Qodirov',
      driver_phone: '+998 90 123 45 67',
      vehicle_id: 'veh-101',
      vehicle_plate: '60 A 777 AA',
      amount: 50000,
      method: 'card',
      payout_details: '8600 •••• •••• 4123 (Uzcard)',
      status: 'pending',
      created_at: hoursAgo(2),
    },
    {
      id: 'csh-102',
      uyushma_id: uyushmaId,
      driver_id: 'usr-driver-2',
      driver_name: 'Jasur Saidov',
      driver_phone: '+998 91 234 56 78',
      vehicle_id: 'veh-102',
      vehicle_plate: '60 B 123 BB',
      amount: 150000,
      method: 'cash',
      payout_details: 'Uyushma kassasidan naqd olish',
      status: 'pending',
      created_at: hoursAgo(4),
    },
    {
      id: 'csh-103',
      uyushma_id: uyushmaId,
      driver_id: 'usr-driver-4',
      driver_name: 'Bobur Xolmatov',
      driver_phone: '+998 94 456 78 90',
      vehicle_id: 'veh-104',
      vehicle_plate: '60 D 999 DD',
      amount: 220000,
      method: 'card',
      payout_details: '9860 •••• •••• 9812 (Humo)',
      status: 'approved',
      created_at: daysAgo(1),
      processed_at: hoursAgo(10),
      processed_by: 'Bosh hisobchi',
    },
    {
      id: 'csh-104',
      uyushma_id: uyushmaId,
      driver_id: 'usr-driver-3',
      driver_name: 'Olimjon Rustamov',
      driver_phone: '+998 93 345 67 89',
      vehicle_id: 'veh-103',
      vehicle_plate: '60 C 456 CC',
      amount: 80000,
      method: 'card',
      payout_details: '8600 •••• •••• 0092 (Uzcard)',
      status: 'paid',
      created_at: daysAgo(2),
      processed_at: daysAgo(1),
      processed_by: 'Kassa xodimi',
      payment_reference: 'BNK-TXN-991204',
    },
    {
      id: 'csh-105',
      uyushma_id: uyushmaId,
      driver_id: 'usr-driver-2',
      driver_name: 'Jasur Saidov',
      driver_phone: '+998 91 234 56 78',
      vehicle_id: 'veh-102',
      vehicle_plate: '60 B 123 BB',
      amount: 300000,
      method: 'card',
      payout_details: '8600 •••• •••• 5511 (Uzcard)',
      status: 'rejected',
      created_at: daysAgo(3),
      processed_at: daysAgo(2),
      processed_by: 'Bosh hisobchi',
      rejection_reason: 'Karta raqami egasining familiyasi haydovchi nomiga to\'g\'ri kelmadi.',
    },
  ];
}

export const financeApi = {
  /**
   * Fetch organization payments with filters.
   */
  async getPayments(
    uyushmaId: string,
    filters?: {
      route_id?: string;
      method?: string;
      status?: string;
      search?: string;
    }
  ): Promise<UyushmaPaymentTransaction[]> {
    try {
      const q = new URLSearchParams();
      if (filters?.route_id) q.append('route_id', filters.route_id);
      if (filters?.method) q.append('method', filters.method);
      if (filters?.status) q.append('status', filters.status);
      return await apiClient.get<UyushmaPaymentTransaction[]>(`/uyushma/${uyushmaId}/payments?${q.toString()}`);
    } catch {
      initDevData(uyushmaId);
      let list = [...devTransactions];
      if (filters?.route_id) list = list.filter(t => t.route_id === filters.route_id);
      if (filters?.method && filters.method !== 'all') list = list.filter(t => t.method === filters.method);
      if (filters?.status && filters.status !== 'all') list = list.filter(t => t.status === filters.status);
      if (filters?.search) {
        const s = filters.search.toLowerCase();
        list = list.filter(
          t =>
            t.reference_id.toLowerCase().includes(s) ||
            t.driver_name.toLowerCase().includes(s) ||
            t.vehicle_plate.toLowerCase().includes(s)
        );
      }
      return list;
    }
  },

  /**
   * Fetch financial summary stats.
   */
  async getFinanceSummary(uyushmaId: string): Promise<FinanceSummary> {
    try {
      return await apiClient.get<FinanceSummary>(`/uyushma/${uyushmaId}/finance/summary`);
    } catch {
      initDevData(uyushmaId);
      const completed = devTransactions.filter(t => t.status === 'completed');
      const refunded = devTransactions.filter(t => t.status === 'refunded');

      const gross = completed.reduce((sum, t) => sum + t.amount, 0);
      const refunds = refunded.reduce((sum, t) => sum + t.amount, 0);
      const comm = completed.reduce((sum, t) => sum + t.commission_amount, 0);
      const pendingCashouts = devCashouts
        .filter(c => c.status === 'pending' || c.status === 'approved')
        .reduce((sum, c) => sum + c.amount, 0);
      const paidCashouts = devCashouts
        .filter(c => c.status === 'paid')
        .reduce((sum, c) => sum + c.amount, 0);

      return {
        gross_revenue: gross,
        total_refunds: refunds,
        net_revenue: gross - refunds - comm,
        platform_commission: comm,
        completed_rides_count: completed.length,
        refunded_rides_count: refunded.length,
        pending_cashouts_total: pendingCashouts,
        paid_cashouts_total: paidCashouts,
      };
    }
  },

  /**
   * Fetch driver cashout requests.
   */
  async getCashouts(uyushmaId: string, status?: CashoutActionStatus | 'all'): Promise<UyushmaCashoutRequest[]> {
    try {
      const q = status && status !== 'all' ? `?status=${status}` : '';
      return await apiClient.get<UyushmaCashoutRequest[]>(`/uyushma/${uyushmaId}/cashouts${q}`);
    } catch {
      initDevData(uyushmaId);
      if (status && status !== 'all') {
        return devCashouts.filter(c => c.status === status);
      }
      return [...devCashouts];
    }
  },

  /**
   * Approve a driver cashout request.
   */
  async approveCashout(uyushmaId: string, cashoutId: string): Promise<UyushmaCashoutRequest> {
    try {
      return await apiClient.post<UyushmaCashoutRequest>(`/uyushma/${uyushmaId}/cashouts/${cashoutId}/approve`);
    } catch {
      const target = devCashouts.find(c => c.id === cashoutId);
      if (!target) throw new Error("So'rov topilmadi");
      target.status = 'approved';
      target.processed_at = new Date().toISOString();
      target.processed_by = 'Uyushma boshqaruvchisi';
      return { ...target };
    }
  },

  /**
   * Reject a driver cashout request with mandatory audit reason.
   */
  async rejectCashout(uyushmaId: string, cashoutId: string, auditReason: string): Promise<UyushmaCashoutRequest> {
    if (!auditReason.trim()) {
      throw new Error("Rad etish uchun audit sababi majburiy kiritilishi shart!");
    }

    try {
      return await apiClient.post<UyushmaCashoutRequest>(`/uyushma/${uyushmaId}/cashouts/${cashoutId}/reject`, {
        reason: auditReason,
      });
    } catch {
      const target = devCashouts.find(c => c.id === cashoutId);
      if (!target) throw new Error("So'rov topilmadi");
      target.status = 'rejected';
      target.rejection_reason = auditReason;
      target.processed_at = new Date().toISOString();
      target.processed_by = 'Uyushma boshqaruvchisi';
      return { ...target };
    }
  },

  /**
   * Mark an approved cashout as paid with payment reference.
   */
  async markCashoutPaid(uyushmaId: string, cashoutId: string, paymentReference: string): Promise<UyushmaCashoutRequest> {
    if (!paymentReference.trim()) {
      throw new Error("To'lov cheki yoki bank tranzaksiya raqami kiritilishi shart!");
    }

    try {
      return await apiClient.post<UyushmaCashoutRequest>(`/uyushma/${uyushmaId}/cashouts/${cashoutId}/mark-paid`, {
        payment_reference: paymentReference,
      });
    } catch {
      const target = devCashouts.find(c => c.id === cashoutId);
      if (!target) throw new Error("So'rov topilmadi");
      target.status = 'paid';
      target.payment_reference = paymentReference;
      target.processed_at = new Date().toISOString();
      return { ...target };
    }
  },
};
