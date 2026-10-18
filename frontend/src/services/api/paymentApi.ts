import { apiClient } from './client';
import type {
  DriverPayment,
  DriverBalanceSummary,
  LedgerEntry,
  CashoutRequest,
} from '../../types/payment';

const isDev = typeof import.meta !== 'undefined' && import.meta.env
  ? Boolean(import.meta.env.DEV)
  : true;

// In-memory mock store for DEV mode so driver actions (refund, cashout) persist across interactions
let devPayments: DriverPayment[] = [];
let devLedger: LedgerEntry[] = [];
let devCashouts: CashoutRequest[] = [];
let devBalance: DriverBalanceSummary | null = null;

function getStoredCashouts(): CashoutRequest[] {
  try {
    const raw = localStorage.getItem('mashrutgo_dev_cashouts');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((c: any) => ({
          id: String(c.id),
          driver_id: String(c.driver_id || 'usr-driver-1'),
          vehicle_id: String(c.vehicle_id || 'veh-101'),
          amount: Number(c.amount ?? c.amount_uzs ?? 0),
          method: c.method || 'card',
          payout_details: c.payout_details || c.notes || 'Karta / Bank hisobi',
          status: c.status || 'pending',
          created_at: c.created_at || new Date().toISOString(),
          processed_at: c.processed_at,
          rejection_reason: c.rejection_reason,
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

function initDevData(vehicleId: string) {
  if (devPayments.length > 0) return;

  devPayments = [];

  devBalance = {
    vehicle_id: vehicleId,
    available_balance: 0,
    today_earnings: 0,
    today_gross: 0,
    total_refunded_today: 0,
    rides_count_today: 0,
    shift_earnings: 0,
    pending_cashout: 0,
  };

  devLedger = [];

  const stored = getStoredCashouts();
  if (stored.length > 0) {
    devCashouts = stored;
  } else {
    devCashouts = [];
    saveStoredCashouts(devCashouts);
  }
}

export const paymentApi = {
  /**
   * Fetch driver payments scoped strictly to the driver's vehicle.
   */
  async getPayments(vehicleId: string, filter?: { period?: string; status?: string }): Promise<DriverPayment[]> {
    try {
      const q = new URLSearchParams();
      q.append('vehicle_id', vehicleId);
      if (filter?.period) q.append('period', filter.period);
      if (filter?.status) q.append('status', filter.status);
      const res = await apiClient.get<any>(`/driver/payments?${q.toString()}`);

      const rawList = Array.isArray(res) ? res : (Array.isArray(res?.items) ? res.items : []);
      if (rawList.length > 0) {
        return rawList.map((p: any) => ({
          id: String(p.id),
          reference_id: p.reference_id || p.external_trans_id || p.idempotency_key || `CLK-${p.id}`,
          vehicle_id: String(p.vehicle_id || p.vehicle_internal_id || vehicleId),
          driver_id: String(p.driver_id || 'usr-driver-1'),
          route_id: String(p.route_id || 'rt-101'),
          amount: Number(p.amount ?? p.amount_uzs ?? 0),
          fare_name: p.fare_name || (p.route_number ? `Marshrut #${p.route_number}` : "Shahar ichi tarifi"),
          status: (p.status as PaymentStatus) || 'completed',
          method: (p.method || p.payment_method || 'click') as PaymentMethod,
          created_at: p.created_at || new Date().toISOString(),
          refundable: Boolean(p.refundable ?? (p.status === 'completed')),
          refund_window_minutes: p.refund_window_minutes || 30,
          refund_reason: p.refund_reason,
          refunded_at: p.refunded_at,
          passenger_identifier: p.passenger_identifier || (p.client_user_id ? `Mijoz #${p.client_user_id}` : 'Mijoz'),
        }));
      }

      if (isDev) {
        initDevData(vehicleId);
        let list = devPayments.filter(p => p.vehicle_id === vehicleId || !p.vehicle_id);
        if (filter?.status && filter.status !== 'all') {
          list = list.filter(p => p.status === filter.status);
        }
        return list;
      }
      return [];
    } catch (err) {
      if (isDev) {
        initDevData(vehicleId);
        let list = devPayments.filter(p => p.vehicle_id === vehicleId || !p.vehicle_id);
        if (filter?.status && filter.status !== 'all') {
          list = list.filter(p => p.status === filter.status);
        }
        return list;
      }
      return [];
    }
  },

  /**
   * Perform Undo/Refund on an allowed payment.
   * Enforces security: Driver can never refund transactions from another vehicle.
   */
  async refundPayment(
    paymentId: string,
    driverVehicleId: string,
    reason: string
  ): Promise<{ success: boolean; payment: DriverPayment; message?: string }> {
    if (!reason || !reason.trim()) {
      throw new Error("Bekor qilish sababi majburiy kiritilishi shart!");
    }

    // Client-side vehicle validation guard
    if (isDev) {
      initDevData(driverVehicleId);
      const target = devPayments.find(p => p.id === paymentId);
      if (!target) {
        throw new Error("To'lov topilmadi.");
      }
      if (target.vehicle_id !== driverVehicleId) {
        throw new Error("Xavfsizlik xatosi: Siz boshqa transport vositasi to'lovini bekor qila olmaysiz!");
      }
      if (target.status === 'refunded') {
        throw new Error("Ushbu to'lov allaqachon bekor qilingan.");
      }
      if (!target.refundable) {
        throw new Error("To'lovni qaytarish vaqti (30 daqiqa) tugagan. Uyushma adminiga murojaat qiling.");
      }
    }

    try {
      return await apiClient.post<{ success: boolean; payment: DriverPayment; message?: string }>(
        `/driver/payments/${paymentId}/refund`,
        {
          vehicle_id: driverVehicleId,
          reason,
        }
      );
    } catch (err) {
      if (isDev) {
        // Apply mock refund in dev state
        const target = devPayments.find(p => p.id === paymentId)!;
        target.status = 'refunded';
        target.refundable = false;
        target.refund_reason = reason;
        target.refunded_at = new Date().toISOString();

        if (devBalance) {
          devBalance.available_balance = Math.max(0, devBalance.available_balance - target.amount);
          devBalance.today_earnings = Math.max(0, devBalance.today_earnings - target.amount);
          devBalance.total_refunded_today += target.amount;
        }

        // Add to dev ledger
        devLedger.unshift({
          id: `led-${Date.now()}`,
          entry_type: 'refund',
          amount: -target.amount,
          balance_after: devBalance ? devBalance.available_balance : 0,
          reference_id: target.reference_id,
          description: `Qaytarish: ${reason}`,
          created_at: new Date().toISOString(),
        });

        return {
          success: true,
          payment: target,
          message: "To'lov muvaffaqiyatli bekor qilindi.",
        };
      }
      throw err;
    }
  },

  /**
   * Fetch balance and today's earnings summary.
   */
  async getBalance(vehicleId: string): Promise<DriverBalanceSummary> {
    try {
      const res = await apiClient.get<any>(`/driver/balance?vehicle_id=${vehicleId}`);
      if (res && (res.available_balance !== undefined || res.balance_uzs !== undefined)) {
        return {
          vehicle_id: res.vehicle_id || vehicleId,
          available_balance: Number(res.available_balance ?? res.balance_uzs ?? 0),
          today_earnings: Number(res.today_earnings ?? 0),
          today_gross: Number(res.today_gross ?? 0),
          total_refunded_today: Number(res.total_refunded_today ?? 0),
          rides_count_today: Number(res.rides_count_today ?? 0),
          shift_earnings: Number(res.shift_earnings ?? 0),
          pending_cashout: Number(res.pending_cashout ?? 0),
        };
      }
      if (isDev) {
        initDevData(vehicleId);
        return devBalance!;
      }
      return {
        vehicle_id: vehicleId,
        available_balance: 0,
        today_earnings: 0,
        today_gross: 0,
        total_refunded_today: 0,
        rides_count_today: 0,
        shift_earnings: 0,
        pending_cashout: 0,
      };
    } catch {
      if (isDev) {
        initDevData(vehicleId);
        return devBalance!;
      }
      return {
        vehicle_id: vehicleId,
        available_balance: 0,
        today_earnings: 0,
        today_gross: 0,
        total_refunded_today: 0,
        rides_count_today: 0,
        shift_earnings: 0,
        pending_cashout: 0,
      };
    }
  },

  /**
   * Fetch double-entry financial ledger history for driver's vehicle.
   */
  async getLedger(vehicleId: string): Promise<LedgerEntry[]> {
    try {
      const res = await apiClient.get<any>(`/driver/ledger?vehicle_id=${vehicleId}`);
      const rawList = Array.isArray(res) ? res : (Array.isArray(res?.items) ? res.items : []);
      if (rawList.length > 0) {
        return rawList.map((l: any) => ({
          id: String(l.id),
          entry_type: l.entry_type || 'ride_payment',
          amount: Number(l.amount ?? l.amount_uzs ?? 0),
          balance_after: Number(l.balance_after ?? l.balance_after_uzs ?? 0),
          reference_id: l.reference_id || `REF-${l.id}`,
          description: l.description || "Yo'l haqi to'lovi",
          created_at: l.created_at || new Date().toISOString(),
        }));
      }
      if (isDev) {
        initDevData(vehicleId);
        return [...devLedger];
      }
      return [];
    } catch {
      if (isDev) {
        initDevData(vehicleId);
        return [...devLedger];
      }
      return [];
    }
  },

  /**
   * Submit a new cash-out request.
   */
  async requestCashout(
    vehicleId: string,
    driverId: string,
    amount: number,
    method: 'card' | 'bank' | 'cash',
    payoutDetails: string
  ): Promise<CashoutRequest> {
    if (amount <= 0) {
      throw new Error("Chiqariladigan summa musbat bo'lishi kerak.");
    }

    try {
      return await apiClient.post<CashoutRequest>('/driver/cashouts', {
        vehicle_id: vehicleId,
        driver_id: driverId,
        amount,
        method,
        payout_details: payoutDetails,
      });
    } catch (err) {
      if (isDev) {
        initDevData(vehicleId);
        if (devBalance && amount > devBalance.available_balance) {
          throw new Error("Yetarli mablag' mavjud emas.");
        }

        const newReq: CashoutRequest = {
          id: `csh-${Date.now().toString().slice(-4)}`,
          driver_id: driverId,
          vehicle_id: vehicleId,
          amount,
          method,
          payout_details: payoutDetails,
          status: 'pending',
          created_at: new Date().toISOString(),
        };

        devCashouts.unshift(newReq);
        saveStoredCashouts(devCashouts);

        if (devBalance) {
          devBalance.available_balance -= amount;
          devBalance.pending_cashout += amount;
        }

        devLedger.unshift({
          id: `led-${Date.now()}`,
          entry_type: 'cashout',
          amount: -amount,
          balance_after: devBalance ? devBalance.available_balance : 0,
          reference_id: newReq.id.toUpperCase(),
          description: `Pul chiqarish so'rovi (${payoutDetails})`,
          created_at: new Date().toISOString(),
        });

        return newReq;
      }
      throw err;
    }
  },

  /**
   * Fetch cashout requests history.
   */
  async getCashouts(vehicleId: string): Promise<CashoutRequest[]> {
    try {
      const raw = await apiClient.get<any[]>(`/driver/cashouts?vehicle_id=${vehicleId}`);
      if (Array.isArray(raw)) {
        return raw.map(r => ({
          id: String(r.id),
          driver_id: String(r.driver_id || 'usr-driver-1'),
          vehicle_id: String(r.vehicle_id || vehicleId),
          amount: Number(r.amount ?? r.amount_uzs ?? 0),
          method: (r.method as any) || 'card',
          payout_details: r.payout_details || r.notes || "Karta / Bank hisob raqami",
          status: (r.status as any) || 'pending',
          created_at: r.created_at || new Date().toISOString(),
          processed_at: r.processed_at,
          rejection_reason: r.rejection_reason,
        }));
      }
      return [];
    } catch (err) {
      if (isDev) {
        initDevData(vehicleId);
        const stored = getStoredCashouts();
        if (stored.length > 0) {
          return stored;
        }
        return [...devCashouts];
      }
      throw err;
    }
  },
};
