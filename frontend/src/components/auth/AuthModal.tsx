import React, { useState } from 'react'
import { useAuth } from '@/services/auth/AuthProvider'
import { uz } from '@/locales/uz'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export default function AuthModal({ isOpen, onClose, onSuccess }: Props) {
  const { signin } = useAuth()
  const [phone, setPhone] = useState('+998 90 ')
  const [smsCode, setSmsCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSendCode = (e: React.FormEvent) => {
    e.preventDefault()
    if (phone.length < 13) {
      setError('Iltimos, to‘liq telefon raqamni kiriting')
      return
    }
    setError(null)
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      setCodeSent(true)
    }, 600)
  }

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault()
    if (!smsCode || smsCode.length < 4) {
      setError('Tasdiqlash kodi 4 xonali bo‘lishi kerak')
      return
    }
    setError(null)
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      signin({
        id: `client-${Date.now()}`,
        name: 'MashrutGo Yo‘lovchisi',
        roles: ['client']
      })
      onSuccess?.()
      onClose()
    }, 600)
  }

  const handleDemoQuickLogin = () => {
    signin({
      id: 'demo-client-1',
      name: 'Andijonlik Yo‘lovchi',
      roles: ['client']
    })
    onSuccess?.()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden border border-neutral-100 p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
          <div>
            <h3 className="text-lg font-bold text-neutral-900">{uz.auth.title}</h3>
            <p className="text-xs text-neutral-500">{uz.auth.subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100"
          >
            <i className="ri-close-line text-xl"></i>
          </button>
        </div>

        {error && (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-center gap-2">
            <i className="ri-error-warning-fill text-sm"></i>
            <span>{error}</span>
          </div>
        )}

        {!codeSent ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                {uz.auth.phoneLabel}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-neutral-400">
                  <i className="ri-phone-line"></i>
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={uz.auth.phonePlaceholder}
                  className="w-full pl-9 pr-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2 min-h-[44px]"
            >
              {loading ? (
                <span>Yuborilmoqda...</span>
              ) : (
                <>
                  <i className="ri-send-plane-fill text-sm"></i>
                  <span>{uz.auth.sendCode}</span>
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-semibold text-neutral-700">
                  {uz.auth.smsCodeLabel}
                </label>
                <button
                  type="button"
                  onClick={() => setCodeSent(false)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Raqamni o‘zgartirish
                </button>
              </div>
              <input
                type="text"
                maxLength={4}
                value={smsCode}
                onChange={(e) => setSmsCode(e.target.value)}
                placeholder={uz.auth.smsCodePlaceholder}
                className="w-full text-center tracking-widest text-lg font-bold py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
                required
              />
              <p className="text-[11px] text-neutral-500 mt-1 text-center">
                SMS orqali kelgan 4 xonali kodni kiriting (Test uchun: 1234)
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2 min-h-[44px]"
            >
              {loading ? <span>Tekshirilmoqda...</span> : <span>{uz.auth.verifyAndLogin}</span>}
            </button>
          </form>
        )}

        <div className="pt-2 border-t border-neutral-100">
          <button
            type="button"
            onClick={handleDemoQuickLogin}
            className="w-full py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-medium rounded-lg text-xs transition-colors"
          >
            {uz.auth.demoLogin}
          </button>
        </div>
      </div>
    </div>
  )
}
