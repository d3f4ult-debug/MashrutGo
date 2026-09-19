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

function initDevData(vehicleId: string) {
  if (devPayments.length > 0) return;

  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60 * 1000).toISOString();
  const hoursAgo = (h: number) => new Date(now - h * 3600 * 1000).toISOString();

  devPayments = [
    {
      id: 'pay-001',
      reference_id: 'CLK-904821',
      vehicle_id: vehicleId,
      driver_id: 'usr-driver-1',
      route_id: 'rt-101',
      amount: 3000,
      fare_name: "Shahar ichi tarifi",
      status: 'completed',
      method: 'click',
      created_at: minutesAgo(4),
      refundable: true,
      refund_window_minutes: 30,
      passenger_identifier: 'Mijoz #4829',
    },
    {
      id: 'pay-002',
      reference_id: 'PAY-312984',
      vehicle_id: vehicleId,
      driver_id: 'usr-driver-1',
      route_id: 'rt-101',
      amount: 3000,
      fare_name: "Shahar ichi tarifi",
      status: 'completed',
      method: 'payme',
      created_at: minutesAgo(12),
      refundable: true,
      refund_window_minutes: 30,
      passenger_identifier: 'Mijoz #7124',
    },
    {
      id: 'pay-003',
      reference_id: 'NFC-618402',
      vehicle_id: vehicleId,
      driver_id: 'usr-driver-1',
      route_id: 'rt-101',
      amount: 3000,
      fare_name: "Humo / Uzcard NFC",
      status: 'completed',
      method: 'nfc',
      created_at: minutesAgo(26),
      refundable: true,
      refund_window_minutes: 30,
      passenger_identifier: 'Karta *** 8201',
    },
    {
      id: 'pay-004',
      reference_id: 'WLT-551029',
      vehicle_id: vehicleId,
      driver_id: 'usr-driver-1',
      route_id: 'rt-101',
      amount: 3000,
      fare_name: "MashrutGo Hamyon",
      status: 'completed',
      method: 'wallet',
      created_at: hoursAgo(1.5),
      refundable: false, // Window expired (> 30 min)
      refund_window_minutes: 30,
      passenger_identifier: 'Hamyon #9182',
    },
    {
      id: 'pay-005',
      reference_id: 'CLK-881203',
      vehicle_id: vehicleId,
      driver_id: 'usr-driver-1',
      route_id: 'rt-101',
      amount: 3000,
      fare_name: "Shahar ichi tarifi",
      status: 'refunded',
      method: 'click',
      created_at: hoursAgo(2.1),
      refundable: false,
      refund_window_minutes: 30,
      refund_reason: "Mijoz adashib to'ladi",
      refunded_at: hoursAgo(2.0),
      passenger_identifier: 'Mijoz #1042',
    },
    {
      id: 'pay-006',
      reference_id: 'PAY-229410',
      vehicle_id: vehicleId,
      driver_id: 'usr-driver-1',
      route_id: 'rt-101',
      amount: 3000,
      fare_name: "Shahar ichi tarifi",
      status: 'completed',
      method: 'payme',
      created_at: hoursAgo(3.2),
      refundable: false,
      refund_window_minutes: 30,
      passenger_identifier: 'Mijoz #3381',
    },
  ];

  devBalance = {
    vehicle_id: vehicleId,
    available_balance: 145000,
    today_earnings: 15000,
    today_gross: 18000,
    total_refunded_today: 3000,
    rides_count_today: 6,
    shift_earnings: 15000,
    pending_cashout: 50000,
  };

  devLedger = [
    {
      id: 'led-001',
      entry_type: 'ride_payment',
      amount: 3000,
      balance_after: 145000,
      reference_id: 'CLK-904821',
      description: "Yo'l haqi to'lovi (Click)",
      created_at: minutesAgo(4),
    },
    {
      id: 'led-002',
      entry_type: 'ride_payment',
      amount: 3000,
      balance_after: 142000,
      reference_id: 'PAY-312984',
      description: "Yo'l haqi to'lovi (Payme)",
      created_at: minutesAgo(12),
    },
    {
      id: 'led-003',
      entry_type: 'ride_payment',
      amount: 3000,
      balance_after: 139000,
      reference_id: 'NFC-618402',
      description: "Yo'l haqi to'lovi (NFC)",
      created_at: minutesAgo(26),
    },
    {
      id: 'led-004',
      entry_type: 'refund',
      amount: -3000,
      balance_after: 136000,
      reference_id: 'CLK-881203',
      description: "To'lovni bekor qilish (Adashib to'langan)",
      created_at: hoursAgo(2.0),
    },
    {
      id: 'led-005',
      entry_type: 'cashout',
      amount: -50000,
      balance_after: 139000,
      reference_id: 'CSH-00192',
      description: "Karta hisobiga pul chiqarish (8600 •••• 4123)",
      created_at: hoursAgo(4),
    },
    {
      id: 'led-006',
      entry_type: 'commission',
      amount: -1500,
      balance_after: 189000,
      reference_id: 'COM-2026-09',
      description: "Uyushma xizmat haqi komissiyasi (1%)",
      created_at: hoursAgo(5),
    },
  ];

  devCashouts = [
    {
      id: 'csh-001',
      driver_id: 'usr-driver-1',
      vehicle_id: vehicleId,
      amount: 50000,
      method: 'card',
      payout_details: '8600 •••• 4123 (Uzcard)',
      status: 'pending',
      created_at: hoursAgo(4),
    },
    {
      id: 'csh-002',
      driver_id: 'usr-driver-1',
      vehicle_id: vehicleId,
      amount: 120000,
      method: 'card',
      payout_details: '9860 •••• 9812 (Humo)',
      status: 'paid',
      created_at: new Date(now - 28 * 3600 * 1000).toISOString(),
      processed_at: new Date(now - 26 * 3600 * 1000).toISOString(),
    },
  ];
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
      return await apiClient.get<DriverPayment[]>(`/driver/payments?${q.toString()}`);
    } catch (err) {
      if (isDev) {
        initDevData(vehicleId);
        let list = devPayments.filter(p => p.vehicle_id === vehicleId);
        if (filter?.status && filter.status !== 'all') {
          list = list.filter(p => p.status === filter.status);
        }
        return list;
      }
      throw err;
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
      return await apiClient.get<DriverBalanceSummary>(`/driver/balance?vehicle_id=${vehicleId}`);
    } catch (err) {
      if (isDev) {
        initDevData(vehicleId);
        return devBalance!;
      }
      throw err;
    }
  },

  /**
   * Fetch double-entry financial ledger history for driver's vehicle.
   */
  async getLedger(vehicleId: string): Promise<LedgerEntry[]> {
    try {
      return await apiClient.get<LedgerEntry[]>(`/driver/ledger?vehicle_id=${vehicleId}`);
    } catch (err) {
      if (isDev) {
        initDevData(vehicleId);
        return [...devLedger];
      }
      throw err;
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
      return await apiClient.get<CashoutRequest[]>(`/driver/cashouts?vehicle_id=${vehicleId}`);
    } catch (err) {
      if (isDev) {
        initDevData(vehicleId);
        return [...devCashouts];
      }
      throw err;
    }
  },
};
