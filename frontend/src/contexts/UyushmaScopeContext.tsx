import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { apiClient, errorMessage } from '../services/api/client'

interface UyushmaOption {
  id: number
  name: string
  status: string
}

interface ScopeContext {
  /** Tenant whose data the Uyushma pages show (as a string for existing page APIs). */
  uyushmaId: string | null
  options: UyushmaOption[]
  canSwitch: boolean
  loading: boolean
  /** Why the tenant list could not be loaded: an empty selector must not look like "no tenants". */
  error: string | null
  setUyushmaId: (id: string) => void
  reloadOptions: () => void
}

const Ctx = createContext<ScopeContext | null>(null)
const STORAGE_KEY = 'admin_uyushma_scope'

/**
 * Uyushma admins are pinned to their own tenant. The Super Admin reuses the same management pages
 * and chooses the tenant explicitly (no hidden defaults such as a hardcoded id).
 */
export function UyushmaScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [options, setOptions] = useState<UyushmaOption[]>([])
  const [loading, setLoading] = useState(isAdmin)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })

  const reloadOptions = useCallback(() => {
    if (!isAdmin) return
    setLoading(true)
    setError(null)
    apiClient
      .get<UyushmaOption[]>('/admin/uyushmalar')
      .then((list) => {
        setOptions(list)
        setSelected((prev) => {
          const stillValid = prev && list.some((u) => String(u.id) === prev)
          if (stillValid) return prev
          const firstActive = list.find((u) => u.status === 'active') ?? list[0]
          return firstActive ? String(firstActive.id) : null
        })
      })
      .catch((err) => {
        setOptions([])
        setError(errorMessage(err, "Uyushmalar ro‘yxatini yuklab bo‘lmadi"))
      })
      .finally(() => setLoading(false))
  }, [isAdmin])

  useEffect(reloadOptions, [reloadOptions])

  const setUyushmaId = useCallback((id: string) => {
    setSelected(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // ignore
    }
  }, [])

  const value = useMemo<ScopeContext>(() => {
    if (!isAdmin) {
      const own = user?.uyushma_id ? String(user.uyushma_id) : null
      return {
        uyushmaId: own,
        options: [],
        canSwitch: false,
        loading: false,
        error: null,
        setUyushmaId: () => undefined,
        reloadOptions: () => undefined,
      }
    }
    return { uyushmaId: selected, options, canSwitch: true, loading, error, setUyushmaId, reloadOptions }
  }, [isAdmin, user?.uyushma_id, selected, options, loading, error, setUyushmaId, reloadOptions])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUyushmaScope(): ScopeContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUyushmaScope must be used within UyushmaScopeProvider')
  return ctx
}

/** Selector shown in the admin header when the Super Admin works inside Uyushma pages. */
export function UyushmaScopeSelector() {
  const { canSwitch, options, uyushmaId, setUyushmaId, loading, error, reloadOptions } = useUyushmaScope()
  if (!canSwitch) return null
  if (error) {
    return (
      <button
        type="button"
        className="btn-secondary-action"
        onClick={reloadOptions}
        title={error}
        style={{ fontSize: '0.8125rem' }}
      >
        <i className="ri-error-warning-line" style={{ color: 'var(--danger)' }} />
        Uyushmalar yuklanmadi — qayta urinish
      </button>
    )
  }
  return (
    <label className="uyushma-scope-selector" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem' }}>
      <i className="ri-building-2-line" />
      <select
        value={uyushmaId ?? ''}
        onChange={(e) => setUyushmaId(e.target.value)}
        aria-label="Uyushma tanlash"
        style={{
          background: 'var(--surface-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-medium)',
          borderRadius: '0.5rem',
          padding: '0.35rem 0.5rem',
        }}
      >
        {options.length === 0 && <option value="">{loading ? 'Yuklanmoqda…' : 'Uyushma yo‘q'}</option>}
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
            {u.status !== 'active' ? ' (arxiv)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
