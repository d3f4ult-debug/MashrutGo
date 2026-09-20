// Shared building blocks for the Super Admin pages: state blocks, toast, confirm dialog,
// pagination and human-readable labels for backend codes (audit actions, roles, directions).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

// ---------------------------------------------------------------- labels

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'uyushma.create': 'Uyushma yaratildi',
  'uyushma.update': 'Uyushma tahrirlandi',
  'uyushma.archive': 'Uyushma arxivlandi',
  'client.registered': 'Mijoz ro‘yxatdan o‘tdi',
  'client.block': 'Mijoz bloklandi',
  'client.unblock': 'Mijoz blokdan chiqarildi',
  'wallet.adjust': 'Hamyon qo‘lda tuzatildi',
  'wallet.topup.created': 'Hamyonni to‘ldirish boshlandi',
  'wallet.topup.completed': 'Hamyon to‘ldirildi',
  'shift.start': 'Smena boshlandi',
  'shift.end': 'Smena yakunlandi',
  'shift.force_end': 'Smena majburan yakunlandi',
  'settings.update': 'Tizim sozlamalari o‘zgartirildi',
  'route.create': 'Yo‘nalish yaratildi',
  'route.update': 'Yo‘nalish tahrirlandi',
  'route.archive': 'Yo‘nalish arxivlandi',
  'route.publish': 'Yo‘nalish nashr etildi',
  'route.unpublish': 'Yo‘nalish nashrdan olindi',
  'direction.save': 'Yo‘nalish chizig‘i saqlandi',
  'direction.upsert': 'Yo‘nalish chizig‘i saqlandi',
  'driver.create': 'Haydovchi qo‘shildi',
  'driver.update': 'Haydovchi tahrirlandi',
  'driver.deactivate': 'Haydovchi o‘chirildi',
  'vehicle.create': 'Transport qo‘shildi',
  'vehicle.update': 'Transport tahrirlandi',
  'vehicle.deactivate': 'Transport o‘chirildi',
  'parking.create': 'Stoyanka qo‘shildi',
  'parking.update': 'Stoyanka tahrirlandi',
  'parking.deactivate': 'Stoyanka o‘chirildi',
  'fare.create': 'Tarif qo‘shildi',
  'fare.update': 'Tarif tahrirlandi',
  'fare.deactivate': 'Tarif o‘chirildi',
  'payment.completed': 'Yo‘l haqi to‘landi',
  'payment.refund': 'To‘lov qaytarildi',
  'payment.refunded': 'To‘lov qaytarildi',
  'cashout.requested': 'Pul yechish so‘raldi',
  'cashout.approve': 'Pul yechish tasdiqlandi',
  'cashout.approved': 'Pul yechish tasdiqlandi',
  'cashout.rejected': 'Pul yechish rad etildi',
  'cashout.paid': 'Pul yechish to‘landi',
  'user.login': 'Tizimga kirish',
  'user.password_changed': 'Parol o‘zgartirildi',
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action
}

export type AuditTone = 'danger' | 'finance' | 'settings' | 'create' | 'neutral'

export function auditActionTone(action: string): AuditTone {
  if (/(\.archive|\.block|force_end|deactivate|reject|refund)/.test(action)) return 'danger'
  if (/^(wallet|payment|cashout)\./.test(action)) return 'finance'
  if (/^settings\./.test(action)) return 'settings'
  if (/(\.create|registered|\.publish|\.start|unblock)/.test(action)) return 'create'
  return 'neutral'
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Super Admin',
  uyushma_admin: 'Uyushma admini',
  driver: 'Haydovchi',
  client: 'Mijoz',
}

export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Tizim'
  return ROLE_LABELS[role] ?? role
}

export function directionLabel(direction: string): string {
  if (direction === 'outbound') return 'Borish'
  if (direction === 'inbound') return 'Qaytish'
  return direction
}

export const AUDIT_TARGET_TYPES: { value: string; label: string }[] = [
  { value: 'uyushma', label: 'Uyushma' },
  { value: 'user', label: 'Foydalanuvchi' },
  { value: 'wallet', label: 'Hamyon' },
  { value: 'shift', label: 'Smena' },
  { value: 'settings', label: 'Sozlamalar' },
  { value: 'route', label: 'Yo‘nalish' },
  { value: 'driver', label: 'Haydovchi' },
  { value: 'vehicle', label: 'Transport' },
  { value: 'parking', label: 'Stoyanka' },
  { value: 'fare_rule', label: 'Tarif' },
  { value: 'payment', label: 'To‘lov' },
  { value: 'cashout', label: 'Pul yechish' },
  { value: 'provider_transaction', label: 'To‘lov provayderi' },
]

