import React, { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage } from '@/services/api/client'
import { uz } from '@/locales/uz'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

type Mode = 'login' | 'register'

/** Passenger sign-in / sign-up with phone + password (backend /auth/login, /auth/register-client). */
export default function AuthModal({ isOpen, onClose, onSuccess }: Props) {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [phone, setPhone] = useState('+998 ')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (mode === 'register' && password.length < 8) {
      setError('Parol kamida 8 ta belgidan iborat bo‘lishi kerak')
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') {
        const user = await login({ phone, password })
        if (user.role !== 'client') {
          setError('Bu xodim akkaunti. Xodimlar paneliga /login orqali kiring.')
          return
        }
      } else {
        await register({ phone, password, full_name: fullName.trim() })
      }
      setPassword('')
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Kirishda xatolik'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-neutral-100 p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
          <div>
            <h3 className="text-lg font-bold text-neutral-900">{mode === 'login' ? uz.auth.title : 'Ro‘yxatdan o‘tish'}</h3>
            <p className="text-xs text-neutral-500">{uz.auth.subtitle}</p>
          </div>
          <button onClick={onClose} aria-label="Yopish" className="p-1 rounded-full text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100">
            <i className="ri-close-line text-xl"></i>
          </button>
        </div>

        <div className="flex bg-neutral-100 rounded-xl p-1 text-xs font-semibold">
          {(['login', 'register'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                setError(null)
              }}
              className={`flex-1 py-1.5 rounded-lg ${mode === m ? 'bg-white shadow-xs text-blue-700' : 'text-neutral-600'}`}
            >
              {m === 'login' ? 'Kirish' : 'Yangi hisob'}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-center gap-2">
            <i className="ri-error-warning-fill text-sm"></i>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <label className="block">
              <span className="block text-xs font-semibold text-neutral-700 mb-1">Ism-familiya</span>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                minLength={2}
                autoComplete="name"
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          )}
          <label className="block">
            <span className="block text-xs font-semibold text-neutral-700 mb-1">{uz.auth.phoneLabel}</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={uz.auth.phonePlaceholder}
              autoComplete="tel"
              required
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-neutral-700 mb-1">Parol</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'register' ? 8 : 4}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg text-sm min-h-[44px]"
          >
            {loading ? 'Kuting…' : mode === 'login' ? 'Kirish' : 'Hisob yaratish'}
          </button>
        </form>
      </div>
    </div>
  )
}
