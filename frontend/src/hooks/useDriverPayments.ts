// Driver finance state: payments of the driver's own vehicle, balance, ledger and cash-outs.
// The backend is the source of truth: after every money event the balance/ledger are re-read
// instead of being recomputed on the client.
import { useCallback, useEffect, useRef, useState } from 'react'
import { driverApi, mapDriverPayment, type DriverPaymentDto } from '../services/api/driverApi'
import { errorMessage } from '../services/api/client'
import { driverChannel } from '../services/realtime/websocket'
import { useChannel, useChannelEvent } from './useRealtime'
import { formatSom, parseUtc } from '../utils/format'
import type { Cashout, CashoutMethod, DriverBalance, DriverPayment, LedgerEntry, PaymentPeriod } from '../types/driver'

export interface PaymentToast {
  id: number
  title: string
  message: string
  type: 'success' | 'warning' | 'info'
}

/** Short two-tone chime generated with Web Audio (no asset download). */
function playPaymentSound() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const tone = (freq: number, start: number, end: number, gain: number) => {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + start)
      g.gain.setValueAtTime(gain, now + start)
      g.gain.exponentialRampToValueAtTime(0.001, now + end)
      osc.connect(g)
      g.connect(ctx.destination)
      osc.start(now + start)
      osc.stop(now + end)
    }
    tone(659.25, 0, 0.25, 0.2)
    tone(987.77, 0.12, 0.5, 0.25)
    setTimeout(() => void ctx.close().catch(() => undefined), 800)
  } catch {
    // autoplay policy / no audio device
  }
}

export function useDriverPayments(period: PaymentPeriod) {
  const [payments, setPayments] = useState<DriverPayment[]>([])
  const [balance, setBalance] = useState<DriverBalance | null>(null)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [cashouts, setCashouts] = useState<Cashout[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<PaymentToast | null>(null)
  const periodRef = useRef(period)
  periodRef.current = period

  const notify = useCallback((t: Omit<PaymentToast, 'id'>) => setToast({ ...t, id: Date.now() }), [])

  // Payment events arrive in bursts (several fares within seconds), so these reads overlap.
  // Only the newest answer may reach the screen: an older one would show a stale balance.
  const moneySeq = useRef(0)
  const cashoutSeq = useRef(0)

  const refreshMoney = useCallback(async () => {
    const seq = (moneySeq.current += 1)
    const [bal, led] = await Promise.all([driverApi.balance(), driverApi.ledger(100)])
    if (seq !== moneySeq.current) return
    setBalance(bal)
    setLedger(led)
  }, [])

  const refreshCashouts = useCallback(async () => {
    const seq = (cashoutSeq.current += 1)
    const list = await driverApi.cashouts()
    if (seq !== cashoutSeq.current) return
    setCashouts(list)
  }, [])

  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = (loadSeq.current += 1)
    setIsLoading(true)
    setError(null)
    try {
      const [pmts] = await Promise.all([driverApi.payments(periodRef.current), refreshMoney(), refreshCashouts()])
      if (seq !== loadSeq.current) return
      setPayments(pmts)
    } catch (err) {
      if (seq === loadSeq.current) setError(errorMessage(err, 'Ma’lumotlarni yuklashda xatolik yuz berdi'))
    } finally {
      if (seq === loadSeq.current) setIsLoading(false)
    }
  }, [refreshMoney, refreshCashouts])

  useEffect(() => {
    void load()
  }, [load, period])

  // ── Realtime (own vehicle only: the server sends these events to this driver's sockets) ──
  const wsState = useChannel(driverChannel)

  useChannelEvent<{ payment: DriverPaymentDto }>(driverChannel, 'payment.received', (evt) => {
    if (!evt.payload?.payment) return
    const payment = mapDriverPayment(evt.payload.payment)
    playPaymentSound()
    setPayments((prev) => (prev.some((p) => p.id === payment.id) ? prev : [payment, ...prev]))
    notify({
      title: 'Yangi to‘lov qabul qilindi',
      message: `${formatSom(payment.amountUzs)} · ${payment.reference}`,
      type: 'success',
    })
    void refreshMoney().catch(() => undefined)
  })

  useChannelEvent<{ payment_id: string; refund_reason?: string; refunded_at?: string }>(driverChannel, 'payment.refunded', (evt) => {
    const { payment_id: id, refund_reason: reason, refunded_at: at } = evt.payload
    setPayments((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, status: 'refunded', refundable: false, refundReason: reason ?? p.refundReason, refundedAtMs: at ? parseUtc(at) : Date.now() }
          : p,
      ),
    )
    void refreshMoney().catch(() => undefined)
  })

  useChannelEvent<{ cashout_id: number; status: Cashout['status']; rejection_reason?: string | null }>(
    driverChannel,
    'cashout.status_updated',
    (evt) => {
      const labels: Record<Cashout['status'], string> = {
        pending: 'kutilmoqda',
        approved: 'tasdiqlandi',
        rejected: 'rad etildi',
        paid: 'to‘lab berildi',
      }
      notify({
        title: 'Pul yechish so‘rovi',
        message: `So‘rov #${evt.payload.cashout_id} ${labels[evt.payload.status] ?? evt.payload.status}${evt.payload.rejection_reason ? `: ${evt.payload.rejection_reason}` : ''}`,
        type: evt.payload.status === 'rejected' ? 'warning' : 'info',
      })
      void Promise.all([refreshCashouts(), refreshMoney()]).catch(() => undefined)
    },
  )

  // Missed events while disconnected: resync when the socket comes back
  const prevWs = useRef(wsState)
  useEffect(() => {
    if (prevWs.current !== 'connected' && wsState === 'connected' && !isLoading) void load()
    prevWs.current = wsState
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsState])

  const refundPayment = useCallback(
    async (paymentId: string, reason: string) => {
      const updated = await driverApi.refund(paymentId, reason)
      setPayments((prev) => prev.map((p) => (p.id === paymentId ? updated : p)))
      notify({ title: 'To‘lov qaytarildi', message: `${formatSom(updated.amountUzs)} yo‘lovchi hamyoniga qaytarildi`, type: 'warning' })
      await refreshMoney().catch(() => undefined)
      return updated
    },
    [notify, refreshMoney],
  )

  const requestCashout = useCallback(
    async (data: { amountUzs: number; method: CashoutMethod; payoutDetails?: string }, idempotencyKey: string) => {
      const created = await driverApi.requestCashout(data, idempotencyKey)
      setCashouts((prev) => [created, ...prev.filter((c) => c.id !== created.id)])
      notify({
        title: 'Pul yechish so‘rovi yuborildi',
        message: `${formatSom(created.amountUzs)} — Uyushma tasdiqlashi kutilmoqda`,
        type: 'info',
      })
      await refreshMoney().catch(() => undefined)
      return created
    },
    [notify, refreshMoney],
  )

  return {
    payments,
    balance,
    ledger,
    cashouts,
    isLoading,
    error,
    wsState,
    refresh: load,
    refundPayment,
    requestCashout,
    toast,
    clearToast: () => setToast(null),
  }
}
