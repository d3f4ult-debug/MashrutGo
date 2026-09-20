import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { adminApi } from '../../services/api/adminApi'
import { errorMessage } from '../../services/api/client'
import { formatDateTime, formatSom, formatTime, timeAgo } from '../../utils/format'
import type { AdminGlobalKPIs, AdminLiveShift, AuditLogEntry, LedgerHealth } from '../../types/admin'
import {
  Alert,
  EmptyState,
  ErrorState,
  LoadingState,
  auditActionLabel,
  auditActionTone,
  directionLabel,
  isAbortError,
  roleLabel,
} from './adminShared'
import './AdminOperations.css'
import './AdminDashboard.css'
import '../uyushma/UyushmaOperations.css'

interface Section<T> {
  data: T | null
  error: string | null
}

const PREVIEW_SIZE = 6

function num(n: number): string {
  return n.toLocaleString('ru-RU')
}

export function AdminDashboard() {
  const navigate = useNavigate()
  const [kpis, setKpis] = useState<Section<AdminGlobalKPIs>>({ data: null, error: null })
  const [shifts, setShifts] = useState<Section<AdminLiveShift[]>>({ data: null, error: null })
  const [audits, setAudits] = useState<Section<AuditLogEntry[]>>({ data: null, error: null })
  const [isLoading, setIsLoading] = useState(true)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [ledger, setLedger] = useState<LedgerHealth | null>(null)
  const [ledgerError, setLedgerError] = useState<string | null>(null)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerCheckedAt, setLedgerCheckedAt] = useState<number | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsLoading(true)
    const [k, s, a] = await Promise.allSettled([
      adminApi.getKPIs(controller.signal),
      adminApi.getLiveShifts(controller.signal),
      adminApi.getAuditLogs({ page: 1, size: PREVIEW_SIZE }, controller.signal),
    ])
    if (controller.signal.aborted) return
    const pick = <T,>(r: PromiseSettledResult<T>, prev: Section<T>): Section<T> =>
      r.status === 'fulfilled'
        ? { data: r.value, error: null }
        : isAbortError(r.reason)
          ? prev
          : { data: prev.data, error: errorMessage(r.reason, 'Ma’lumotni yuklab bo‘lmadi') }
    setKpis((prev) => pick(k, prev))
    setShifts((prev) => pick(s, prev))
    const auditItems: PromiseSettledResult<AuditLogEntry[]> =
      a.status === 'fulfilled' ? { status: 'fulfilled', value: a.value.items } : a
    setAudits((prev) => pick(auditItems, prev))
    setLoadedAt(Date.now())
    setIsLoading(false)
  }, [])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  const runLedgerCheck = async () => {
    setLedgerLoading(true)
    setLedgerError(null)
    try {
      setLedger(await adminApi.getLedgerHealth())
      setLedgerCheckedAt(Date.now())
    } catch (err) {
      setLedgerError(errorMessage(err, 'Ledger tekshiruvini bajarib bo‘lmadi'))
    } finally {
      setLedgerLoading(false)
    }
  }

  const k = kpis.data
  const maintenance = k?.system_status === 'maintenance'
  const shiftList = shifts.data ?? []
  const shiftPreview = shiftList.slice(0, PREVIEW_SIZE)
  const offlineShifts = shiftList.filter((s) => !s.is_online).length

  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div className="admin-page-header__left">
          <h1>
            <i className="ri-shield-star-fill" style={{ color: 'var(--admin-accent)' }} />
            Super Admin boshqaruv paneli
          </h1>
          <p>
            Platforma bo‘yicha jonli ko‘rsatkichlar
            {loadedAt ? ` • yangilangan: ${formatTime(loadedAt)}` : ''}
          </p>
        </div>

        <div className="uyushma-page-header__actions">
          <button type="button" className="btn-secondary-action" onClick={load} disabled={isLoading}>
            <i className={isLoading ? 'ri-loader-4-line admin-spin' : 'ri-refresh-line'} />
            Yangilash
          </button>
          <button type="button" className="btn-admin-primary" onClick={() => navigate('/admin/uyushmalar?create=1')}>
            <i className="ri-add-line" />
            Yangi Uyushma
          </button>
        </div>
      </div>

      {maintenance && (
        <Alert tone="warning">
          <strong>Texnik xizmat rejimi yoqilgan.</strong> Yangi yo‘l haqi to‘lovlari va hamyonni to‘ldirish bloklangan.{' '}
          <Link to="/admin/settings" className="admin-inline-link">
            Sozlamalarga o‘tish
          </Link>
        </Alert>
      )}

      {/* KPIs */}
      {!k && isLoading ? (
        <div className="admin-panel">
          <LoadingState label="Ko‘rsatkichlar yuklanmoqda..." />
        </div>
      ) : !k ? (
        <div className="admin-panel">
          <ErrorState message={kpis.error ?? 'Ko‘rsatkichlarni yuklab bo‘lmadi'} onRetry={load} />
        </div>
      ) : (
        <>
          {kpis.error && <Alert tone="danger">Ko‘rsatkichlarni yangilab bo‘lmadi: {kpis.error}</Alert>}
          <div className="admin-kpis-grid">
            <KpiCard
              to="/admin/uyushmalar"
              icon="ri-building-2-line"
              color="var(--admin-accent)"
              bg="var(--admin-accent-subtle)"
              value={num(k.total_uyushmalar)}
              label="Faol Uyushmalar"
              sub="Arxivlanganlar hisobga olinmagan"
            />
            <KpiCard
              to="/admin/routes"
              icon="ri-route-line"
              color="var(--accent-primary)"
              bg="var(--accent-subtle)"
              value={
                <>
                  {num(k.published_routes)} <small>/ {num(k.total_routes)}</small>
                </>
              }
              label="Nashr etilgan yo‘nalishlar"
              sub="Nashr etilgan / jami (arxivsiz)"
            />
            <KpiCard
              to="/admin/shifts"
              icon="ri-steering-2-line"
              color="var(--success)"
              bg="var(--success-subtle)"
              value={num(k.active_shifts)}
              label="Faol smenalar"
              sub={`Faol haydovchilar: ${num(k.total_drivers)}`}
            />
            <KpiCard
              to="/admin/map"
              icon="ri-map-pin-2-line"
              color="var(--info)"
              bg="var(--info-subtle)"
              value={num(k.visible_vehicles)}
              label="GPS orqali ko‘rinayotgan transport"
              sub={`Faol transportlar jami: ${num(k.total_vehicles)}`}
            />
            <KpiCard
              to="/admin/clients"
              icon="ri-group-line"
              color="var(--warning)"
              bg="var(--warning-subtle)"
              value={num(k.total_clients)}
              label="Ro‘yxatdan o‘tgan mijozlar"
              sub="Bloklanganlar ham kiradi"
            />
            <KpiCard
              to="/admin/payments"
              icon="ri-wallet-3-line"
              color="var(--info)"
              bg="var(--info-subtle)"
              value={formatSom(k.today_gross_revenue)}
              label="Bugungi yo‘l haqi aylanmasi"
              sub={`${num(k.today_payments_count)} ta to‘lov • komissiya: ${formatSom(k.today_platform_commission)}`}
            />
            <KpiCard
              to="/admin/payments"
              icon="ri-hand-coin-line"
              color={k.pending_cashouts_count > 0 ? 'var(--warning)' : 'var(--text-secondary)'}
              bg={k.pending_cashouts_count > 0 ? 'var(--warning-subtle)' : 'var(--surface-hover)'}
              value={num(k.pending_cashouts_count)}
              label="Ko‘rib chiqilishi kerak bo‘lgan pul yechish so‘rovlari"
              sub="Kutilayotgan + tasdiqlangan (to‘lanmagan)"
            />
            <KpiCard
              to="/admin/parkings"
              icon="ri-parking-box-line"
              color="var(--text-secondary)"
              bg="var(--surface-hover)"
              value={num(k.total_parkings)}
              label="Faol stoyankalar"
            />
            <KpiCard
              to="/admin/settings"
              icon={maintenance ? 'ri-tools-line' : 'ri-server-line'}
              color={maintenance ? 'var(--warning)' : 'var(--success)'}
              bg={maintenance ? 'var(--warning-subtle)' : 'var(--success-subtle)'}
              value={k.system_status === 'healthy' ? 'Normal' : maintenance ? 'Texnik xizmat' : k.system_status}
              label="Tizim holati"
              sub={maintenance ? 'To‘lovlar vaqtincha to‘xtatilgan' : 'To‘lovlar qabul qilinmoqda'}
            />
          </div>
        </>
      )}

      {/* Quick links */}
      <div className="admin-quick-links">
        {[
          { to: '/admin/uyushmalar', icon: 'ri-building-2-line', color: 'var(--admin-accent)', label: 'Uyushmalar' },
          { to: '/admin/clients', icon: 'ri-group-line', color: 'var(--warning)', label: 'Mijozlar va hamyonlar' },
          { to: '/admin/shifts', icon: 'ri-radar-line', color: 'var(--success)', label: 'Jonli smenalar' },
          { to: '/admin/map', icon: 'ri-map-2-line', color: 'var(--info)', label: 'Live xarita' },
          { to: '/admin/settings', icon: 'ri-settings-4-line', color: 'var(--accent-primary)', label: 'Tizim sozlamalari' },
          { to: '/admin/audit', icon: 'ri-file-list-3-line', color: 'var(--danger)', label: 'Audit jurnali' },
        ].map((l) => (
          <Link key={l.to} to={l.to} className="btn-secondary-action admin-quick-link">
            <i className={l.icon} style={{ color: l.color }} />
            {l.label}
          </Link>
        ))}
      </div>

      <div className="admin-dashboard-split">
        {/* Live shifts preview */}
        <section className="admin-panel">
          <div className="admin-panel__header">
            <h3>
              <i className="ri-steering-2-line" style={{ color: 'var(--success)' }} />
              Faol smenalar{shifts.data ? ` (${shiftList.length})` : ''}
            </h3>
            <Link to="/admin/shifts" className="btn-admin-chip">
              Barchasi <i className="ri-arrow-right-s-line" />
            </Link>
          </div>
          {shifts.error && shifts.data && <div className="admin-panel__body"><Alert>{shifts.error}</Alert></div>}
          {!shifts.data && isLoading ? (
            <LoadingState label="Smenalar yuklanmoqda..." />
          ) : !shifts.data ? (
            <ErrorState message={shifts.error ?? 'Smenalarni yuklab bo‘lmadi'} onRetry={load} />
          ) : shiftList.length === 0 ? (
            <EmptyState icon="ri-steering-line" title="Hozir faol smena yo‘q" hint="Haydovchi smenani boshlaganda shu yerda ko‘rinadi" />
          ) : (
            <>
              {offlineShifts > 0 && (
                <div className="admin-panel__body" style={{ paddingBottom: 0 }}>
                  <Alert tone="warning">{offlineShifts} ta smenada GPS ko‘rinmayapti</Alert>
                </div>
              )}
              <div className="uyushma-table-wrapper">
                <table className="uyushma-table">
                  <thead>
                    <tr>
                      <th>Haydovchi</th>
                      <th>Yo‘nalish</th>
                      <th>GPS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftPreview.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{s.driver_name}</div>
                          <div className="admin-muted">
                            {s.uyushma_name} • <span className="admin-mono">{s.vehicle_plate || s.vehicle_internal_id}</span>
                          </div>
                        </td>
                        <td>
                          <span className="route-number-badge">№ {s.route_number || '—'}</span>
                          <div className="admin-muted" style={{ marginTop: '0.2rem' }}>{directionLabel(s.direction)}</div>
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
                          <div className="admin-muted" style={{ marginTop: '0.2rem' }}>
                            {s.last_gps_at ? timeAgo(s.last_gps_at) : 'GPS hali kelmagan'}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {shiftList.length > shiftPreview.length && (
                <div className="admin-panel__body admin-muted">
                  Yana {shiftList.length - shiftPreview.length} ta smena — <Link to="/admin/shifts" className="admin-inline-link">to‘liq ro‘yxat</Link>
                </div>
              )}
            </>
          )}
        </section>

        {/* Recent audit */}
        <section className="admin-panel">
          <div className="admin-panel__header">
            <h3>
              <i className="ri-shield-check-line" style={{ color: 'var(--danger)' }} />
              So‘nggi audit yozuvlari
            </h3>
            <Link to="/admin/audit" className="btn-admin-chip">
              To‘liq jurnal <i className="ri-arrow-right-s-line" />
            </Link>
          </div>
          {audits.error && audits.data && <div className="admin-panel__body"><Alert>{audits.error}</Alert></div>}
          {!audits.data && isLoading ? (
            <LoadingState label="Audit yozuvlari yuklanmoqda..." />
          ) : !audits.data ? (
            <ErrorState message={audits.error ?? 'Audit jurnalini yuklab bo‘lmadi'} onRetry={load} />
          ) : audits.data.length === 0 ? (
            <EmptyState icon="ri-file-search-line" title="Audit jurnali hozircha bo‘sh" />
          ) : (
            <ul className="admin-audit-feed">
              {audits.data.map((a) => (
                <li key={a.id}>
                  <div>
                    <span className={`audit-badge ${auditActionTone(a.action)}`}>{auditActionLabel(a.action)}</span>
                    <div className="admin-muted" style={{ marginTop: '0.3rem' }}>
                      {a.actor_name ?? 'Tizim'} ({roleLabel(a.actor_role)})
                      {a.target_type ? ` • ${a.target_type}${a.target_id ? `:${a.target_id}` : ''}` : ''}
                      {a.ip_address ? ` • ${a.ip_address}` : ''}
                    </div>
                    {a.reason && <div className="audit-reason">Sabab: {a.reason}</div>}
                  </div>
                  <time className="admin-muted" title={formatDateTime(a.created_at)}>
                    {timeAgo(a.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Ledger health */}
      <section className="admin-panel">
        <div className="admin-panel__header">
          <h3>
            <i className="ri-scales-3-line" style={{ color: 'var(--info)' }} />
            Hamyonlar ledger tekshiruvi
          </h3>
          <button type="button" className="btn-admin-chip accent" onClick={runLedgerCheck} disabled={ledgerLoading}>
            <i className={ledgerLoading ? 'ri-loader-4-line admin-spin' : 'ri-play-line'} />
            {ledger ? 'Qayta tekshirish' : 'Tekshirish'}
          </button>
        </div>
        <div className="admin-panel__body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <p className="admin-muted" style={{ margin: 0 }}>
            Har bir hamyonning keshlangan balansi o‘zgarmas ledger yozuvlari yig‘indisi bilan solishtiriladi. Tekshiruv barcha
            hamyonlarni o‘qiydi, shuning uchun faqat so‘ralganda ishga tushiriladi.
          </p>
          {ledgerError && <Alert>{ledgerError}</Alert>}
          {ledger &&
            (ledger.is_consistent ? (
              <Alert tone="success">
                {num(ledger.wallets_checked)} ta hamyon tekshirildi — nomuvofiqlik topilmadi.
                {ledgerCheckedAt ? ` (${formatTime(ledgerCheckedAt)})` : ''}
              </Alert>
            ) : (
              <Alert tone="danger">
                <strong>{ledger.inconsistent_wallet_ids.length} ta hamyonda balans ledgerga mos emas</strong> (jami{' '}
                {num(ledger.wallets_checked)} ta tekshirildi). Hamyon ID: {ledger.inconsistent_wallet_ids.join(', ')}
              </Alert>
            ))}
        </div>
      </section>
    </div>
  )
}

function KpiCard({
  to,
  icon,
  color,
  bg,
  value,
  label,
  sub,
}: {
  to: string
  icon: string
  color: string
  bg: string
  value: ReactNode
  label: string
  sub?: string
}) {
  return (
    <Link to={to} className="admin-kpi-card admin-kpi-card--link">
      <div className="admin-kpi-card__icon" style={{ background: bg, color }}>
        <i className={icon} />
      </div>
      <div className="admin-kpi-card__content">
        <span className="admin-kpi-card__value">{value}</span>
        <span className="admin-kpi-card__label">{label}</span>
        {sub && <span className="admin-kpi-card__subtext">{sub}</span>}
      </div>
    </Link>
  )
}