export function targetTypeLabel(type: string | null | undefined): string {
  if (!type) return '—'
  return AUDIT_TARGET_TYPES.find((t) => t.value === type)?.label ?? type
}

// ---------------------------------------------------------------- state blocks

export function LoadingState({ label = 'Yuklanmoqda...' }: { label?: string }) {
  return (
    <div className="admin-state" role="status">
      <i className="ri-loader-4-line admin-spin admin-state__icon admin-state__icon--accent" />
      <p>{label}</p>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="admin-state admin-state--error" role="alert">
      <i className="ri-error-warning-line admin-state__icon" />
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn-secondary-action" onClick={onRetry}>
          <i className="ri-refresh-line" /> Qayta urinish
        </button>
      )}
    </div>
  )
}

export function EmptyState({ icon = 'ri-inbox-line', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="admin-state">
      <i className={`${icon} admin-state__icon`} />
      <p>{title}</p>
      {hint && <span className="admin-state__hint">{hint}</span>}
    </div>
  )
}

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'warning' | 'info' | 'success'; children: ReactNode }) {
  const icon = {
    danger: 'ri-error-warning-fill',
    warning: 'ri-alert-fill',
    info: 'ri-information-fill',
    success: 'ri-checkbox-circle-fill',
  }[tone]
  return (
    <div className={`admin-alert ${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <i className={icon} />
      <div>{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------- toast

export interface ToastState {
  tone: 'success' | 'danger'
  message: string
}

export function useToast(timeoutMs = 5000) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(
    (message: string, tone: ToastState['tone'] = 'success') => {
      if (timer.current) clearTimeout(timer.current)
      setToast({ message, tone })
      timer.current = setTimeout(() => setToast(null), timeoutMs)
    },
    [timeoutMs],
  )
  const hide = useCallback(() => setToast(null), [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return { toast, show, hide }
}

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  if (!toast) return null
  return (
    <div className={`admin-toast ${toast.tone}`} role="status" aria-live="polite">
      <i className={toast.tone === 'success' ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} />
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Yopish">
        <i className="ri-close-line" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- modal / confirm dialog

interface ModalProps {
  title: ReactNode
  icon?: string
  iconColor?: string
  onClose: () => void
  /** While true the dialog cannot be dismissed (request in flight). */
  busy?: boolean
  children: ReactNode
  footer?: ReactNode
  maxWidth?: number
  onSubmit?: () => void
}

export function AdminModal({ title, icon, iconColor, onClose, busy, children, footer, maxWidth, onSubmit }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const body = (
    <>
      <div className="uyushma-modal-body">{children}</div>
      {footer && <div className="uyushma-modal-footer">{footer}</div>}
    </>
  )

  return (
    <div className="uyushma-modal-overlay" onClick={() => !busy && onClose()}>
      <div
        className="uyushma-modal-card"
        style={maxWidth ? { maxWidth } : undefined}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="uyushma-modal-header">
          <h3>
            {icon && <i className={icon} style={{ color: iconColor ?? 'var(--admin-accent)' }} />}
            {title}
          </h3>
          <button type="button" className="btn-table-action" onClick={onClose} disabled={busy} aria-label="Yopish">
            <i className="ri-close-line" />
          </button>
        </div>
        {onSubmit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onSubmit()
            }}
            noValidate
          >
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- pagination

export function Pagination({
  page,
  pages,
  total,
  size,
  disabled,
  onPage,
}: {
  page: number
  pages: number
  total: number
  size: number
  disabled?: boolean
  onPage: (page: number) => void
}) {
  if (total === 0) return null
  const from = (page - 1) * size + 1
  const to = Math.min(total, page * size)
  return (
    <div className="admin-pagination">
      <span>
        {from.toLocaleString('ru-RU')}–{to.toLocaleString('ru-RU')} / jami {total.toLocaleString('ru-RU')}
      </span>
      <div className="admin-pagination__buttons">
        <button type="button" className="btn-secondary-action" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>
          <i className="ri-arrow-left-s-line" /> Oldingi
        </button>
        <span className="admin-pagination__page">
          {page} / {pages}
        </span>
        <button type="button" className="btn-secondary-action" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)}>
          Keyingi <i className="ri-arrow-right-s-line" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- hooks

/** Debounced copy of `value` (for server-side search inputs). */
export function useDebounced<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
