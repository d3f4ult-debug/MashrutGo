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

function getStoredCashouts(uyushmaId: string): UyushmaCashoutRequest[] {
  try {
    const raw = localStorage.getItem('mashrutgo_dev_cashouts');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((c: any) => ({
          id: String(c.id),
          uyushma_id: c.uyushma_id || uyushmaId,
          driver_id: String(c.driver_id || 'usr-driver-1'),
          driver_name: c.driver_name || 'Anvar Qodirov',
          driver_phone: c.driver_phone || '+998 90 123 45 67',
          vehicle_id: String(c.vehicle_id || 'veh-101'),
          vehicle_plate: c.vehicle_plate || '60 A 777 AA',
          amount: Number(c.amount ?? c.amount_uzs ?? 0),
          method: c.method || 'card',
          payout_details: c.payout_details || c.notes || '8600 •••• •••• 4123 (Uzcard)',
          status: c.status || 'pending',
          created_at: c.created_at || new Date().toISOString(),
          processed_at: c.processed_at,
          processed_by: c.processed_by,
          rejection_reason: c.rejection_reason,
          payment_reference: c.payment_reference,
        }));
      }
    }
  } catch {}
  return [];
}

function saveStoredCashouts(list: any[]) {
  try {
    localStorage.setItem('mashrutgo_dev_cashouts', JSON.stringify(list));
  } catch {}
}

function initDevData(uyushmaId: string) {
  if (devTransactions.length > 0) return;

  devTransactions = [];


  const stored = getStoredCashouts(uyushmaId);
  if (stored.length > 0) {
    devCashouts = stored;
  } else {
    devCashouts = [];
    saveStoredCashouts(devCashouts);
  }
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
      const raw = await apiClient.get<any[]>(`/uyushma/${uyushmaId}/cashouts${q}`);
      if (Array.isArray(raw)) {
        return raw.map(r => ({
          id: String(r.id),
          uyushma_id: String(r.uyushma_id || uyushmaId),
          driver_id: String(r.driver_id || 'usr-driver-1'),
          driver_name: r.driver_name || 'Haydovchi',
          driver_phone: r.driver_phone || '+998 90 123 45 67',
          vehicle_id: String(r.vehicle_id || 'veh-101'),
          vehicle_plate: r.vehicle_plate || '60 A 777 AA',
          amount: Number(r.amount ?? r.amount_uzs ?? 0),
          method: r.method || 'card',
          payout_details: r.payout_details || r.notes || "Karta / Bank hisob raqami",
          status: (r.status as CashoutActionStatus) || 'pending',
          created_at: r.created_at || new Date().toISOString(),
          processed_at: r.processed_at,
          processed_by: r.processed_by,
          rejection_reason: r.rejection_reason,
          payment_reference: r.payment_reference,
        }));
      }
      return [];
    } catch {
      initDevData(uyushmaId);
      const stored = getStoredCashouts(uyushmaId);
      const list = stored.length > 0 ? stored : devCashouts;
      if (status && status !== 'all') {
        return list.filter(c => c.status === status);
      }
      return [...list];
    }
  },

  /**
   * Approve a driver cashout request.
   */
  async approveCashout(uyushmaId: string, cashoutId: string): Promise<UyushmaCashoutRequest> {
    try {
      return await apiClient.post<UyushmaCashoutRequest>(`/uyushma/cashout/${cashoutId}/approve`);
    } catch {
      try {
        return await apiClient.post<UyushmaCashoutRequest>(`/uyushma/${uyushmaId}/cashouts/${cashoutId}/approve`);
      } catch {
        initDevData(uyushmaId);
        const stored = getStoredCashouts(uyushmaId);
        const list = stored.length > 0 ? stored : devCashouts;
        const target = list.find(c => c.id === cashoutId);
        if (!target) throw new Error("So'rov topilmadi");
        target.status = 'approved';
        target.processed_at = new Date().toISOString();
        target.processed_by = 'Uyushma boshqaruvchisi';
        devCashouts = list;
        saveStoredCashouts(list);
        return { ...target };
      }
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
      return await apiClient.post<UyushmaCashoutRequest>(`/uyushma/cashout/${cashoutId}/reject`, {
        reason: auditReason,
      });
    } catch {
      try {
        return await apiClient.post<UyushmaCashoutRequest>(`/uyushma/${uyushmaId}/cashouts/${cashoutId}/reject`, {
          reason: auditReason,
        });
      } catch {
        initDevData(uyushmaId);
        const stored = getStoredCashouts(uyushmaId);
        const list = stored.length > 0 ? stored : devCashouts;
        const target = list.find(c => c.id === cashoutId);
        if (!target) throw new Error("So'rov topilmadi");
        target.status = 'rejected';
        target.rejection_reason = auditReason;
        target.processed_at = new Date().toISOString();
        target.processed_by = 'Uyushma boshqaruvchisi';
        devCashouts = list;
        saveStoredCashouts(list);
        return { ...target };
      }
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
