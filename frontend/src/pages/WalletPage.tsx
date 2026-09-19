import React, { useState, useEffect } from 'react'
import { useAuth } from '@/services/auth/AuthProvider'
import { walletService } from '@/services/wallet/walletService'
import AuthModal from '@/components/auth/AuthModal'
import { WalletTransaction } from '@/types/client'
import { uz } from '@/locales/uz'

export default function WalletPage() {
  const { user } = useAuth()
  const [balance, setBalance] = useState<number>(walletService.getBalance())
  const [transactions, setTransactions] = useState<WalletTransaction[]>(walletService.getTransactions())
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isTopUpOpen, setIsTopUpOpen] = useState(false)
  const [topUpAmount, setTopUpAmount] = useState<number>(10000)
  const [customAmount, setCustomAmount] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    // If user is not authenticated, prompt auth modal
    if (!user) {
      setIsAuthOpen(true)
    }
  }, [user])

  const handleTopUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatusMessage(null)
    const amount = customAmount ? parseInt(customAmount, 10) : topUpAmount

    if (isNaN(amount) || amount < 1000) {
      setStatusMessage({ type: 'error', text: 'Minimal to‘ldirish summasi: 1 000 so‘m' })
      return
    }

    setIsProcessing(true)
    const res = await walletService.topUpWithClick(amount)
    setIsProcessing(false)

    if (res.success) {
      setBalance(walletService.getBalance())
      setTransactions(walletService.getTransactions())
      setIsTopUpOpen(false)
      setCustomAmount('')
      setStatusMessage({ type: 'success', text: uz.wallet.topUpSuccess })
    } else {
      setStatusMessage({ type: 'error', text: res.error || uz.wallet.topUpFailed })
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Title & Auth Prompt */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-neutral-900">{uz.wallet.title}</h1>
          <p className="text-xs text-neutral-500">MashrutGo hisobi orqali tezkor to‘lovlar</p>
        </div>
        {!user && (
          <button
            onClick={() => setIsAuthOpen(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold"
          >
            Kirish
          </button>
        )}
      </div>

      {statusMessage && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <i
            className={`${
              statusMessage.type === 'success' ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'
            } text-base`}
          ></i>
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Wallet Balance Card */}
      <div className="bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 text-white rounded-3xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute right-[-10px] top-[-10px] text-neutral-700/20 text-8xl pointer-events-none">
          <i className="ri-wallet-3-line"></i>
        </div>

        <div className="relative z-10 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-400">{uz.wallet.balance}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider bg-neutral-700 px-2 py-0.5 rounded-full text-neutral-200">
              ID: {user ? user.id : 'Mijoz (Anonim)'}
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-black tracking-tight">
              {balance.toLocaleString('uz-UZ')}
            </span>
            <span className="text-base text-neutral-300 font-bold">{uz.wallet.currency}</span>
          </div>

          <div className="pt-2 flex gap-3">
            <button
              onClick={() => {
                if (!user) {
                  setIsAuthOpen(true)
                } else {
                  setIsTopUpOpen(true)
                }
              }}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-2xl text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 shadow-sm min-h-[44px]"
            >
              <i className="ri-add-circle-fill text-lg"></i>
              <span>{uz.wallet.topUpWithClick}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Transaction History */}
      <div className="bg-white rounded-2xl p-5 border border-neutral-200 shadow-xs space-y-4">
        <h2 className="text-sm font-bold text-neutral-900">
          {uz.wallet.transactionHistory}
        </h2>

        {transactions.length === 0 ? (
          <div className="p-6 text-center text-neutral-400 text-xs">
            {uz.wallet.noTransactions}
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {transactions.map((tx) => {
              const isCredit = tx.amountSoM > 0
              const dateStr = new Date(tx.createdAtEpochMs).toLocaleDateString('uz-UZ', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })

              return (
                <div key={tx.id} className="py-3 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center text-base ${
                        isCredit
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      <i className={isCredit ? 'ri-arrow-down-circle-line' : 'ri-bus-line'}></i>
                    </div>
                    <div>
                      <div className="font-semibold text-neutral-900">{tx.description}</div>
                      <div className="text-[11px] text-neutral-400">{dateStr}</div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div
                      className={`font-bold text-sm ${
                        isCredit ? 'text-emerald-600' : 'text-neutral-900'
                      }`}
                    >
                      {isCredit ? '+' : ''}
                      {tx.amountSoM.toLocaleString('uz-UZ')} so‘m
                    </div>
                    <div className="text-[10px] text-neutral-400 capitalize">
                      {tx.status === 'success'
                        ? uz.wallet.statusSuccess
                        : tx.status === 'pending'
                        ? uz.wallet.statusPending
                        : uz.wallet.statusFailed}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Click Top-Up Modal */}
      {isTopUpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl space-y-4 border border-neutral-100">
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <i className="ri-bank-card-line text-lg"></i>
                </div>
                <div>
                  <h3 className="font-bold text-neutral-900 text-sm">
                    {uz.wallet.topUpWithClick}
                  </h3>
                  <p className="text-[11px] text-neutral-400">Click to‘lov tizimi</p>
                </div>
              </div>
              <button
                onClick={() => setIsTopUpOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 p-1"
              >
                <i className="ri-close-line text-lg"></i>
              </button>
            </div>

            <form onSubmit={handleTopUpSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-2">
                  {uz.wallet.selectAmount}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[5000, 10000, 20000, 50000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        setTopUpAmount(amt)
                        setCustomAmount('')
                      }}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${
                        !customAmount && topUpAmount === amt
                          ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs'
                          : 'border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                      }`}
                    >
                      {amt.toLocaleString('uz-UZ')} so‘m
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  {uz.wallet.customAmount}
                </label>
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  placeholder="Summani kiriting (so‘m)"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <button
                type="submit"
                disabled={isProcessing}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-neutral-300 text-white font-bold rounded-xl text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 shadow-md min-h-[44px]"
              >
                {isProcessing ? (
                  <span>Amalga oshirilmoqda...</span>
                ) : (
                  <>
                    <i className="ri-secure-payment-fill text-base"></i>
                    <span>Click orqali to‘lash</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onSuccess={() => {
          setIsAuthOpen(false)
        }}
      />
    </div>
  )
}
