import React, { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AuthModal from '@/components/auth/AuthModal'
import LoadingSkeleton from '@/components/ui/LoadingSkeleton'
import { useAuth } from '@/contexts/AuthContext'
import { clientApi } from '@/services/api/clientApi'
import { errorMessage } from '@/services/api/client'
import { nativeBridge } from '@/services/nativeBridge'
import { formatSom } from '@/components/ui/RouteCard'
import type { PaymentConfig, TopupOrder, WalletTransaction } from '@/types/client'
import { uz } from '@/locales/uz'

const ENTRY_LABEL: Record<WalletTransaction['type'], { icon: string; credit: boolean }> = {
  topup: { icon: 'ri-bank-card-line', credit: true },
  refund: { icon: 'ri-arrow-go-back-line', credit: true },
  adjustment: { icon: 'ri-scales-3-line', credit: true },
  ride_payment: { icon: 'ri-bus-line', credit: false },
  ride_earning: { icon: 'ri-coins-line', credit: true },
  refund_reversal: { icon: 'ri-arrow-go-back-line', credit: false },
  cashout: { icon: 'ri-hand-coin-line', credit: false },
}

const PRESETS = [5000, 10000, 20000, 50000]

export default function WalletPage() {
  const { user, isLoading: authLoading } = useAuth()
  const isClient = user?.role === 'client'
  const [params, setParams] = useSearchParams()

  const [balance, setBalance] = useState<number | null>(null)
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [config, setConfig] = useState<PaymentConfig | null>(null)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isTopUpOpen, setIsTopUpOpen] = useState(false)
  const [amount, setAmount] = useState(10000)
  const [customAmount, setCustomAmount] = useState('')
  const [processing, setProcessing] = useState(false)
  const [pendingOrder, setPendingOrder] = useState<TopupOrder | null>(null)
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!isClient) return
    setLoading(true)
    try {
      const [bal, txs] = await Promise.all([clientApi.walletBalance(), clientApi.walletTransactions()])
      setBalance(bal)
      setTransactions(txs)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err, 'Hamyon ma’lumotlarini yuklab bo‘lmadi'))
    } finally {
      setLoading(false)
    }
  }, [isClient])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    clientApi.paymentConfig().then(setConfig).catch(() => setConfig(null))
  }, [])

  // Returning from Click checkout: /wallet?topup=<id> — poll until the signed callback lands
  useEffect(() => {
    const topupId = Number(params.get('topup'))
    if (!isClient || !topupId) return
    let attempts = 0
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      attempts += 1
      try {
        const order = await clientApi.getTopup(topupId)
        // The request outlives the effect when the user navigates away mid-poll: stop here,
        // otherwise this keeps scheduling timers nobody can clear any more.
        if (cancelled) return
        if (order.status === 'completed') {
          setStatus({ type: 'success', text: `${uz.wallet.topUpSuccess} (${formatSom(order.amountSoM)})` })
          params.delete('topup')
          setParams(params, { replace: true })
          void load()
          return
        }
        if (order.status === 'cancelled' || order.status === 'failed') {
          setStatus({ type: 'error', text: order.errorNote || uz.wallet.topUpFailed })
          return
        }
        setStatus({ type: 'info', text: 'Click to‘lovi tasdiqlanishi kutilmoqda…' })
        if (attempts < 20) timer = setTimeout(poll, 3000)
      } catch (err) {
        if (!cancelled) setStatus({ type: 'error', text: errorMessage(err) })
      }
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [params, setParams, isClient, load])

  const handleTopUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus(null)
    const value = customAmount ? parseInt(customAmount, 10) : amount
    const min = config?.minTopupSoM ?? 1000
    const max = config?.maxTopupSoM ?? 2_000_000
    if (!Number.isFinite(value) || value < min || value > max) {
      setStatus({ type: 'error', text: `Summa ${formatSom(min)} – ${formatSom(max)} oralig‘ida bo‘lishi kerak` })
      return
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus({ type: 'error', text: 'Moliyaviy amallar uchun internet zarur' })
      return
    }
    setProcessing(true)
    try {
      const order = await clientApi.createTopup(value)
      if (order.checkoutUrl) {
        const url = order.checkoutUrl
        if (nativeBridge.isNative()) nativeBridge.openExternal(url)
        else window.location.assign(url)
        return
      }
      setPendingOrder(order) // sandbox (development only)
      setIsTopUpOpen(false)
    } catch (err) {
      setStatus({ type: 'error', text: errorMessage(err, uz.wallet.topUpFailed) })
    } finally {
      setProcessing(false)
    }
  }

  const confirmSandbox = async () => {
    if (!pendingOrder) return
    setProcessing(true)
    try {
      const done = await clientApi.completeSandboxTopup(pendingOrder.id)
      setPendingOrder(null)
      setStatus({ type: 'success', text: `${uz.wallet.topUpSuccess} (${formatSom(done.amountSoM)}) — test rejimi` })
      void load()
    } catch (err) {
      setStatus({ type: 'error', text: errorMessage(err) })
    } finally {
      setProcessing(false)
    }
  }

  // Everything that is not a signed-in client shares this block, including the moment a sign-in
  // is in flight. Keying it off `!authLoading` used to unmount the modal the instant the user
  // pressed "Kirish", which threw away the error message a failed sign-in writes into it.
  if (!isClient) {
    return (
      <div className="max-w-md mx-auto py-10 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto text-3xl">
          <i className="ri-wallet-3-line"></i>
        </div>
        <h1 className="text-lg font-bold">{uz.wallet.title}</h1>
        {authLoading ? (
          <p className="text-sm text-neutral-400">Yuklanmoqda…</p>
        ) : (
          <p className="text-sm text-neutral-500">
            {user ? 'Hamyon faqat yo‘lovchi hisoblari uchun.' : 'Hamyondan foydalanish uchun hisobingizga kiring.'}
          </p>
        )}
        {!user && !authLoading && (
          <button onClick={() => setIsAuthOpen(true)} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold">
            Kirish / Ro‘yxatdan o‘tish
          </button>
        )}
        <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />
      </div>
    )
  }

  const topupDisabled = !config || config.maintenanceMode || (!config.clickConfigured && !config.sandboxEnabled)

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-extrabold text-neutral-900">{uz.wallet.title}</h1>
        <p className="text-xs text-neutral-500">MashrutGo hisobi orqali tezkor to‘lovlar</p>
      </div>

      {status && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
            status.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : status.type === 'info'
                ? 'bg-blue-50 border-blue-200 text-blue-800'
                : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <i className={status.type === 'success' ? 'ri-checkbox-circle-fill' : status.type === 'info' ? 'ri-time-line' : 'ri-error-warning-fill'}></i>
          <span>{status.text}</span>
        </div>
      )}

      {pendingOrder && (
        <div className="p-4 rounded-2xl border border-amber-300 bg-amber-50 space-y-2 text-xs text-amber-900">
          <div className="font-bold flex items-center gap-1.5">
            <i className="ri-flask-line"></i> Test (sandbox) rejimi
          </div>
          <p>
            Click hali sozlanmagan. Bu buyurtma ({formatSom(pendingOrder.amountSoM)}) real Click callback’lari bilan bir xil server oqimi orqali
            tasdiqlanadi. Productionda bu tugma mavjud emas.
          </p>
          <div className="flex gap-2">
            <button onClick={confirmSandbox} disabled={processing} className="px-3 py-2 bg-amber-600 text-white rounded-lg font-semibold disabled:opacity-60">
              To‘lovni tasdiqlash (test)
            </button>
            <button onClick={() => setPendingOrder(null)} className="px-3 py-2 bg-white border border-amber-300 rounded-lg">
              Bekor qilish
            </button>
          </div>
        </div>
      )}

      <div className="bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 text-white rounded-3xl p-6 shadow-xl">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-400">{uz.wallet.balance}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider bg-neutral-700 px-2 py-0.5 rounded-full text-neutral-200">
              {user?.phone}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            {balance === null ? (
              <span className="text-3xl font-black">{loading ? '…' : '—'}</span>
            ) : (
              <span className="text-3xl sm:text-4xl font-black tracking-tight">{formatSom(balance).replace(' so‘m', '')}</span>
            )}
            <span className="text-base text-neutral-300 font-bold">{uz.wallet.currency}</span>
          </div>
          <button
            onClick={() => setIsTopUpOpen(true)}
            disabled={topupDisabled}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-600 text-white font-bold rounded-2xl text-sm flex items-center justify-center gap-2 min-h-[44px]"
          >
            <i className="ri-add-circle-fill text-lg"></i>
            <span>{uz.wallet.topUpWithClick}</span>
          </button>
          {config?.maintenanceMode && <p className="text-[11px] text-amber-300">Tizim texnik xizmat rejimida — to‘ldirish vaqtincha yopiq.</p>}
          {config && !config.clickConfigured && !config.sandboxEnabled && (
            <p className="text-[11px] text-amber-300">Click to‘lov tizimi hali ulanmagan.</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 border border-neutral-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-neutral-900">{uz.wallet.transactionHistory}</h2>
          <button onClick={() => void load()} className="text-xs text-blue-600" aria-label="Yangilash">
            <i className="ri-refresh-line"></i>
          </button>
        </div>
        {loading && transactions.length === 0 ? (
          <div className="space-y-2">
            <LoadingSkeleton className="h-10 rounded-lg" />
            <LoadingSkeleton className="h-10 rounded-lg" />
          </div>
        ) : loadError ? (
          <div className="p-4 text-center text-xs text-red-600">{loadError}</div>
        ) : transactions.length === 0 ? (
          <div className="p-6 text-center text-neutral-400 text-xs">{uz.wallet.noTransactions}</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {transactions.map((tx) => {
              const meta = ENTRY_LABEL[tx.type]
              const credit = tx.amountSoM > 0
              return (
                <div key={tx.id} className="py-3 flex items-center justify-between text-xs gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 ${credit ? 'bg-emerald-50 text-emerald-600' : 'bg-neutral-100 text-neutral-700'}`}>
                      <i className={meta?.icon ?? 'ri-exchange-line'}></i>
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-neutral-900 truncate">{tx.description}</div>
                      <div className="text-[11px] text-neutral-400">
                        {new Date(tx.createdAtEpochMs).toLocaleString('uz-UZ', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`font-bold text-sm ${credit ? 'text-emerald-600' : 'text-neutral-900'}`}>
                      {credit ? '+' : ''}
                      {formatSom(tx.amountSoM)}
                    </div>
                    <div className="text-[10px] text-neutral-400">Qoldiq: {formatSom(tx.balanceAfterSoM)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {isTopUpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl space-y-4 border border-neutral-100">
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <i className="ri-bank-card-line text-lg"></i>
                </div>
                <div>
                  <h3 className="font-bold text-neutral-900 text-sm">{uz.wallet.topUpWithClick}</h3>
                  <p className="text-[11px] text-neutral-400">{config?.clickConfigured ? 'Click to‘lov sahifasiga o‘tasiz' : 'Test rejimi (sandbox)'}</p>
                </div>
              </div>
              <button onClick={() => setIsTopUpOpen(false)} aria-label="Yopish" className="text-neutral-400 hover:text-neutral-600 p-1">
                <i className="ri-close-line text-lg"></i>
              </button>
            </div>

            <form onSubmit={handleTopUp} className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => {
                      setAmount(amt)
                      setCustomAmount('')
                    }}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold ${
                      !customAmount && amount === amt ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                    }`}
                  >
                    {formatSom(amt)}
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="block text-xs font-semibold text-neutral-700 mb-1">{uz.wallet.customAmount}</span>
                <input
                  type="number"
                  min={config?.minTopupSoM ?? 1000}
                  max={config?.maxTopupSoM}
                  step={500}
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  placeholder="Summa (so‘m)"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <button
                type="submit"
                disabled={processing}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-300 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 min-h-[44px]"
              >
                <i className="ri-secure-payment-fill text-base"></i>
                <span>{processing ? 'Kuting…' : 'Davom etish'}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
