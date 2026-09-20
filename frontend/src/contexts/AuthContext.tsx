import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiClient, AUTH_EXPIRED_EVENT, getToken, TOKEN_KEY } from '../services/api/client'
import { nativeBridge } from '../services/nativeBridge'
import { normalizeUzPhone } from '../utils/format'
import {
  mapBackendRole,
  type AuthState,
  type AuthUser,
  type BackendRole,
  type LoginCredentials,
  type RegisterPayload,
  type UserRole,
} from '../types/auth'

interface AuthContextType extends AuthState {
  login: (creds: LoginCredentials) => Promise<AuthUser>
  register: (payload: RegisterPayload) => Promise<AuthUser>
  logout: () => void
  refreshMe: () => Promise<AuthUser | null>
  hasRole: (role: UserRole | UserRole[]) => boolean
}

interface MeResponse {
  id: number
  phone: string
  full_name: string
  email?: string | null
  role: BackendRole
  uyushma_id?: number | null
  uyushma_name?: string | null
  driver_id?: number | null
  vehicle_id?: number | null
  vehicle_internal_id?: string | null
  route_id?: number | null
}

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

const AuthContext = createContext<AuthContextType | null>(null)
const LEGACY_USER_KEY = 'auth_user'
const FCM_REGISTERED_KEY = 'fcm_registered_token'
/** Renew the token when less than this is left, checked periodically and when the tab is shown. */
const REFRESH_BEFORE_MS = 2 * 60 * 60 * 1000
const REFRESH_CHECK_INTERVAL_MS = 15 * 60 * 1000

function toAuthUser(me: MeResponse): AuthUser {
  return { ...me, backend_role: me.role, role: mapBackendRole(me.role) }
}

/** Expiry (epoch ms) encoded in the JWT, or null when it cannot be read. */
function tokenExpiryMs(token: string | null): number | null {
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(LEGACY_USER_KEY)
  } catch {
    // storage unavailable (private mode): session lives in memory only
  }
}

/** Registers the wrapper's FCM token for the signed-in user (once per token; retried on next event). */
async function registerNativePushToken() {
  if (!nativeBridge.isNative()) return
  try {
    const token = await nativeBridge.getFcmToken()
    if (!token || localStorage.getItem(FCM_REGISTERED_KEY) === token) return
    await apiClient.post('/notifications/device-token', {
      token,
      platform: nativeBridge.getPlatform() === 'ios' ? 'ios' : 'android',
    })
    localStorage.setItem(FCM_REGISTERED_KEY, token)
  } catch {
    // push is best-effort; the in-app notification list still works
  }
}

function unregisterNativePushToken() {
  // Must start before the auth token is cleared: the request captures the Authorization header synchronously
  try {
    const token = localStorage.getItem(FCM_REGISTERED_KEY)
    if (!token) return
    localStorage.removeItem(FCM_REGISTERED_KEY)
    apiClient.delete('/notifications/device-token', { query: { token } }).catch(() => undefined)
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => ({
    user: null,
    token: getToken(),
    isAuthenticated: false,
    isLoading: Boolean(getToken()),
  }))

  const loadMe = useCallback(async (): Promise<AuthUser> => {
    const me = await apiClient.get<MeResponse>('/auth/me')
    const user = toAuthUser(me)
    setState({ user, token: getToken(), isAuthenticated: true, isLoading: false })
    return user
  }, [])

  const logout = useCallback(() => {
    unregisterNativePushToken()
    storeToken(null)
    setState({ user: null, token: null, isAuthenticated: false, isLoading: false })
  }, [])

  // Restore the session from the stored token (validated by the backend, never trusted blindly)
  useEffect(() => {
    if (!getToken()) {
      setState((prev) => ({ ...prev, isLoading: false }))
      return
    }
    loadMe().catch(() => {
      storeToken(null)
      setState({ user: null, token: null, isAuthenticated: false, isLoading: false })
    })
  }, [loadMe])

  // Push registration for every signed-in session (also restored sessions and refreshed FCM tokens)
  const signedIn = state.isAuthenticated
  useEffect(() => {
    if (!signedIn) return
    void registerNativePushToken()
    const onNativeReady = () => void registerNativePushToken()
    window.addEventListener('MashrutGoNativeReady', onNativeReady)
    return () => window.removeEventListener('MashrutGoNativeReady', onNativeReady)
  }, [signedIn])

  // Any 401 from the API means the token is no longer valid
  useEffect(() => {
    const onExpired = () => logout()
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [logout])

  const login = useCallback(
    async (creds: LoginCredentials) => {
      setState((prev) => ({ ...prev, isLoading: true }))
      try {
        const data = await apiClient.post<TokenResponse>(
          '/auth/login',
          { ...creds, phone: normalizeUzPhone(creds.phone) },
          { anonymous: true },
        )
        storeToken(data.access_token)
        return await loadMe()
      } catch (err) {
        storeToken(null)
        setState({ user: null, token: null, isAuthenticated: false, isLoading: false })
        throw err
      }
    },
    [loadMe],
  )

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const data = await apiClient.post<TokenResponse>(
        '/auth/register-client',
        { ...payload, phone: normalizeUzPhone(payload.phone) },
        { anonymous: true },
      )
      storeToken(data.access_token)
      return await loadMe()
    },
    [loadMe],
  )

  const refreshMe = useCallback(async () => {
    if (!getToken()) return null
    try {
      return await loadMe()
    } catch {
      return null
    }
  }, [loadMe])

  // Long driver shifts must not end because the access token expired: renew it ahead of time
  useEffect(() => {
    if (!state.isAuthenticated) return
    let cancelled = false
    const renewIfNeeded = async () => {
      const expiry = tokenExpiryMs(getToken())
      if (expiry === null || expiry - Date.now() > REFRESH_BEFORE_MS) return
      try {
        const data = await apiClient.post<TokenResponse>('/auth/refresh')
        if (!cancelled) {
          storeToken(data.access_token)
          setState((prev) => ({ ...prev, token: data.access_token }))
        }
      } catch {
        // 401 is handled by the session-expired listener; other errors are retried on the next tick
      }
    }
    void renewIfNeeded()
    const timer = setInterval(renewIfNeeded, REFRESH_CHECK_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void renewIfNeeded()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [state.isAuthenticated])

  const hasRole = useCallback(
    (role: UserRole | UserRole[]) => {
      if (!state.user) return false
      return Array.isArray(role) ? role.includes(state.user.role) : state.user.role === role
    },
    [state.user],
  )

  const value = useMemo(
    () => ({ ...state, login, register, logout, refreshMe, hasRole }),
    [state, login, register, logout, refreshMe, hasRole],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
