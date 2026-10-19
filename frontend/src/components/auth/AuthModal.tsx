import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '@/services/auth/AuthProvider'
import { API_BASE } from '@/services/api/client'
import { uz } from '@/locales/uz'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

/**
 * Strict Uzbekistan phone number formatter (+998 99 999 99 99)
 */
function formatUzPhone(value: string): string {
  let raw = value.replace(/\D/g, '')
  if (raw.startsWith('998')) {
    raw = raw.slice(3)
  }
  // Exactly max 9 digits after 998
  raw = raw.slice(0, 9)

  let formatted = '+998'
  if (raw.length > 0) formatted += ' ' + raw.slice(0, 2)
  if (raw.length > 2) formatted += ' ' + raw.slice(2, 5)
  if (raw.length > 5) formatted += ' ' + raw.slice(5, 7)
  if (raw.length > 7) formatted += ' ' + raw.slice(7, 9)
  return formatted
}

export default function AuthModal({ isOpen, onClose, onSuccess }: Props) {
  const { signin } = useAuth()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('+998 ')
  const [smsCode, setSmsCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.value
    if (nextVal.length < 4) {
      setPhone('+998 ')
      return
    }
    setPhone(formatUzPhone(nextVal))
  }

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    const digits = phone.replace(/\D/g, '').slice(3)
    if (digits.length !== 9) {
      setError('Telefon raqamini to‘liq kiriting: +998 99 999 99 99 (9 ta raqam)')
      return
    }
    if (!fullName.trim()) {
      setError('Iltimos, ism va familiyangizni kiriting')
      return
    }
    setError(null)
    setLoading(true)

    const cleanPhone = '+998' + digits
    try {
      const res = await fetch(`${API_BASE}/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone, purpose: 'signup' }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setCodeSent(true)
      } else {
        setError(data.detail || 'SMS yuborishda xatolik yuz berdi')
      }
    } catch {
      setCodeSent(true)
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!smsCode.trim()) {
      setError('Tasdiqlash kodini kiriting')
      return
    }
    setError(null)
    setLoading(true)

    const cleanPhone = '+998' + phone.replace(/\D/g, '').slice(3)

    try {
      const res = await fetch(`${API_BASE}/auth/login-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanPhone,
          code: smsCode.trim(),
          full_name: fullName.trim() || undefined,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.detail || 'Tasdiqlash kodi noto‘g‘ri!')
        setLoading(false)
        return
      }

      localStorage.setItem('auth_token', data.access_token)
      localStorage.setItem('auth_user', JSON.stringify(data.user))
      localStorage.setItem('mashrutgo_wallet_balance', '0')
      localStorage.setItem('mashrutgo_wallet_transactions', '[]')
      signin({
        id: String(data.user.id),
        name: data.user.full_name || fullName.trim() || 'Yo‘lovchi',
        roles: [data.user.role || 'client']
      })
      onSuccess?.()
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Tarmoqqa ulanishda xatolik yuz berdi')
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn overflow-y-auto">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden border border-neutral-100 p-6 space-y-4 my-auto max-h-[90vh]">
        <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
          <div>
            <h3 className="text-lg font-bold text-neutral-900">
              {codeSent ? 'Tasdiqlash kodi' : 'Tizimga kirish / Ro‘yxatdan o‘tish'}
            </h3>
            <p className="text-xs text-neutral-500">
              {codeSent ? `${phone} raqamiga yuborildi` : 'Hamyon va to‘lovlardan foydalanish uchun kiring'}
            </p>
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
          <form onSubmit={handleSendCode} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                Ism va familiyangiz
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-neutral-400">
                  <i className="ri-user-3-line"></i>
                </span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Masalan: Alisher Usmonov"
                  className="w-full pl-9 pr-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                {uz.auth.phoneLabel} (O‘zbekiston)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-neutral-400">
                  <i className="ri-phone-line"></i>
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={handlePhoneChange}
                  placeholder="+998 99 999 99 99"
                  maxLength={17}
                  className="w-full pl-9 pr-3 py-2 border border-neutral-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <p className="text-[11px] text-neutral-400 mt-1">
                Format: +998 XX XXX XX XX (aniq 9 ta raqam)
              </p>
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
                  <span>SMS kod olish</span>
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
                placeholder="____"
                className="w-full text-center tracking-widest text-xl font-bold py-2.5 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2 min-h-[44px]"
            >
              {loading ? <span>Tekshirilmoqda...</span> : <span>Tasdiqlash va kirish</span>}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body
  )
}
