// Shared formatting helpers for every role UI (Uzbek locale, Asia/Tashkent wall clock).

/**
 * Epoch ms for a backend timestamp. The API returns UTC with an explicit offset; a naive
 * string (older data / third-party payloads) is treated as UTC, never as browser-local time.
 */
export function parseUtc(value: string | null | undefined): number {
  if (!value) return Date.now()
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
  return Date.parse(hasZone ? value : `${value}Z`)
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value
  const ms = typeof value === 'number' ? value : parseUtc(value)
  return Number.isNaN(ms) ? null : new Date(ms)
}

export function formatDateTime(value: string | number | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  if (!d) return fallback
  return d.toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatDate(value: string | number | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  if (!d) return fallback
  return d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatTime(value: string | number | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  if (!d) return fallback
  return d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
}

/** "12 500 so‘m" (Uzbek grouping: spaces, typographic apostrophe) */
export function formatSom(amount: number | null | undefined, fallback = '—'): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return fallback
  return `${Math.round(amount).toLocaleString('ru-RU').replace(/,/g, ' ')} so‘m`
}

/** Relative age such as "12 soniya oldin" / "3 daqiqa oldin" (for last-seen GPS, heartbeats). */
export function timeAgo(value: string | number | Date | null | undefined, now = Date.now(), fallback = '—'): string {
  const d = toDate(value)
  if (!d) return fallback
  const sec = Math.max(0, Math.round((now - d.getTime()) / 1000))
  if (sec < 60) return `${sec} soniya oldin`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} daqiqa oldin`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours} soat oldin`
  return formatDateTime(d)
}

/**
 * Uzbek phone number as the backend expects it (+998XXXXXXXXX). Accepts spaces/dashes, a missing
 * country code and a doubled prefix from pre-filled inputs ("+998 +998901234567").
 * The backend still validates the result.
 */
export function normalizeUzPhone(value: string): string {
  let digits = value.replace(/\D/g, '')
  while (digits.length > 12 && digits.startsWith('998998')) digits = digits.slice(3)
  if (digits.length === 9) digits = `998${digits}`
  return digits ? `+${digits}` : value.trim()
}
