import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { adminApi } from '../../services/api/adminApi'
import { errorMessage } from '../../services/api/client'
import { useUyushmaScope } from '../../contexts/UyushmaScopeContext'
import { formatDateTime, timeAgo } from '../../utils/format'
import type { AuditLogEntry, AuditLogFilters, Paginated } from '../../types/admin'
import {
  AUDIT_TARGET_TYPES,
  Alert,
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
  auditActionLabel,
  auditActionTone,
  isAbortError,
  roleLabel,
  targetTypeLabel,
  useDebounced,
} from './adminShared'
import './AdminOperations.css'
import '../uyushma/UyushmaOperations.css'

const PAGE_SIZE = 50

const ACTION_PRESETS: { value: string; label: string }[] = [
  { value: 'uyushma.', label: 'Uyushmalar' },
  { value: 'client.', label: 'Mijozlar' },
  { value: 'wallet.', label: 'Hamyonlar' },
  { value: 'shift.', label: 'Smenalar' },
  { value: 'settings.', label: 'Sozlamalar' },
  { value: 'route.', label: 'Yo‘nalishlar' },
  { value: 'payment.', label: 'To‘lovlar' },
  { value: 'cashout.', label: 'Pul yechish' },
  { value: 'user.', label: 'Kirishlar' },
]

interface OldNew {
  old: unknown
  new: unknown
}

function isOldNewMap(changes: unknown): changes is Record<string, OldNew> {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return false
  const values = Object.values(changes as Record<string, unknown>)
  return (
    values.length > 0 &&
    values.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v) && 'old' in (v as object) && 'new' in (v as object))
  )
}

