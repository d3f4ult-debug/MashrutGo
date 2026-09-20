// Centralized HTTP client for the Dev1 backend (OpenAPI: /api/v1/docs).
// - Same-origin `/api/v1` by default (Vite dev proxy / reverse proxy in production)
// - Typed ApiError with HTTP status and backend `detail`
// - 401 => session expired event (AuthContext logs the user out)
// - No silent fallbacks: callers must render loading / error / empty states.

export const TOKEN_KEY = 'auth_token'
export const AUTH_EXPIRED_EVENT = 'mashrutgo:auth-expired'

const RAW_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api/v1'
export const API_BASE = String(RAW_BASE).replace(/\/$/, '')
const DEFAULT_TIMEOUT_MS = 20_000

export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }

  get isNetworkError(): boolean {
    return this.status === 0
  }
}

export type QueryValue = string | number | boolean | null | undefined
export type Query = Record<string, QueryValue>

interface RequestOptions {
  query?: Query
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  /** Send the request without the Authorization header (public endpoints). */
  anonymous?: boolean
}

export function getToken(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
  } catch {
    return null
  }
}

function buildUrl(path: string, query?: Query): string {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value))
  })
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

function describeDetail(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{loc, msg, type}]
    const messages = detail
      .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : ''))
      .filter(Boolean)
    if (messages.length) return messages.join('; ').replace(/^Value error, /, '')
  }
  return fallback
}

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = options.anonymous ? null : getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  // A caller whose effect already cleaned up passes an aborted signal: never open the request.
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort)

  let res: Response
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    throw new ApiError(0, offline ? 'Internet aloqasi yo‘q' : 'Serverga ulanib bo‘lmadi', err)
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }

  if (res.status === 204) return undefined as T

  let payload: unknown = null
  const text = await res.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!res.ok) {
    const detail = payload && typeof payload === 'object' && 'detail' in payload ? (payload as { detail: unknown }).detail : payload
    if (res.status === 401 && token && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
    }
    throw new ApiError(res.status, describeDetail(detail, `Xatolik (HTTP ${res.status})`), detail)
  }
  return payload as T
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, body ?? undefined, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, body ?? undefined, options),
  delete: <T = void>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),
}

/** Human readable message for any thrown value (for UI error states). */
export function errorMessage(err: unknown, fallback = 'Xatolik yuz berdi'): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error && err.message) return err.message
  return fallback
}

/** Idempotency keys for money-moving requests (safe retries). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** WebSocket base: VITE_WS_BASE or derived from the page origin (same host as the API proxy). */
export function wsUrl(path: string, query?: Query): string {
  const configured = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_BASE) || ''
  let base = String(configured).replace(/\/$/, '')
  if (!base) {
    if (API_BASE.startsWith('http')) {
      base = `${API_BASE.replace(/^http/, 'ws')}/ws`
    } else if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      base = `${proto}//${window.location.host}${API_BASE}/ws`
    }
  }
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url
  const params = new URLSearchParams()
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.append(k, String(v))
  })
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}
