import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { paymentApi } from '../services/api/paymentApi';
import { realtimeService } from '../services/realtime/websocket';
import type {
  DriverPayment,
  DriverBalanceSummary,
  LedgerEntry,
  CashoutRequest,
  PaymentReceivedPayload,
  PaymentRefundedPayload,
  CashoutStatusPayload,
} from '../types/payment';
import type { WsEvent } from '../types/map';

/**
 * Web Audio API synthesizer for zero-asset chime sounds.
 */
function playPaymentSound() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    // Friendly 2-tone chime: E5 (659Hz) -> B5 (987Hz)
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(987.77, now + 0.12);
    gain2.gain.setValueAtTime(0.25, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.5);
  } catch {
    // AudioContext blocked or not allowed — silently ignore
  }
}

export function useDriverPayments() {
  const { user } = useAuth();
  const vehicleId = user?.vehicle_id || 'veh-101'; // fallback vehicle ID
  const driverId = user?.id || 'usr-driver-1';

  const [payments, setPayments] = useState<DriverPayment[]>([]);
  const [balance, setBalance] = useState<DriverBalanceSummary | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [cashouts, setCashouts] = useState<CashoutRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentNotification, setRecentNotification] = useState<{
    id: string;
    title: string;
    message: string;
    type: 'success' | 'warning' | 'info';
  } | null>(null);

  const vehicleIdRef = useRef(vehicleId);
  vehicleIdRef.current = vehicleId;

  // Load all initial financial data
  const loadData = useCallback(async () => {
    if (!vehicleIdRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      const [pmts, bal, led, csh] = await Promise.all([
        paymentApi.getPayments(vehicleIdRef.current),
        paymentApi.getBalance(vehicleIdRef.current),
        paymentApi.getLedger(vehicleIdRef.current),
        paymentApi.getCashouts(vehicleIdRef.current),
      ]);
      setPayments(pmts);
      setBalance(bal);
      setLedger(led);
      setCashouts(csh);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ma\'lumotlarni yuklashda xatolik yuz berdi.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time WebSocket subscriptions
  useEffect(() => {
    const unsubPayment = realtimeService.on('payment.received', (evt: WsEvent) => {
      const payload = evt.payload as PaymentReceivedPayload;
      if (!payload?.payment) return;

      // Strict vehicle isolation check: ignore payments for other vehicles!
      if (payload.payment.vehicle_id !== vehicleIdRef.current) {
        return;
      }

      playPaymentSound();

      setPayments(prev => [payload.payment, ...prev]);

      setBalance(prev => {
        if (!prev) return null;
        return {
          ...prev,
          available_balance: prev.available_balance + payload.payment.amount,
          today_earnings: prev.today_earnings + payload.payment.amount,
          today_gross: prev.today_gross + payload.payment.amount,
          rides_count_today: prev.rides_count_today + 1,
          shift_earnings: prev.shift_earnings + payload.payment.amount,
        };
      });

      setLedger(prev => [
        {
          id: `led-${Date.now()}`,
          entry_type: 'ride_payment',
          amount: payload.payment.amount,
          balance_after: (balance?.available_balance || 0) + payload.payment.amount,
          reference_id: payload.payment.reference_id,
          description: `Yangi yo'l haqi (${payload.payment.method.toUpperCase()})`,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);

      setRecentNotification({
        id: `notif-${Date.now()}`,
        title: "Yangi to'lov qabul qilindi! 🎉",
        message: `${payload.payment.amount.toLocaleString('uz-UZ')} so'm (${payload.payment.method.toUpperCase()})`,
        type: 'success',
      });
    });

    const unsubRefund = realtimeService.on('payment.refunded', (evt: WsEvent) => {
      const payload = evt.payload as PaymentRefundedPayload;
      if (!payload?.payment_id) return;

      if (payload.vehicle_id !== vehicleIdRef.current) return;

      setPayments(prev =>
        prev.map(p =>
          p.id === payload.payment_id
            ? {
                ...p,
                status: 'refunded',
                refundable: false,
                refund_reason: payload.refund_reason,
                refunded_at: payload.refunded_at,
              }
            : p
        )
      );

      setBalance(prev => {
        if (!prev) return null;
        return {
          ...prev,
          available_balance: Math.max(0, prev.available_balance - payload.amount),
          today_earnings: Math.max(0, prev.today_earnings - payload.amount),
          total_refunded_today: prev.total_refunded_today + payload.amount,
        };
      });
    });

    const unsubCashout = realtimeService.on('cashout.status_updated', (evt: WsEvent) => {
      const payload = evt.payload as CashoutStatusPayload;
      if (!payload?.cashout_id) return;

      setCashouts(prev =>
        prev.map(c =>
          c.id === payload.cashout_id
            ? { ...c, status: payload.status, rejection_reason: payload.rejection_reason }
            : c
        )
      );
    });

    return () => {
      unsubPayment();
      unsubRefund();
      unsubCashout();
    };
  }, [balance?.available_balance]);

  // Execute undo/refund action
  const refundPayment = async (paymentId: string, reason: string) => {
    const res = await paymentApi.refundPayment(paymentId, vehicleId, reason);

    // Update in-memory state
    setPayments(prev =>
      prev.map(p =>
        p.id === paymentId
          ? {
              ...p,
              status: 'refunded',
              refundable: false,
              refund_reason: reason,
              refunded_at: new Date().toISOString(),
            }
          : p
      )
    );

    const refundedAmount = payments.find(p => p.id === paymentId)?.amount || 3000;

    setBalance(prev => {
      if (!prev) return null;
      return {
        ...prev,
        available_balance: Math.max(0, prev.available_balance - refundedAmount),
        today_earnings: Math.max(0, prev.today_earnings - refundedAmount),
        total_refunded_today: prev.total_refunded_today + refundedAmount,
      };
    });

    setLedger(prev => [
      {
        id: `led-${Date.now()}`,
        entry_type: 'refund',
        amount: -refundedAmount,
        balance_after: Math.max(0, (balance?.available_balance || 0) - refundedAmount),
        reference_id: res.payment.reference_id,
        description: `Qaytarildi: ${reason}`,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);

    setRecentNotification({
      id: `notif-${Date.now()}`,
      title: "To'lov bekor qilindi (Refund)",
      message: `${refundedAmount.toLocaleString('uz-UZ')} so'm muvaffaqiyatli qaytarildi.`,
      type: 'warning',
    });

    return res;
  };

  // Execute cashout request
  const requestCashout = async (
    amount: number,
    method: 'card' | 'bank' | 'cash',
    payoutDetails: string
  ) => {
    const res = await paymentApi.requestCashout(
      vehicleId,
      driverId,
      amount,
      method,
      payoutDetails
    );

    setCashouts(prev => [res, ...prev]);

    setBalance(prev => {
      if (!prev) return null;
      return {
        ...prev,
        available_balance: Math.max(0, prev.available_balance - amount),
        pending_cashout: prev.pending_cashout + amount,
      };
    });

    setLedger(prev => [
      {
        id: `led-${Date.now()}`,
        entry_type: 'cashout',
        amount: -amount,
        balance_after: Math.max(0, (balance?.available_balance || 0) - amount),
        reference_id: res.id.toUpperCase(),
        description: `Chiqarish so'rovi (${payoutDetails})`,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);

    setRecentNotification({
      id: `notif-${Date.now()}`,
      title: "Pul yechish so'rovi yuborildi",
      message: `${amount.toLocaleString('uz-UZ')} so'm kutilmoqda. Uyushma tasdiqlaydi.`,
      type: 'info',
    });

    return res;
  };

  // Simulate an incoming payment in DEV mode for testability
  const simulateIncomingPayment = (method: 'click' | 'payme' | 'nfc' | 'wallet' = 'click') => {
    const newPayment: DriverPayment = {
      id: `pay-${Date.now().toString().slice(-4)}`,
      reference_id: `${method.toUpperCase().slice(0, 3)}-${Math.floor(100000 + Math.random() * 900000)}`,
      vehicle_id: vehicleId,
      driver_id: driverId,
      route_id: user?.route_id || 'rt-101',
      amount: 3000,
      fare_name: "Shahar ichi tarifi",
      status: 'completed',
      method,
      created_at: new Date().toISOString(),
      refundable: true,
      refund_window_minutes: 30,
      passenger_identifier: `Mijoz #${Math.floor(1000 + Math.random() * 9000)}`,
    };

    realtimeService.dispatch({
      type: 'payment.received',
      payload: { payment: newPayment },
      timestamp: Date.now(),
    });
  };

  const clearNotification = () => setRecentNotification(null);

  return {
    payments,
    balance,
    ledger,
    cashouts,
    isLoading,
    error,
    refresh: loadData,
    refundPayment,
    requestCashout,
    simulateIncomingPayment,
    recentNotification,
    clearNotification,
    vehicleId,
  };
}
