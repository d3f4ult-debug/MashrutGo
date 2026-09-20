import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi } from '../../services/api/adminApi'
import { ApiError, errorMessage } from '../../services/api/client'
import { formatDateTime, formatTime, timeAgo } from '../../utils/format'
import type { AdminLiveShift } from '../../types/admin'
import {
  AdminModal,
  Alert,
  EmptyState,
  ErrorState,
  LoadingState,
  Toast,
  directionLabel,
  isAbortError,
  useToast,
} from './adminShared'
import './AdminOperations.css'
import '../uyushma/UyushmaOperations.css'

const REFRESH_MS = 15_000
const CLOCK_TICK_MS = 5_000

type GpsFilter = 'all' | 'online' | 'lost'

export function AdminShifts() {
  const { toast, show: showToast, hide: hideToast } = useToast()

  const [shifts, setShifts] = useState<AdminLiveShift[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [autoRefresh, setAutoRefresh] = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const inFlight = useRef(false)

  const [search, setSearch] = useState('')
  const [gpsFilter, setGpsFilter] = useState<GpsFilter>('all')
  const [uyushmaFilter, setUyushmaFilter] = useState('')

  const [target, setTarget] = useState<AdminLiveShift | null>(null)
  const [reason, setReason] = useState('')
  const [endError, setEndError] = useState<string | null>(null)
  const [isEnding, setIsEnding] = useState(false)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    inFlight.current = true
    setIsLoading(true)
    try {
      const list = await adminApi.getLiveShifts(controller.signal)
      if (controller.signal.aborted) return
      setShifts(list)
      setLoadError(null)
      setUpdatedAt(Date.now())
      setNow(Date.now())
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return
      setLoadError(errorMessage(err, 'Jonli smenalarni yuklab bo‘lmadi'))
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false)
        inFlight.current = false
      }
    }
  }, [])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  // Auto-refresh (~15 s) while the tab is visible; the clock tick keeps "N soniya oldin" fresh between polls.
  useEffect(() => {
    if (!autoRefresh) return
    const poll = setInterval(() => {
      if (inFlight.current) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      load()
    }, REFRESH_MS)
    return () => clearInterval(poll)
  }, [autoRefresh, load])

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(tick)
  }, [])

  const openForceEnd = (s: AdminLiveShift) => {
    setTarget(s)
    setReason('')
    setEndError(null)
  }

  const handleForceEnd = async () => {
    if (!target) return
    setEndError(null)
    setIsEnding(true)
    try {
      await adminApi.forceEndShift(target.id, reason)
      setShifts((prev) => prev?.filter((s) => s.id !== target.id) ?? prev)
      showToast(`${target.driver_name} smenasi majburan yakunlandi. Haydovchiga xabar yuborildi.`)
      setTarget(null)
      load()
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setEndError('Bu smena allaqachon yakunlangan. Ro‘yxat yangilandi.')
        setShifts((prev) => prev?.filter((s) => s.id !== target.id) ?? prev)
        load()
      } else {
        setEndError(errorMessage(err, 'Smenani yakunlab bo‘lmadi'))
      }
    } finally {
      setIsEnding(false)
    }
  }

  const list = useMemo(() => shifts ?? [], [shifts])
  const onlineCount = list.filter((s) => s.is_online).length
  const lostCount = list.length - onlineCount

  const uyushmaOptions = useMemo(() => {
    const map = new Map<string, string>()
    list.forEach((s) => map.set(s.uyushma_id, s.uyushma_name))
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [list])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return list.filter((s) => {
      if (gpsFilter === 'online' && !s.is_online) return false
      if (gpsFilter === 'lost' && s.is_online) return false
      if (uyushmaFilter && s.uyushma_id !== uyushmaFilter) return false
      if (!q) return true
      return [s.driver_name, s.driver_phone, s.vehicle_plate, s.vehicle_internal_id, s.uyushma_name, s.route_number]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [list, search, gpsFilter, uyushmaFilter])

  return (
    <div className="admin-page-container">
      <Toast toast={toast} onClose={hideToast} />

      <div className="admin-page-header">
        <div className="admin-page-header__left">
          <h1>
            <i className="ri-radar-line" style={{ color: 'var(--admin-accent)' }} />
            Jonli smenalar
          </h1>
          <p>
            Barcha Uyushmalar bo‘yicha faol smenalar va GPS holati
            {updatedAt ? ` • yangilangan: ${formatTime(updatedAt)}` : ''}
          </p>
        </div>

        <div className="uyushma-page-header__actions">
          <label className="admin-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}>
            <span className="admin-switch" style={{ transform: 'scale(0.85)' }}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              <span className="admin-switch__track" />
            </span>
            Avto-yangilash (15 s)
          </label>
          <button type="button" className="btn-secondary-action" onClick={load} disabled={isLoading}>
            <i className={isLoading ? 'ri-loader-4-line admin-spin' : 'ri-refresh-line'} />
            Yangilash
          </button>
          <Link to="/admin/map" className="btn-secondary-action" style={{ textDecoration: 'none' }}>
            <i className="ri-map-2-line" /> Xarita
          </Link>
        </div>
      </div>

      {shifts && (
        <div className="admin-kpis-grid">
          <div className="admin-kpi-card">
            <div className="admin-kpi-card__icon" style={{ background: 'var(--admin-accent-subtle)', color: 'var(--admin-accent)' }}>
              <i className="ri-steering-2-line" />
            </div>
            <div className="admin-kpi-card__content">
              <span className="admin-kpi-card__value">{list.length}</span>
              <span className="admin-kpi-card__label">Faol smenalar</span>
            </div>
          </div>
          <div className="admin-kpi-card">
            <div className="admin-kpi-card__icon" style={{ background: 'var(--success-subtle)', color: 'var(--success)' }}>
              <i className="ri-signal-tower-line" />
            </div>
            <div className="admin-kpi-card__content">
              <span className="admin-kpi-card__value">{onlineCount}</span>
              <span className="admin-kpi-card__label">GPS ko‘rinmoqda (online)</span>
              <span className="admin-kpi-card__subtext">Yo‘lovchilar xaritasida ko‘rinadi</span>
            </div>
          </div>
          <div className="admin-kpi-card">
            <div className="admin-kpi-card__icon" style={{ background: 'var(--warning-subtle)', color: 'var(--warning)' }}>
              <i className="ri-signal-wifi-error-line" />
            </div>
            <div className="admin-kpi-card__content">
              <span className="admin-kpi-card__value">{lostCount}</span>
              <span className="admin-kpi-card__label">GPS ko‘rinmayapti</span>
              <span className="admin-kpi-card__subtext">Smena faol, lekin yangi GPS kelmayapti</span>
            </div>
          </div>
        </div>
      )}

      <div className="admin-filter-bar">
        <div className="uyushma-search-input" style={{ flex: '1 1 260px' }}>
          <i className="ri-search-line" />
          <input
            type="search"
            placeholder="Haydovchi, telefon, davlat raqami, yo‘nalish..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Smena qidirish"
          />
        </div>
        <label className="admin-field">
          <span>Uyushma</span>
          <select className="uyushma-select" value={uyushmaFilter} onChange={(e) => setUyushmaFilter(e.target.value)}>
            <option value="">Barchasi</option>
            {uyushmaOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-segmented" role="tablist" aria-label="GPS holati">
          {(
            [
              ['all', `Hammasi (${list.length})`],
              ['online', `Online (${onlineCount})`],
              ['lost', `GPS ko‘rinmayapti (${lostCount})`],
            ] as [GpsFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={gpsFilter === key}
              className={gpsFilter === key ? 'active' : ''}
              onClick={() => setGpsFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loadError && shifts && (
        <Alert tone="warning">
          Oxirgi yangilash muvaffaqiyatsiz: {loadError}. Ko‘rsatilayotgan ma’lumot {updatedAt ? formatTime(updatedAt) : '—'} holatiga
          ko‘ra.
        </Alert>
      )}

      <div className="uyushma-table-wrapper">
        {!shifts && isLoading ? (
          <LoadingState label="Jonli smenalar yuklanmoqda..." />
        ) : !shifts ? (
          <ErrorState message={loadError ?? 'Jonli smenalarni yuklab bo‘lmadi'} onRetry={load} />
        ) : list.length === 0 ? (
          <EmptyState icon="ri-steering-line" title="Hozir faol smena yo‘q" hint="Haydovchi smenani boshlaganda ro‘yxat avtomatik yangilanadi" />
        ) : filtered.length === 0 ? (
          <EmptyState icon="ri-search-line" title="Filtr bo‘yicha smena topilmadi" />
        ) : (
          <table className="uyushma-table">
            <thead>
              <tr>
                <th>Haydovchi</th>
                <th>Uyushma</th>
                <th>Transport</th>
                <th>Yo‘nalish</th>
                <th>Boshlangan</th>
                <th>So‘nggi GPS</th>
                <th>Holat</th>
                <th style={{ textAlign: 'right' }}>Amallar</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{s.driver_name}</div>
                    <div className="admin-muted">{s.driver_phone}</div>
                  </td>
                  <td className="admin-muted" style={{ color: 'var(--text-secondary)' }}>
                    {s.uyushma_name}
                  </td>
                  <td>
                    <span className="vehicle-plate-badge">{s.vehicle_plate || s.vehicle_internal_id}</span>
                    {s.vehicle_plate && <div className="admin-muted admin-mono" style={{ marginTop: '0.2rem' }}>{s.vehicle_internal_id}</div>}
                  </td>
                  <td>
                    <span className="route-number-badge">№ {s.route_number || '—'}</span>
                    <div className="admin-muted" style={{ marginTop: '0.2rem' }}>
                      <i className={s.direction === 'inbound' ? 'ri-arrow-go-back-line' : 'ri-arrow-right-line'} /> {directionLabel(s.direction)}
                    </div>
                  </td>
                  <td className="admin-muted" title={formatDateTime(s.started_at)}>
                    <div style={{ color: 'var(--text-secondary)' }}>{formatTime(s.started_at)}</div>
                    <div>{timeAgo(s.started_at, now)}</div>
                  </td>
                  <td className="admin-muted" title={s.last_gps_at ? formatDateTime(s.last_gps_at) : undefined}>
                    {s.last_gps_at ? (
                      <>
                        <div style={{ color: s.is_online ? 'var(--text-secondary)' : 'var(--warning)' }}>{timeAgo(s.last_gps_at, now)}</div>
                        {s.current_lat !== null && s.current_lng !== null && (
                          <div className="admin-mono">
                            {s.current_lat.toFixed(5)}, {s.current_lng.toFixed(5)}
                          </div>
                        )}
                      </>
                    ) : (
                      'GPS hali kelmagan'
                    )}
                  </td>
                  <td>
                    {s.is_online ? (
                      <span className="status-pill online">
                        <span className="gps-dot" /> Online
                      </span>
                    ) : (
                      <span className="status-pill warning">
                        <i className="ri-signal-wifi-error-line" /> GPS ko‘rinmayapti
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn-admin-chip danger" onClick={() => openForceEnd(s)}>
                      <i className="ri-shut-down-line" /> Majburan yakunlash
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {target && (
        <AdminModal
          title="Smenani majburan yakunlash"
          icon="ri-alarm-warning-line"
          iconColor="var(--danger)"
          onClose={() => !isEnding && setTarget(null)}
          busy={isEnding}
          maxWidth={540}
          onSubmit={handleForceEnd}
          footer={
            <>
              <button type="button" className="btn-secondary-action" onClick={() => setTarget(null)} disabled={isEnding}>
                Bekor qilish
              </button>
              <button type="submit" className="btn-admin-danger" disabled={isEnding || reason.trim().length < 3}>
                <i className={isEnding ? 'ri-loader-4-line admin-spin' : 'ri-shut-down-line'} />
                {isEnding ? 'Yakunlanmoqda...' : 'Yakunlashni tasdiqlash'}
              </button>
            </>
          }
        >
          <div className="dangerous-action-banner">
            <i className="ri-alert-fill" />
            <div>
              <strong>Ogohlantirish:</strong> smena darhol yakunlanadi, transport yo‘lovchilar xaritasidan olib tashlanadi va haydovchi
              ilovasiga xabar yuboriladi. Amal sabab bilan audit jurnaliga yoziladi.
            </div>
          </div>

          <dl className="admin-dl">
            <dt>Haydovchi</dt>
            <dd>
              {target.driver_name} ({target.driver_phone})
            </dd>
            <dt>Transport</dt>
            <dd>
              {target.vehicle_plate || target.vehicle_internal_id}
              {target.vehicle_plate ? ` • ${target.vehicle_internal_id}` : ''}
            </dd>
            <dt>Yo‘nalish</dt>
            <dd>
              № {target.route_number || '—'} ({directionLabel(target.direction)})
            </dd>
            <dt>Uyushma</dt>
            <dd>{target.uyushma_name}</dd>
            <dt>Boshlangan</dt>
            <dd>
              {formatDateTime(target.started_at)} ({timeAgo(target.started_at, now)})
            </dd>
            <dt>GPS</dt>
            <dd>{target.is_online ? 'Online' : `GPS ko‘rinmayapti${target.last_gps_at ? ` (${timeAgo(target.last_gps_at, now)})` : ''}`}</dd>
          </dl>

          {endError && <Alert>{endError}</Alert>}

          <div className="uyushma-form-group">
            <label htmlFor="force-end-reason">Yakunlash sababi (audit jurnaliga yoziladi) *</label>
            <textarea
              id="force-end-reason"
              className="uyushma-textarea"
              rows={3}
              maxLength={255}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Masalan: haydovchi smenani yopmasdan ketgan, GPS 2 soatdan beri kelmayapti"
              autoFocus
            />
            <span className="hint">Kamida 3 ta belgi • {reason.trim().length}/255</span>
          </div>
        </AdminModal>
      )}
    </div>
  )
}
