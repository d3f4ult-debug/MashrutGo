import React, { useState, useEffect } from 'react'
import { walletService } from '@/services/wallet/walletService'
import { PaymentReceipt, ResolvedVehicle } from '@/types/client'
import { uz } from '@/locales/uz'

interface Props {
  isOpen: boolean
  onClose: () => void
  initialVehicle?: ResolvedVehicle | null
  onPaymentSuccess?: (receipt: PaymentReceipt) => void
}

type TabMode = 'qr' | 'manual' | 'nfc'

export default function PaymentModal({
  isOpen,
  onClose,
  initialVehicle = null,
  onPaymentSuccess
}: Props) {
  const [activeTab, setActiveTab] = useState<TabMode>('qr')
  const [manualInput, setManualInput] = useState('')
  const [resolvedVehicle, setResolvedVehicle] = useState<ResolvedVehicle | null>(initialVehicle)
  const [balance, setBalance] = useState<number>(walletService.getBalance())
  const [isProcessing, setIsProcessing] = useState(false)
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [nfcScanning, setNfcScanning] = useState(false)
  const [nfcSupported, setNfcSupported] = useState(false)

  useEffect(() => {
    if (initialVehicle) {
      setResolvedVehicle(initialVehicle)
    }
  }, [initialVehicle])

  useEffect(() => {
    // Check Web NFC capability
    if ('NDEFReader' in window) {
      setNfcSupported(true)
    }
  }, [])

  if (!isOpen) return null

  const handleManualResolve = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    const res = walletService.resolveVehicle(manualInput)
    if (res) {
      setResolvedVehicle(res)
    } else {
      setErrorMessage('Ushbu raqamli transport topilmadi. Masalan: 15 yoki 60 A 105 AA')
    }
  }

  const handleSimulateQrScan = (code: string) => {
    setErrorMessage(null)
    const res = walletService.resolveVehicle(code)
    if (res) {
      setResolvedVehicle(res)
    } else {
      setErrorMessage('QR kod ma’lumotlari noto‘g‘ri')
    }
  }

  const handleStartNfcScan = async () => {
    setErrorMessage(null)
    if (!('NDEFReader' in window)) {
      setErrorMessage(uz.payment.nfcNotSupported)
      return
    }

    try {
      setNfcScanning(true)
      const ndef = new (window as any).NDEFReader()
      await ndef.scan()
      ndef.onreading = (event: any) => {
        // Read tag and resolve vehicle
        const decoder = new TextDecoder()
        for (const record of event.message.records) {
          const text = decoder.decode(record.data)
          const vehicle = walletService.resolveVehicle(text)
          if (vehicle) {
            setResolvedVehicle(vehicle)
            setNfcScanning(false)
            break
          }
        }
      }
    } catch (err: any) {
      setNfcScanning(false)
      setErrorMessage('NFC o‘qishda xatolik: ' + (err.message || 'ruxsat berilmadi'))
    }
  }

  const handlePay = async (method: 'wallet' | 'click') => {
    if (!resolvedVehicle || isProcessing) return
    setErrorMessage(null)
    setIsProcessing(true)

    const idempotencyKey = `pay-${resolvedVehicle.vehicleId}-${Date.now()}`
    const result = await walletService.payTransportFare(resolvedVehicle, method, idempotencyKey)

    setIsProcessing(false)
    if (result.success && result.receipt) {
      setReceipt(result.receipt)
      setBalance(walletService.getBalance())
      onPaymentSuccess?.(result.receipt)
    } else {
      setErrorMessage(result.error || uz.payment.paymentFailed)
    }
  }

  const resetAll = () => {
    setReceipt(null)
    setResolvedVehicle(null)
    setManualInput('')
    setErrorMessage(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-neutral-100 flex flex-col max-h-[90vh]">
        {/* Header */}
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
          <button
            onClick={resetAll}
            className="p-1 rounded-full text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100"
          >
            <i className="ri-close-line text-xl"></i>
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="m-4 mb-0 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
            <i className="ri-error-warning-fill text-base"></i>
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {/* If Payment Receipt is Ready (Electronic Ticket) */}
          {receipt ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-3xl animate-bounce">
                <i className="ri-checkbox-circle-fill"></i>
              </div>
              <div>
                <h4 className="text-lg font-bold text-neutral-900">{uz.payment.paymentSuccess}</h4>
                <p className="text-xs text-neutral-500">{uz.payment.electronicTicket}</p>
              </div>

              {/* Ticket Card */}
              <div className="p-4 bg-neutral-50 border border-dashed border-neutral-300 rounded-xl text-left space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Marshrut:</span>
                  <span className="font-bold text-neutral-900 text-sm">
                    {receipt.vehicle.routeNumber}-sonli
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Davlat raqami:</span>
                  <span className="font-semibold text-neutral-800">{receipt.vehicle.licensePlate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Tashuvchi:</span>
                  <span className="text-neutral-800">{receipt.vehicle.uyushmaName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">To‘lov usuli:</span>
                  <span className="font-medium text-neutral-800">
                    {receipt.paymentMethod === 'wallet' ? 'MashrutGo Hamyon' : 'Click'}
                  </span>
                </div>
                <div className="flex justify-between border-t border-neutral-200 pt-2 text-sm font-bold">
                  <span>To‘langan summa:</span>
                  <span className="text-emerald-600">
                    {receipt.paidAmountSoM.toLocaleString('uz-UZ')} so‘m
                  </span>
                </div>
              </div>

              <button
                onClick={resetAll}
                className="w-full py-3 bg-neutral-900 hover:bg-neutral-800 text-white font-semibold rounded-xl text-sm transition-colors min-h-[44px]"
              >
                Yopish
              </button>
            </div>
          ) : resolvedVehicle ? (
            /* Vehicle & Fare Confirmation Screen */
            <div className="space-y-4">
              <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                    {uz.payment.confirmPayment}
                  </span>
                  <button
                    onClick={() => setResolvedVehicle(null)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Boshqa mashina
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-xl shadow-sm">
                    {resolvedVehicle.routeNumber}
                  </div>
                  <div>
                    <div className="font-bold text-neutral-900 text-base">
                      {resolvedVehicle.routeNumber}-marshrut ({resolvedVehicle.licensePlate})
                    </div>
                    <div className="text-xs text-neutral-600">
                      {resolvedVehicle.uyushmaName}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-blue-200/60 flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-700">Yo‘l haqi tarifi:</span>
                  <span className="text-lg font-black text-blue-700">
                    {resolvedVehicle.fareSoM.toLocaleString('uz-UZ')} so‘m
                  </span>
                </div>
              </div>

              {/* Wallet Info */}
              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 flex items-center justify-between text-xs">
                <span className="text-neutral-600">Hamyoningizdagi balans:</span>
                <span className="font-bold text-neutral-900">
                  {balance.toLocaleString('uz-UZ')} so‘m
                </span>
              </div>

              {/* Payment Actions */}
              <div className="space-y-2 pt-2">
                <button
                  onClick={() => handlePay('wallet')}
                  disabled={isProcessing || balance < resolvedVehicle.fareSoM}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-neutral-300 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm min-h-[44px]"
                >
                  {isProcessing ? (
                    <span>{uz.payment.doubleSubmitWarning}</span>
                  ) : (
                    <>
                      <i className="ri-wallet-3-fill text-lg"></i>
                      <span>{uz.payment.payFromWallet}</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => handlePay('click')}
                  disabled={isProcessing}
                  className="w-full py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 min-h-[44px]"
                >
                  <i className="ri-bank-card-line text-lg text-blue-600"></i>
                  <span>{uz.payment.payWithClick}</span>
                </button>
              </div>
            </div>
          ) : (
            /* Choose Input Mode (QR, Plate, or NFC) */
            <div className="space-y-4">
              <div className="flex border-b border-neutral-200 text-xs font-semibold">
                <button
                  onClick={() => setActiveTab('qr')}
                  className={`flex-1 py-2.5 border-b-2 text-center transition-colors flex items-center justify-center gap-1.5 ${
                    activeTab === 'qr'
                      ? 'border-blue-600 text-blue-600 font-bold'
                      : 'border-transparent text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  <i className="ri-qr-code-line text-sm"></i>
                  <span>QR Skan</span>
                </button>

                <button
                  onClick={() => setActiveTab('manual')}
                  className={`flex-1 py-2.5 border-b-2 text-center transition-colors flex items-center justify-center gap-1.5 ${
                    activeTab === 'manual'
                      ? 'border-blue-600 text-blue-600 font-bold'
                      : 'border-transparent text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  <i className="ri-keyboard-line text-sm"></i>
                  <span>Qo‘lda kiritish</span>
                </button>

                <button
                  onClick={() => setActiveTab('nfc')}
                  className={`flex-1 py-2.5 border-b-2 text-center transition-colors flex items-center justify-center gap-1.5 ${
                    activeTab === 'nfc'
                      ? 'border-blue-600 text-blue-600 font-bold'
                      : 'border-transparent text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  <i className="ri-rfid-line text-sm"></i>
                  <span>NFC</span>
                </button>
              </div>

              {activeTab === 'qr' && (
                <div className="space-y-4 text-center">
                  <div className="w-48 h-48 mx-auto border-2 border-dashed border-blue-400 rounded-2xl flex flex-col items-center justify-center p-4 bg-blue-50/30 relative">
                    <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mb-2">
                      <i className="ri-camera-lens-line text-2xl"></i>
                    </div>
                    <span className="text-xs text-neutral-600 font-medium">
                      Marshrutka saloni yoki eshigidagi QR kodga qarating
                    </span>
                    <div className="absolute inset-x-4 top-1/2 h-0.5 bg-blue-500 animate-pulse opacity-70"></div>
                  </div>

                  <div className="text-xs text-neutral-500">yoki test qilish uchun tezkor tanlang:</div>
                  <div className="flex gap-2 justify-center flex-wrap">
                    <button
                      onClick={() => handleSimulateQrScan('15')}
                      className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-xs font-medium text-neutral-800"
                    >
                      15-marshrut (QR)
                    </button>
                    <button
                      onClick={() => handleSimulateQrScan('22')}
                      className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-xs font-medium text-neutral-800"
                    >
                      22-marshrut (QR)
                    </button>
                    <button
                      onClick={() => handleSimulateQrScan('33')}
                      className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-xs font-medium text-neutral-800"
                    >
                      33-marshrut (QR)
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'manual' && (
                <form onSubmit={handleManualResolve} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">
                      {uz.payment.manualInput}
                    </label>
                    <input
                      type="text"
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      placeholder={uz.payment.vehiclePlaceholder}
                      className="w-full px-3 py-2.5 border border-neutral-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                      required
                    />
                    <p className="text-[11px] text-neutral-500 mt-1">
                      Masalan: 15, 60 A 105 AA yoki v-15-1
                    </p>
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors min-h-[44px]"
                  >
                    {uz.payment.resolveVehicle}
                  </button>
                </form>
              )}

              {activeTab === 'nfc' && (
                <div className="text-center py-6 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto text-3xl">
                    <i className="ri-rfid-line"></i>
                  </div>
                  <div>
                    <h4 className="font-bold text-neutral-900 text-sm">
                      {uz.payment.nfcTap}
                    </h4>
                    <p className="text-xs text-neutral-500 mt-1">
                      {nfcScanning ? uz.payment.nfcSearching : (nfcSupported ? 'Skanerlashni boshlash uchun tugmani bosing' : uz.payment.nfcNotSupported)}
                    </p>
                  </div>
                  {nfcSupported ? (
                    <button
                      onClick={handleStartNfcScan}
                      disabled={nfcScanning}
                      className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-xs transition-colors min-h-[44px]"
                    >
                      {nfcScanning ? 'Kutilmoqda...' : 'NFC Skanerlashni boshlash'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSimulateQrScan('15')}
                      className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl text-xs font-medium"
                    >
                      NFC simulyatsiyasi (15-marshrut)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