function show(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function hasChanges(changes: unknown): boolean {
  if (changes === null || changes === undefined) return false
  if (typeof changes === 'object') return Object.keys(changes as object).length > 0
  return true
}

export function AdminAudit() {
  const { options: uyushmaOptions } = useUyushmaScope()

  const [actionInput, setActionInput] = useState('')
  const action = useDebounced(actionInput.trim(), 400)
  const [targetType, setTargetType] = useState('')
  const [uyushmaId, setUyushmaId] = useState('')
  const [actorInput, setActorInput] = useState('')
  const actorId = useDebounced(actorInput.trim(), 400)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const filterKey = JSON.stringify([action, targetType, uyushmaId, actorId, dateFrom, dateTo])
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 })
  const page = pageState.key === filterKey ? pageState.page : 1

  const [data, setData] = useState<Paginated<AuditLogEntry> | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const abortRef = useRef<AbortController | null>(null)

  const rangeError = dateFrom && dateTo && dateFrom > dateTo ? '“Dan” sanasi “gacha” sanasidan keyin bo‘lmasligi kerak' : null
  const actorError = actorId && !/^\d+$/.test(actorId) ? 'Ijrochi ID faqat raqam bo‘lishi kerak' : null

  const filters: AuditLogFilters = useMemo(
    () => ({
      action: action || undefined,
      target_type: targetType || undefined,
      uyushma_id: uyushmaId || undefined,
      actor_user_id: actorId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      page,
      size: PAGE_SIZE,
    }),
    [action, targetType, uyushmaId, actorId, dateFrom, dateTo, page],
  )

  const load = useCallback(async (f: AuditLogFilters) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsLoading(true)
    setLoadError(null)
    try {
      const result = await adminApi.getAuditLogs(f, controller.signal)
      if (controller.signal.aborted) return
      setData(result)
      setExpanded(new Set())
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return
      setLoadError(errorMessage(err, 'Audit jurnalini yuklab bo‘lmadi'))
    } finally {
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (rangeError || actorError) return
    load(filters)
  }, [load, filters, rangeError, actorError])

  useEffect(() => () => abortRef.current?.abort(), [])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const hasFilters = Boolean(actionInput || targetType || uyushmaId || actorInput || dateFrom || dateTo)
  const clearFilters = () => {
    setActionInput('')
    setTargetType('')
    setUyushmaId('')
    setActorInput('')
    setDateFrom('')
    setDateTo('')
  }

  const items = data?.items ?? []

  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div className="admin-page-header__left">
          <h1>
            <i className="ri-shield-check-line" style={{ color: 'var(--admin-accent)' }} />
            Audit jurnali
          </h1>
          <p>Ma’muriy, moliyaviy va xavfsizlik amallarining o‘zgarmas tarixi</p>
        </div>
        <div className="uyushma-page-header__actions">
          <button type="button" className="btn-secondary-action" onClick={() => load(filters)} disabled={isLoading || Boolean(rangeError || actorError)}>
            <i className={isLoading ? 'ri-loader-4-line admin-spin' : 'ri-refresh-line'} />
            Yangilash
          </button>
        </div>
      </div>

      <div className="admin-filter-bar">
        <label className="admin-field" style={{ flex: '1 1 220px' }}>
          <span>Amal</span>
          <input
            className="uyushma-input admin-mono"
            type="search"
            placeholder="masalan: client.block yoki wallet."
            value={actionInput}
            maxLength={100}
            onChange={(e) => setActionInput(e.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Obyekt turi</span>
          <select className="uyushma-select" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
            <option value="">Barchasi</option>
            {AUDIT_TARGET_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} ({t.value})
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Uyushma</span>
          <select className="uyushma-select" value={uyushmaId} onChange={(e) => setUyushmaId(e.target.value)}>
            <option value="">Barchasi</option>
            {uyushmaOptions.map((u) => (
              <option key={u.id} value={String(u.id)}>
                {u.name}
                {u.status !== 'active' ? ' (arxiv)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field" style={{ width: 110 }}>
          <span>Ijrochi ID</span>
          <input
            className={`uyushma-input${actorError ? ' invalid' : ''}`}
            inputMode="numeric"
            value={actorInput}
            onChange={(e) => setActorInput(e.target.value)}
            placeholder="#"
            style={{ minWidth: 0 }}
          />
        </label>
        <label className="admin-field">
          <span>Sanadan</span>
          <input className={`uyushma-input${rangeError ? ' invalid' : ''}`} type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="admin-field">
          <span>Sanagacha</span>
          <input className={`uyushma-input${rangeError ? ' invalid' : ''}`} type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        {hasFilters && (
          <button type="button" className="btn-secondary-action" onClick={clearFilters}>
            <i className="ri-filter-off-line" /> Tozalash
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {ACTION_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`btn-admin-chip${actionInput === p.value ? ' accent' : ''}`}
            onClick={() => setActionInput(actionInput === p.value ? '' : p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {(rangeError || actorError) && <Alert tone="warning">{rangeError ?? actorError}</Alert>}
      {loadError && data && <Alert>Jurnalni yangilab bo‘lmadi: {loadError}</Alert>}

      <div className="admin-panel">
        {!data && isLoading ? (
          <LoadingState label="Audit jurnali yuklanmoqda..." />
        ) : !data ? (
          <ErrorState message={loadError ?? 'Audit jurnalini yuklab bo‘lmadi'} onRetry={() => load(filters)} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="ri-file-search-line"
            title={hasFilters ? 'Filtrlarga mos audit yozuvi topilmadi' : 'Audit jurnali hozircha bo‘sh'}
          />
        ) : (
          <>
            <div className="uyushma-table-wrapper">
              <table className="uyushma-table">
                <thead>
                  <tr>
                    <th>Vaqt</th>
                    <th>Amal</th>
                    <th>Ijrochi</th>
                    <th>Obyekt</th>
                    <th>Sabab</th>
                    <th>IP</th>
                    <th aria-label="O‘zgarishlar" />
                  </tr>
                </thead>
                <tbody style={{ opacity: isLoading ? 0.6 : 1 }}>
                  {items.map((log) => {
                    const isOpen = expanded.has(log.id)
                    const withChanges = hasChanges(log.changes)
                    return (
                      <Fragment key={log.id}>
                        <tr className={isOpen ? 'audit-row--expanded' : undefined}>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <div style={{ fontSize: '0.8rem' }}>{formatDateTime(log.created_at)}</div>
                            <div className="admin-muted">{timeAgo(log.created_at)}</div>
                          </td>
                          <td>
                            <span className={`audit-badge ${auditActionTone(log.action)}`}>{auditActionLabel(log.action)}</span>
                            <div className="admin-muted admin-mono" style={{ marginTop: '0.25rem' }}>
                              {log.action}
                            </div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{log.actor_name ?? (log.actor_user_id ? `Foydalanuvchi #${log.actor_user_id}` : 'Tizim')}</div>
                            <div className="admin-muted">
                              {roleLabel(log.actor_role)}
                              {log.actor_user_id ? ` • #${log.actor_user_id}` : ''}
                            </div>
                          </td>
                          <td>
                            {log.target_type ? (
                              <>
                                <div style={{ fontSize: '0.82rem' }}>{targetTypeLabel(log.target_type)}</div>
                                <div className="admin-muted admin-mono">
                                  {log.target_type}
                                  {log.target_id ? `:${log.target_id}` : ''}
                                </div>
                              </>
                            ) : (
                              <span className="admin-muted">—</span>
                            )}
                            {log.uyushma_id && (
                              <div className="admin-muted">
                                Uyushma: {uyushmaOptions.find((u) => String(u.id) === log.uyushma_id)?.name ?? `#${log.uyushma_id}`}
                              </div>
                            )}
                          </td>
                          <td style={{ maxWidth: 260 }}>
                            {log.reason ? <div className="audit-reason" style={{ marginTop: 0 }}>{log.reason}</div> : <span className="admin-muted">—</span>}
                          </td>
                          <td className="admin-muted admin-mono">{log.ip_address ?? '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            {withChanges && (
                              <button
                                type="button"
                                className="btn-admin-chip"
                                onClick={() => toggle(log.id)}
                                aria-expanded={isOpen}
                              >
                                <i className={isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                                O‘zgarishlar
                              </button>
                            )}
                          </td>
                        </tr>
                        {isOpen && withChanges && (
                          <tr className="audit-row--expanded">
                            <td colSpan={7} className="audit-details-cell">
                              {isOldNewMap(log.changes) && (
                                <table className="uyushma-table" style={{ marginBottom: '0.75rem' }}>
                                  <thead>
                                    <tr>
                                      <th>Maydon</th>
                                      <th>Oldin</th>
                                      <th>Keyin</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {Object.entries(log.changes).map(([field, diff]) => (
                                      <tr key={field}>
                                        <td className="admin-mono">{field}</td>
                                        <td className="admin-muted admin-mono">{show(diff.old)}</td>
                                        <td className="admin-mono" style={{ fontWeight: 700 }}>
                                          {show(diff.new)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                              <pre className="admin-json">{prettyJson(log.changes)}</pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              size={data.size}
              disabled={isLoading}
              onPage={(p) => setPageState({ key: filterKey, page: p })}
            />
          </>
        )}
      </div>
    </div>
  )
}
