import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import QrScanner from './QrScanner'
import AuthModal from '@/components/auth/AuthModal'
import { clientApi } from '@/services/api/clientApi'
import { ApiError, errorMessage, newIdempotencyKey } from '@/services/api/client'
import { nativeBridge } from '@/services/nativeBridge'
import { useAuth } from '@/contexts/AuthContext'
import { formatSom } from '@/components/ui/RouteCard'
import { formatDateTime } from '@/utils/format'
import type { PaymentReceipt, ResolvedVehicle } from '@/types/client'
import { uz } from '@/locales/uz'

interface Props {
  isOpen: boolean
  onClose: () => void
  onPaymentSuccess?: (receipt: PaymentReceipt) => void
  /** Vehicle id from a scanned QR deep link (/pay?v=ID) */
  initialIdentifier?: string | null
}

type Method = 'qr' | 'manual' | 'nfc'

const TABS: { id: Method; label: string; icon: string }[] = [
  { id: 'qr', label: 'QR skan', icon: 'ri-qr-code-line' },
  { id: 'manual', label: 'Qo‘lda kiritish', icon: 'ri-keyboard-line' },
  { id: 'nfc', label: 'NFC', icon: 'ri-rfid-line' },
]

export default function PaymentModal({ isOpen, onClose, onPaymentSuccess, initialIdentifier }: Props) {
  const { user } = useAuth()
  const isClient = user?.role === 'client'
  const [tab, setTab] = useState<Method>('qr')
  const [manualInput, setManualInput] = useState('')
  const [identifier, setIdentifier] = useState<{ value: string; method: Method } | null>(null)
  const [vehicle, setVehicle] = useState<ResolvedVehicle | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [paying, setPaying] = useState(false)
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nfcScanning, setNfcScanning] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const idempotencyKey = useRef<string | null>(null)
  const nfcAbort = useRef<AbortController | null>(null)

  const nfcAvailable = nativeBridge.isNative() || (typeof window !== 'undefined' && 'NDEFReader' in window)

  const reset = useCallback(() => {
    nfcAbort.current?.abort()
    setTab('qr')
    setManualInput('')
    setIdentifier(null)
    setVehicle(null)
    setReceipt(null)
    setError(null)
    setNfcScanning(false)
    setBalance(null)
    setBalanceError(null)
    idempotencyKey.current = null
  }, [])

  useEffect(() => {
    if (!isOpen) reset()
  }, [isOpen, reset])

  // A failed balance read used to leave the sheet showing "…" with the pay button disabled
  // forever; the passenger now sees why and can retry without closing the sheet.
  const loadBalance = useCallback(() => {
    setBalanceError(null)
    clientApi
      .walletBalance()
      .then((value) => {
        setBalance(value)
        setBalanceError(null)
      })
      .catch((err) => {
        setBalance(null)
        setBalanceError(errorMessage(err, 'Balansni o‘qib bo‘lmadi'))
      })
  }, [])

  useEffect(() => {
    if (isOpen && isClient && vehicle) loadBalance()
  }, [isOpen, isClient, vehicle, loadBalance])

  const resolve = useCallback(async (value: string, method: Method) => {
    const trimmed = value.trim()
    if (!trimmed || resolving) return
    setError(null)
    setResolving(true)
    try {
      const v = await clientApi.resolveVehicle(trimmed, method)
      setIdentifier({ value: trimmed, method })
      setVehicle(v)
      idempotencyKey.current = newIdempotencyKey() // one key per purchase attempt, reused on retry
    } catch (err) {
      setError(errorMessage(err, 'Transport topilmadi'))
    } finally {
      setResolving(false)
    }
  }, [resolving])

  useEffect(() => {
    if (isOpen && initialIdentifier && !vehicle && !identifier) void resolve(initialIdentifier, 'qr')
    // resolve only once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialIdentifier])

  const startNfc = async () => {
    setError(null)
    setNfcScanning(true)
    try {
      if (nativeBridge.isNative()) {
        const res = await nativeBridge.scanNfc()
        if (!res.success || !res.card_id) throw new Error(res.error || 'NFC teg o‘qilmadi')
        await resolve(res.card_id, 'nfc')
        return
      }
      const Reader = (window as unknown as { NDEFReader: new () => any }).NDEFReader
      const reader = new Reader()
      const controller = new AbortController()
      nfcAbort.current = controller
      await reader.scan({ signal: controller.signal })
      reader.onreading = (event: any) => {
        const decoder = new TextDecoder()
        const texts: string[] = []
        for (const record of event.message?.records ?? []) {
          if (record.recordType === 'text' || record.recordType === 'url') texts.push(decoder.decode(record.data))
        }
        const payload = texts[0] || event.serialNumber
        controller.abort()
        setNfcScanning(false)
        if (payload) void resolve(payload, 'nfc')
        else setError('NFC tegda transport ma’lumoti topilmadi')
      }
      reader.onreadingerror = () => setError('NFC tegni o‘qib bo‘lmadi, qayta tekkizing')
    } catch (err) {
      setNfcScanning(false)
      setError(`NFC xatosi: ${errorMessage(err, 'ruxsat berilmadi')}`)
    }
  }

  const pay = async () => {
    if (!vehicle || !identifier || paying) return
    setError(null)
    setPaying(true)
    try {
      const res = await clientApi.payFare(identifier.value, identifier.method, idempotencyKey.current ?? newIdempotencyKey())
      setReceipt(res)
      onPaymentSuccess?.(res)
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) setError('Hamyonda mablag‘ yetarli emas')
      else setError(errorMessage(err, uz.payment.paymentFailed))
    } finally {
      setPaying(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-neutral-100 flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <i className="ri-qr-scan-2-line text-lg"></i>
            </div>
            <div>
              <h3 className="font-bold text-neutral-900">{uz.payment.title}</h3>
              <p className="text-xs text-neutral-500">Andijon jamoat transporti to‘lovi</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Yopish" className="p-1 rounded-full text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100">
            <i className="ri-close-line text-xl"></i>
          </button>
        </div>

        {error && (
          <div className="m-4 mb-0 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
            <i className="ri-error-warning-fill text-base"></i>
            <span>{error}</span>
          </div>
        )}

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {receipt ? (
            <div className="text-center py-2 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-3xl">
                <i className="ri-checkbox-circle-fill"></i>
              </div>
              <div>
                <h4 className="text-lg font-bold text-neutral-900">{uz.payment.paymentSuccess}</h4>
                <p className="text-xs text-neutral-500">{uz.payment.electronicTicket}</p>
              </div>
              <div className="p-4 bg-neutral-50 border border-dashed border-neutral-300 rounded-xl text-left space-y-2 text-xs">
                {[
                  ['Chek', receipt.reference],
                  ['Marshrut', `${receipt.vehicle.routeNumber} — ${receipt.vehicle.routeName}`],
                  ['Transport', receipt.vehicle.licensePlate || receipt.vehicle.vehicleId],
                  ['Tashuvchi', receipt.vehicle.uyushmaName],
                  ['Vaqt', formatDateTime(receipt.paidAtEpochMs)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <span className="text-neutral-500">{k}:</span>
                    <span className="font-semibold text-neutral-800 text-right">{v}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-neutral-200 pt-2 text-sm font-bold">
                  <span>To‘langan:</span>
                  <span className="text-emerald-600">{formatSom(receipt.paidAmountSoM)}</span>
                </div>
                {receipt.balanceAfterSoM !== null && receipt.balanceAfterSoM !== undefined && (
                  <div className="flex justify-between text-neutral-500">
                    <span>Hamyon qoldig‘i:</span>
                    <span>{formatSom(receipt.balanceAfterSoM)}</span>
                  </div>
                )}
              </div>
              <button onClick={onClose} className="w-full py-3 bg-neutral-900 hover:bg-neutral-800 text-white font-semibold rounded-xl text-sm min-h-[44px]">
                Yopish
              </button>
            </div>
          ) : vehicle ? (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{uz.payment.confirmPayment}</span>
                  <button onClick={() => { setVehicle(null); setIdentifier(null) }} className="text-xs text-blue-600 hover:underline">
                    Boshqa mashina
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-xl shadow-sm">
                    {vehicle.routeNumber}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-neutral-900 text-sm truncate">{vehicle.routeName}</div>
                    <div className="text-xs text-neutral-600">
                      {vehicle.licensePlate || vehicle.vehicleId}
                      {vehicle.driverName ? ` · ${vehicle.driverName}` : ''}
                    </div>
                    <div className="text-[11px] text-neutral-500">{vehicle.uyushmaName}</div>
                  </div>
                </div>
                {!vehicle.isOnShift && (
                  <div className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1">
                    Diqqat: bu transport hozir smenada ko‘rinmayapti. Mashina raqamini tekshiring.
                  </div>
                )}
                <div className="pt-2 border-t border-blue-200/60 flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-700">{vehicle.fareRuleName}:</span>
                  <span className="text-lg font-black text-blue-700">{formatSom(vehicle.fareSoM)}</span>
                </div>
              </div>

              {!isClient ? (
                <div className="space-y-2">
                  <p className="text-xs text-neutral-600 text-center">To‘lash uchun yo‘lovchi hisobingizga kiring.</p>
                  <button onClick={() => setAuthOpen(true)} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm min-h-[44px]">
                    Kirish / Ro‘yxatdan o‘tish
                  </button>
                </div>
              ) : (
                <>
                  <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 flex items-center justify-between text-xs">
                    <span className="text-neutral-600">Hamyon balansi:</span>
                    <span className="font-bold text-neutral-900">
                      {balanceError ? '—' : balance === null ? '…' : formatSom(balance)}
                    </span>
                  </div>
                  {balanceError ? (
                    <button
                      onClick={loadBalance}
                      className="w-full py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-semibold rounded-xl text-sm min-h-[44px]"
                    >
                      <i className="ri-refresh-line" /> {balanceError} — qayta urinish
                    </button>
                  ) : balance !== null && balance < vehicle.fareSoM ? (
                    <Link to="/wallet" onClick={onClose} className="block w-full py-3 text-center bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl text-sm">
                      Mablag‘ yetarli emas — hamyonni to‘ldirish
                    </Link>
                  ) : (
                    <button
                      onClick={pay}
                      disabled={paying || balance === null}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-300 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 shadow-sm min-h-[44px]"
                    >
                      <i className="ri-wallet-3-fill text-lg"></i>
                      <span>{paying ? uz.payment.doubleSubmitWarning : `${uz.payment.payFromWallet} (${formatSom(vehicle.fareSoM)})`}</span>
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex border-b border-neutral-200 text-xs font-semibold" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => {
                      nfcAbort.current?.abort()
                      setNfcScanning(false)
                      setTab(t.id)
                    }}
                    className={`flex-1 py-2.5 border-b-2 flex items-center justify-center gap-1.5 ${
                      tab === t.id ? 'border-blue-600 text-blue-600 font-bold' : 'border-transparent text-neutral-500 hover:text-neutral-700'
                    }`}
                  >
                    <i className={`${t.icon} text-sm`}></i>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>

              {tab === 'qr' && <QrScanner paused={resolving} onResult={(text) => void resolve(text, 'qr')} />}

              {tab === 'manual' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void resolve(manualInput, 'manual')
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label htmlFor="vehicle-id" className="block text-xs font-semibold text-neutral-700 mb-1">
                      {uz.payment.manualInput}
                    </label>
                    <input
                      id="vehicle-id"
                      type="text"
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      placeholder={uz.payment.vehiclePlaceholder}
                      className="w-full px-3 py-2.5 border border-neutral-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                      required
                    />
                    <p className="text-[11px] text-neutral-500 mt-1">Davlat raqami (masalan 60 A 101 AA) yoki mashinadagi ichki ID</p>
                  </div>
                  <button
                    type="submit"
                    disabled={resolving}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-xl text-sm min-h-[44px]"
                  >
                    {resolving ? 'Tekshirilmoqda…' : uz.payment.resolveVehicle}
                  </button>
                </form>
              )}

              {tab === 'nfc' && (
                <div className="text-center py-6 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto text-3xl">
                    <i className="ri-rfid-line"></i>
                  </div>
                  <div>
                    <h4 className="font-bold text-neutral-900 text-sm">{uz.payment.nfcTap}</h4>
                    <p className="text-xs text-neutral-500 mt-1">
                      {!nfcAvailable ? uz.payment.nfcNotSupported : nfcScanning ? uz.payment.nfcSearching : 'Skanerlashni boshlash uchun tugmani bosing'}
                    </p>
                  </div>
                  {nfcAvailable && (
                    <button
                      onClick={startNfc}
                      disabled={nfcScanning || resolving}
                      className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-xl text-xs min-h-[44px]"
                    >
                      {nfcScanning ? 'Kutilmoqda…' : 'NFC skanerlashni boshlash'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  )
}
