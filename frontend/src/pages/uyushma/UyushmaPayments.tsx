import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useUyushmaScope } from '../../contexts/UyushmaScopeContext'
import {
  CASHOUT_METHOD_LABELS,
  CASHOUT_STATUS_LABELS,
  FINANCE_PERIOD_LABELS,
  IDENTIFICATION_METHOD_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_REFERENCE_MAX_LENGTH,
  PAYMENT_STATUS_LABELS,
  PAYMENTS_SEARCH_MAX_LENGTH,
  REJECT_REASON_MAX_LENGTH,
  canApproveCashout,
  canMarkCashoutPaid,
  canRejectCashout,
  financeApi,
  labelOf,
  periodStartIso,
  validatePaymentReference,
  validateRejectReason,
} from '../../services/api/financeApi'
import { uyushmaApi } from '../../services/api/uyushmaApi'
import { ApiError, errorMessage } from '../../services/api/client'
import { formatDateTime, formatSom } from '../../utils/format'
import type {
  CashoutRequest,
  CashoutStatus,
  FinancePaymentMethod,
  FinancePaymentStatus,
  FinancePeriod,
  FinanceSummary,
  Paginated,
  UyushmaPayment,
} from '../../types/finance'
import type { UyushmaRoute } from '../../types/uyushma'
import './UyushmaOperations.css'
import './UyushmaFinance.css'

type FinanceTab = 'payments' | 'cashouts' | 'summary'
type CashoutFilter = CashoutStatus | 'all'
type DialogKind = 'approve' | 'reject' | 'paid'

const PERIODS: FinancePeriod[] = ['today', '7d', '30d', 'all']
const CASHOUT_FILTERS: CashoutFilter[] = ['pending', 'approved', 'paid', 'rejected', 'all']
const PAGE_SIZES = [25, 50, 100]
const SEARCH_DEBOUNCE_MS = 350

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

function paymentStatusClass(status: string): string {
  if (status === 'completed') return 'fin-pill fin-pill--success'
  if (status === 'refunded') return 'fin-pill fin-pill--warning'
  return 'fin-pill fin-pill--danger'
}

function cashoutStatusClass(status: string): string {
  switch (status) {
    case 'pending':
      return 'fin-pill fin-pill--warning'
    case 'approved':
      return 'fin-pill fin-pill--info'
    case 'paid':
      return 'fin-pill fin-pill--success'
    default:
      return 'fin-pill fin-pill--danger'
  }
}

function vehicleLabel(plate: string | null, internalId: string | null): string {
  return plate || internalId || '—'
}

export function UyushmaPayments() {
  const { uyushmaId, loading: scopeLoading } = useUyushmaScope()

  if (!uyushmaId) {
    return (
      <div className="uyushma-page-container">
        <div className="fin-empty">
          <i className={scopeLoading ? 'ri-loader-4-line ri-spin' : 'ri-building-2-line'} />
          <p>{scopeLoading ? 'Yuklanmoqda…' : 'Uyushma tanlanmagan. Sarlavhadagi ro‘yxatdan uyushmani tanlang.'}</p>
        </div>
      </div>
    )
  }
  // Remount per tenant: every filter, list and dialog starts clean when the Super Admin switches tenant.
  return <UyushmaFinanceView key={uyushmaId} uyushmaId={uyushmaId} />
}

function UyushmaFinanceView({ uyushmaId }: { uyushmaId: string }) {
  const [activeTab, setActiveTab] = useState<FinanceTab>('payments')
  const [period, setPeriod] = useState<FinancePeriod>('30d')
  const [reloadKey, setReloadKey] = useState(0)

  // ── Summary ──
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  // ── Payments (server-side filters + pagination) ──
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS)
  const [routeId, setRouteId] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<FinancePaymentStatus | ''>('')
  const [paymentMethod, setPaymentMethod] = useState<FinancePaymentMethod | ''>('')
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  // Any filter change starts from page 1 (derived, so no extra request with a stale page number).
  const filtersKey = JSON.stringify([debouncedSearch, routeId, paymentStatus, paymentMethod, pageSize, period])
  const [pageState, setPageState] = useState({ key: filtersKey, page: 1 })
  const page = pageState.key === filtersKey ? pageState.page : 1
  const setPage = (update: (p: number) => number) => setPageState({ key: filtersKey, page: Math.max(1, update(page)) })
  const [payments, setPayments] = useState<Paginated<UyushmaPayment> | null>(null)
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [paymentsError, setPaymentsError] = useState<string | null>(null)

  const [routes, setRoutes] = useState<UyushmaRoute[]>([])
  const [routesError, setRoutesError] = useState<string | null>(null)

  // ── Cash-outs ──
  const [cashoutFilter, setCashoutFilter] = useState<CashoutFilter>('pending')
  const [cashouts, setCashouts] = useState<CashoutRequest[]>([])
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [cashoutsLoading, setCashoutsLoading] = useState(false)
  const [cashoutsError, setCashoutsError] = useState<string | null>(null)

  // ── Action dialog ──
  const [dialog, setDialog] = useState<{ kind: DialogKind; cashout: CashoutRequest } | null>(null)
  const [dialogInput, setDialogInput] = useState('')
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((kind: 'success' | 'error', text: string) => {
    setToast({ kind, text })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }, [])

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  // ── Loaders ──
  useEffect(() => {
    const ctrl = new AbortController()
    setRoutesError(null)
    uyushmaApi
      .getRoutes(uyushmaId)
      .then((list) => {
        if (!ctrl.signal.aborted) setRoutes(list)
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return
        setRoutes([])
        setRoutesError(errorMessage(err, 'Yo‘nalishlarni yuklab bo‘lmadi'))
      })
    return () => ctrl.abort()
  }, [uyushmaId, reloadKey])

  useEffect(() => {
    const ctrl = new AbortController()
    setSummaryLoading(true)
    setSummaryError(null)
    financeApi
      .getFinanceSummary(uyushmaId, periodStartIso(period), ctrl.signal)
      .then((s) => {
        if (!ctrl.signal.aborted) setSummary(s)
      })
      .catch((err) => {
        if (isAbort(err)) return
        setSummary(null)
        setSummaryError(errorMessage(err, 'Moliyaviy hisobotni yuklab bo‘lmadi'))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setSummaryLoading(false)
      })
    return () => ctrl.abort()
  }, [uyushmaId, period, reloadKey])

  useEffect(() => {
    const ctrl = new AbortController()
    setPaymentsLoading(true)
    setPaymentsError(null)
    financeApi
      .getPayments(
        uyushmaId,
        {
          routeId: routeId || undefined,
          status: paymentStatus || undefined,
          method: paymentMethod || undefined,
          search: debouncedSearch || undefined,
          dateFrom: periodStartIso(period),
          page,
          size: pageSize,
        },
        ctrl.signal,
      )
      .then((res) => {
        if (!ctrl.signal.aborted) setPayments(res)
      })
      .catch((err) => {
        if (isAbort(err)) return
        setPaymentsError(errorMessage(err, 'To‘lovlarni yuklab bo‘lmadi'))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setPaymentsLoading(false)
      })
    return () => ctrl.abort()
  }, [uyushmaId, routeId, paymentStatus, paymentMethod, debouncedSearch, period, page, pageSize, reloadKey])

  useEffect(() => {
    const ctrl = new AbortController()
    setCashoutsLoading(true)
    setCashoutsError(null)
    const status = cashoutFilter === 'all' ? undefined : cashoutFilter
    Promise.all([
      financeApi.getCashouts(uyushmaId, status, ctrl.signal),
      cashoutFilter === 'pending' ? null : financeApi.getCashouts(uyushmaId, 'pending', ctrl.signal),
    ])
      .then(([list, pending]) => {
        if (ctrl.signal.aborted) return
        setCashouts(list)
        setPendingCount((pending ?? list).length)
      })
      .catch((err) => {
        if (isAbort(err)) return
        setCashoutsError(errorMessage(err, 'Pul yechish so‘rovlarini yuklab bo‘lmadi'))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCashoutsLoading(false)
      })
    return () => ctrl.abort()
  }, [uyushmaId, cashoutFilter, reloadKey])

  const reloadAll = () => setReloadKey((k) => k + 1)

  // ── Cash-out actions ──
  const openDialog = (kind: DialogKind, cashout: CashoutRequest) => {
    setDialog({ kind, cashout })
    setDialogInput('')
    setDialogError(null)
  }

  const closeDialog = () => {
    if (submitting) return
    setDialog(null)
    setDialogError(null)
  }

  const submitDialog = async (e: FormEvent) => {
    e.preventDefault()
    if (!dialog || submitting) return
    const { kind, cashout } = dialog
    if (kind === 'reject') {
      const invalid = validateRejectReason(dialogInput)
      if (invalid) return setDialogError(invalid)
    }
    if (kind === 'paid') {
      const invalid = validatePaymentReference(dialogInput)
      if (invalid) return setDialogError(invalid)
    }

    setSubmitting(true)
    setDialogError(null)
    try {
      let updated: CashoutRequest
      if (kind === 'approve') updated = await financeApi.approveCashout(uyushmaId, cashout.id)
      else if (kind === 'reject') updated = await financeApi.rejectCashout(uyushmaId, cashout.id, dialogInput)
      else updated = await financeApi.markCashoutPaid(uyushmaId, cashout.id, dialogInput)

      setCashouts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setDialog(null)
      showToast(
        'success',
        kind === 'approve'
          ? `${updated.driver_name}: so‘rov tasdiqlandi. Mablag‘ “To‘landi” belgilanganda yechiladi.`
          : kind === 'reject'
            ? `${updated.driver_name}: so‘rov rad etildi, sabab audit jurnaliga yozildi.`
            : `${updated.driver_name}: ${formatSom(updated.amount_uzs)} to‘landi, haydovchi balansidan yechildi.`,
      )
      reloadAll()
    } catch (err) {
      const message = errorMessage(err)
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        // State changed elsewhere (another operator, insufficient balance, …): show why and resync.
        setDialog(null)
        showToast('error', message)
        reloadAll()
      } else {
        setDialogError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ── Derived ──
  const periodLabel = FINANCE_PERIOD_LABELS[period]
  const hasPaymentFilters = Boolean(debouncedSearch || routeId || paymentStatus || paymentMethod)
  const firstRow = payments && payments.total > 0 ? (payments.page - 1) * payments.size + 1 : 0
  const lastRow = payments ? Math.min(payments.total, payments.page * payments.size) : 0
  const cashoutTotalShown = useMemo(() => cashouts.reduce((sum, c) => sum + c.amount_uzs, 0), [cashouts])

  const amount = (value: number | undefined) => (summaryLoading && !summary ? '…' : formatSom(value ?? null))

  return (
    <div className="uyushma-page-container">
      {/* Header */}
      <div className="uyushma-page-header">
        <div className="uyushma-page-header__left">
          <h1>
            <i className="ri-wallet-3-fill" style={{ color: 'var(--accent-primary)' }} />
            Moliya va to‘lovlar
          </h1>
          <p>Yo‘l haqi to‘lovlari, qaytarishlar va haydovchilarning pul yechish so‘rovlari</p>
        </div>

        <div className="uyushma-page-header__actions">
          <div className="fin-chips" role="group" aria-label="Davr">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                className={`fin-chip ${period === p ? 'active' : ''}`}
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
              >
                {FINANCE_PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button className="btn-secondary-action" onClick={reloadAll} disabled={paymentsLoading || summaryLoading || cashoutsLoading}>
            <i className={`ri-refresh-line ${paymentsLoading || summaryLoading || cashoutsLoading ? 'ri-spin' : ''}`} />
            Yangilash
          </button>
        </div>
      </div>

      {summaryError && (
        <div className="fin-alert" role="alert">
          <i className="ri-error-warning-fill" />
          <div>Hisobot: {summaryError}</div>
        </div>
      )}

      {/* KPI cards */}
      <div className="finance-kpis-grid">
        <div className="finance-kpi-card">
          <div className="finance-kpi-card__top">
            <span className="finance-kpi-card__title">Jami tushum · {periodLabel}</span>
            <div className="finance-kpi-card__icon" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>
              <i className="ri-arrow-down-circle-line" />
            </div>
          </div>
          <div className="finance-kpi-card__amount success">{amount(summary?.gross_revenue)}</div>
          <span className="finance-kpi-card__subtext">
            {summary ? `${summary.completed_rides_count} ta muvaffaqiyatli to‘lov` : '—'}
          </span>
        </div>

        <div className="finance-kpi-card">
          <div className="finance-kpi-card__top">
            <span className="finance-kpi-card__title">Qaytarilgan · {periodLabel}</span>
            <div className="finance-kpi-card__icon" style={{ background: 'var(--warning-subtle)', color: 'var(--warning)' }}>
              <i className="ri-arrow-go-back-line" />
            </div>
          </div>
          <div className="finance-kpi-card__amount warning">{amount(summary?.total_refunds)}</div>
          <span className="finance-kpi-card__subtext">
            {summary ? `${summary.refunded_rides_count} ta qaytarilgan to‘lov` : '—'}
          </span>
        </div>

        <div className="finance-kpi-card">
          <div className="finance-kpi-card__top">
            <span className="finance-kpi-card__title">Sof tushum · {periodLabel}</span>
            <div className="finance-kpi-card__icon" style={{ background: 'var(--success-subtle)', color: 'var(--success)' }}>
              <i className="ri-safe-2-line" />
            </div>
          </div>
          <div className="finance-kpi-card__amount">{amount(summary?.net_revenue)}</div>
          <span className="finance-kpi-card__subtext">Qaytarishlar va tizim komissiyasidan so‘ng</span>
        </div>

        <div className="finance-kpi-card">
          <div className="finance-kpi-card__top">
            <span className="finance-kpi-card__title">To‘lanishi kutilayotgan</span>
            <div className="finance-kpi-card__icon" style={{ background: 'var(--danger-subtle)', color: 'var(--danger)' }}>
              <i className="ri-hand-coin-line" />
            </div>
          </div>
          <div className="finance-kpi-card__amount danger">{amount(summary?.pending_cashouts_total)}</div>
          <span className="finance-kpi-card__subtext">Kutilayotgan va tasdiqlangan so‘rovlar (joriy holat)</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="finance-nav-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'payments'}
          className={`finance-tab-btn ${activeTab === 'payments' ? 'active' : ''}`}
          onClick={() => setActiveTab('payments')}
        >
          <i className="ri-file-list-3-line" />
          To‘lovlar va qaytarishlar
          {payments && <span className="badge-pill">{payments.total}</span>}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'cashouts'}
          className={`finance-tab-btn ${activeTab === 'cashouts' ? 'active' : ''}`}
          onClick={() => setActiveTab('cashouts')}
        >
          <i className="ri-hand-coin-line" />
          Pul yechish so‘rovlari
          {pendingCount !== null && pendingCount > 0 && (
            <span className="badge-pill" style={{ background: 'var(--warning-subtle)', color: 'var(--warning)' }}>
              {pendingCount} yangi
            </span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'summary'}
          className={`finance-tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          <i className="ri-pie-chart-line" />
          Hisobot
        </button>
      </div>

      {/* ── Payments ── */}
      {activeTab === 'payments' && (
        <>
          <div className="uyushma-toolbar">
            <div className="uyushma-search-input">
              <i className={paymentsLoading && searchInput ? 'ri-loader-4-line ri-spin' : 'ri-search-line'} />
              <input
                type="search"
                placeholder="Tranzaksiya raqami, davlat raqami, ichki ID yoki haydovchi…"
                value={searchInput}
                maxLength={PAYMENTS_SEARCH_MAX_LENGTH}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="To‘lovlarni qidirish"
              />
            </div>

            <div className="finance-filters-row">
              <select
                className="finance-filter-select"
                value={routeId}
                onChange={(e) => setRouteId(e.target.value)}
                aria-label="Yo‘nalish"
                disabled={Boolean(routesError)}
                title={routesError ?? undefined}
              >
                <option value="">Barcha yo‘nalishlar</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    № {r.route_number} — {r.route_name}
                  </option>
                ))}
              </select>

              <select
                className="finance-filter-select"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as FinancePaymentMethod | '')}
                aria-label="To‘lov usuli"
              >
                <option value="">Barcha to‘lov usullari</option>
                {(Object.keys(PAYMENT_METHOD_LABELS) as FinancePaymentMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>

              <select
                className="finance-filter-select"
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as FinancePaymentStatus | '')}
                aria-label="Holat"
              >
                <option value="">Barcha holatlar</option>
                {(Object.keys(PAYMENT_STATUS_LABELS) as FinancePaymentStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {PAYMENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {paymentsError && (
            <div className="fin-alert" role="alert">
              <i className="ri-error-warning-fill" />
              <div style={{ flex: 1 }}>{paymentsError}</div>
              <button type="button" className="btn-secondary-action" onClick={reloadAll}>
                Qayta urinish
              </button>
            </div>
          )}

          <div className="uyushma-table-wrapper">
            <table className="uyushma-table">
              <thead>
                <tr>
                  <th>Tranzaksiya</th>
                  <th>Yo‘nalish</th>
                  <th>Transport va haydovchi</th>
                  <th>To‘lov usuli</th>
                  <th>Summa</th>
                  <th>Holat</th>
                  <th>Vaqt</th>
                </tr>
              </thead>
              <tbody className={paymentsLoading && payments ? 'fin-tbody--loading' : undefined}>
                {paymentsLoading && !payments ? (
                  <tr>
                    <td colSpan={7} className="fin-table-state">
                      <i className="ri-loader-4-line ri-spin" />
                      <div>Yuklanmoqda…</div>
                    </td>
                  </tr>
                ) : !payments || payments.items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="fin-table-state">
                      {paymentsError
                        ? 'Ma’lumot yuklanmadi.'
                        : hasPaymentFilters
                          ? 'Tanlangan filtrlar bo‘yicha to‘lov topilmadi.'
                          : `${periodLabel}: to‘lovlar hali yo‘q.`}
                    </td>
                  </tr>
                ) : (
                  payments.items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong className="fin-mono">{p.reference}</strong>
                        <div className="fin-sub">{p.passenger_label}</div>
                      </td>
                      <td>
                        <span className="route-number-badge">№ {p.route_number || '—'}</span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.driver_name || '—'}</div>
                        <span className="vehicle-plate-badge">{vehicleLabel(p.vehicle_plate, p.vehicle_internal_id)}</span>
                        {p.vehicle_plate && <div className="fin-sub fin-mono">{p.vehicle_internal_id}</div>}
                      </td>
                      <td>
                        <div style={{ fontWeight: 700 }}>{labelOf(PAYMENT_METHOD_LABELS, p.payment_method)}</div>
                        <div className="fin-sub">{labelOf(IDENTIFICATION_METHOD_LABELS, p.identification_method)}</div>
                      </td>
                      <td>
                        <div className={p.status === 'completed' ? 'fin-amount fin-amount--in' : 'fin-amount fin-amount--void'}>
                          {formatSom(p.amount_uzs)}
                        </div>
                        {p.commission_uzs > 0 && (
                          <div className="fin-sub">
                            Komissiya {formatSom(p.commission_uzs)} · sof {formatSom(p.net_amount_uzs)}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={paymentStatusClass(p.status)}>{labelOf(PAYMENT_STATUS_LABELS, p.status)}</span>
                        {p.status === 'refunded' && (
                          <div className="fin-sub" style={{ color: 'var(--warning)', maxWidth: 220 }}>
                            {p.refund_reason || 'Sabab ko‘rsatilmagan'}
                            {p.refunded_at && <> · {formatDateTime(p.refunded_at)}</>}
                          </div>
                        )}
                      </td>
                      <td className="fin-nowrap" style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {formatDateTime(p.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {payments && payments.total > 0 && (
              <div className="fin-pagination">
                <span>
                  {firstRow}–{lastRow} / {payments.total}
                </span>
                <div className="fin-pagination__controls">
                  <select
                    className="finance-filter-select"
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    aria-label="Sahifadagi qatorlar"
                  >
                    {PAGE_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s} ta
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-secondary-action"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={paymentsLoading || payments.page <= 1}
                    aria-label="Oldingi sahifa"
                  >
                    <i className="ri-arrow-left-s-line" />
                  </button>
                  <span className="fin-sub" style={{ margin: 0 }}>
                    {payments.page} / {payments.pages}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary-action"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={paymentsLoading || payments.page >= payments.pages}
                    aria-label="Keyingi sahifa"
                  >
                    <i className="ri-arrow-right-s-line" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Cash-outs ── */}
      {activeTab === 'cashouts' && (
        <>
          <div className="uyushma-toolbar">
            <div className="fin-chips" role="group" aria-label="So‘rov holati">
              {CASHOUT_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`fin-chip ${cashoutFilter === f ? 'active' : ''}`}
                  onClick={() => setCashoutFilter(f)}
                  aria-pressed={cashoutFilter === f}
                >
                  {f === 'all' ? 'Barchasi' : CASHOUT_STATUS_LABELS[f]}
                  {f === 'pending' && pendingCount ? <span className="fin-chip__count">{pendingCount}</span> : null}
                </button>
              ))}
            </div>
            <span className="fin-sub" style={{ margin: 0 }}>
              Haydovchi balansidan mablag‘ faqat “To‘landi” belgilanganda yechiladi
            </span>
          </div>

          {cashoutsError && (
            <div className="fin-alert" role="alert">
              <i className="ri-error-warning-fill" />
              <div style={{ flex: 1 }}>{cashoutsError}</div>
              <button type="button" className="btn-secondary-action" onClick={reloadAll}>
                Qayta urinish
              </button>
            </div>
          )}

          <div className="uyushma-table-wrapper">
            <table className="uyushma-table">
              <thead>
                <tr>
                  <th>Haydovchi</th>
                  <th>Transport</th>
                  <th>Summa</th>
                  <th>Usul va rekvizitlar</th>
                  <th>Holat</th>
                  <th>So‘rov vaqti</th>
                  <th style={{ textAlign: 'right' }}>Amallar</th>
                </tr>
              </thead>
              <tbody className={cashoutsLoading && cashouts.length ? 'fin-tbody--loading' : undefined}>
                {cashoutsLoading && cashouts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="fin-table-state">
                      <i className="ri-loader-4-line ri-spin" />
                      <div>Yuklanmoqda…</div>
                    </td>
                  </tr>
                ) : cashouts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="fin-table-state">
                      {cashoutsError
                        ? 'Ma’lumot yuklanmadi.'
                        : cashoutFilter === 'all'
                          ? 'Pul yechish so‘rovlari hali yo‘q.'
                          : `“${CASHOUT_STATUS_LABELS[cashoutFilter]}” holatidagi so‘rov yo‘q.`}
                    </td>
                  </tr>
                ) : (
                  cashouts.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{c.driver_name || '—'}</div>
                        {c.driver_phone && (
                          <a className="fin-sub fin-link" href={`tel:${c.driver_phone.replace(/\s+/g, '')}`}>
                            {c.driver_phone}
                          </a>
                        )}
                      </td>
                      <td>
                        {c.vehicle_plate || c.vehicle_internal_id ? (
                          <>
                            <span className="vehicle-plate-badge">{vehicleLabel(c.vehicle_plate, c.vehicle_internal_id)}</span>
                            {c.vehicle_plate && c.vehicle_internal_id && <div className="fin-sub fin-mono">{c.vehicle_internal_id}</div>}
                          </>
                        ) : (
                          <span className="fin-sub">—</span>
                        )}
                      </td>
                      <td>
                        <strong style={{ fontSize: '1rem' }}>{formatSom(c.amount_uzs)}</strong>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{labelOf(CASHOUT_METHOD_LABELS, c.method)}</div>
                        {c.payout_details && <div className="fin-sub">{c.payout_details}</div>}
                        {c.payment_reference && (
                          <div className="fin-sub fin-mono" style={{ color: 'var(--accent-primary)' }}>
                            Chek: {c.payment_reference}
                          </div>
                        )}
                        {c.rejection_reason && (
                          <div className="fin-sub" style={{ color: 'var(--danger)' }}>
                            Sabab: {c.rejection_reason}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={cashoutStatusClass(c.status)}>{labelOf(CASHOUT_STATUS_LABELS, c.status)}</span>
                        {(c.paid_at || c.processed_at) && (
                          <div className="fin-sub">
                            {formatDateTime(c.paid_at || c.processed_at)}
                            {c.processed_by && <> · {c.processed_by}</>}
                          </div>
                        )}
                      </td>
                      <td className="fin-nowrap" style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {formatDateTime(c.created_at)}
                      </td>
                      <td>
                        <div className="cashout-action-btns" style={{ justifyContent: 'flex-end' }}>
                          {canApproveCashout(c.status) && (
                            <button className="btn-approve-cashout" onClick={() => openDialog('approve', c)}>
                              <i className="ri-check-line" />
                              Tasdiqlash
                            </button>
                          )}
                          {canMarkCashoutPaid(c.status) && (
                            <button className="btn-mark-paid" onClick={() => openDialog('paid', c)}>
                              <i className="ri-bank-card-line" />
                              To‘landi
                            </button>
                          )}
                          {canRejectCashout(c.status) && (
                            <button className="btn-reject-cashout" onClick={() => openDialog('reject', c)}>
                              <i className="ri-close-line" />
                              Rad etish
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {cashouts.length > 0 && (
              <div className="fin-pagination">
                <span>
                  {cashouts.length} ta so‘rov · jami {formatSom(cashoutTotalShown)}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Summary ── */}
      {activeTab === 'summary' && (
        <div className="fin-summary-grid">
          <div className="finance-kpi-card">
            <h3 className="fin-card-title">Tushum taqsimoti · {periodLabel}</h3>
            {summary ? (
              <div className="fin-rows">
                <div className="fin-row">
                  <span>Barcha to‘lovlar (gross)</span>
                  <strong>{formatSom(summary.gross_revenue)}</strong>
                </div>
                <div className="fin-row">
                  <span>Yo‘lovchilarga qaytarilgan</span>
                  <strong style={{ color: 'var(--warning)' }}>−{formatSom(summary.total_refunds)}</strong>
                </div>
                <div className="fin-row">
                  <span>Tizim xizmat haqi</span>
                  <strong style={{ color: 'var(--danger)' }}>−{formatSom(summary.platform_commission)}</strong>
                </div>
                <div className="fin-row fin-row--total">
                  <span>Sof tushum</span>
                  <span style={{ color: 'var(--success)' }}>{formatSom(summary.net_revenue)}</span>
                </div>
              </div>
            ) : (
              <div className="fin-sub">{summaryLoading ? 'Yuklanmoqda…' : summaryError ?? '—'}</div>
            )}
          </div>

          <div className="finance-kpi-card">
            <h3 className="fin-card-title">Qatnovlar va pul yechish</h3>
            {summary ? (
              <div className="fin-rows">
                <div className="fin-row">
                  <span>Muvaffaqiyatli to‘lovlar · {periodLabel}</span>
                  <strong>{summary.completed_rides_count} ta</strong>
                </div>
                <div className="fin-row">
                  <span>Qaytarilgan to‘lovlar · {periodLabel}</span>
                  <strong>{summary.refunded_rides_count} ta</strong>
                </div>
                <div className="fin-row">
                  <span>Haydovchilarga to‘lab berilgan (jami)</span>
                  <strong style={{ color: 'var(--success)' }}>{formatSom(summary.paid_cashouts_total)}</strong>
                </div>
                <div className="fin-row">
                  <span>To‘lanishi kutilayotgan (joriy)</span>
                  <strong style={{ color: 'var(--warning)' }}>{formatSom(summary.pending_cashouts_total)}</strong>
                </div>
              </div>
            ) : (
              <div className="fin-sub">{summaryLoading ? 'Yuklanmoqda…' : summaryError ?? '—'}</div>
            )}
          </div>
        </div>
      )}

      {/* ── Cash-out action dialog ── */}
      {dialog && (
        <div className="uyushma-modal-overlay" onClick={closeDialog}>
          <div
            className="uyushma-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cashout-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="uyushma-modal-header">
              <h3 id="cashout-dialog-title">
                {dialog.kind === 'approve' && (
                  <>
                    <i className="ri-check-double-line" style={{ color: 'var(--success)' }} />
                    So‘rovni tasdiqlash
                  </>
                )}
                {dialog.kind === 'reject' && (
                  <>
                    <i className="ri-close-circle-fill" style={{ color: 'var(--danger)' }} />
                    So‘rovni rad etish
                  </>
                )}
                {dialog.kind === 'paid' && (
                  <>
                    <i className="ri-bank-card-line" style={{ color: 'var(--accent-primary)' }} />
                    To‘langan deb belgilash
                  </>
                )}
              </h3>
              <button type="button" className="btn-modal-close" onClick={closeDialog} disabled={submitting} aria-label="Yopish">
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={submitDialog}>
              <div className="uyushma-modal-body">
                <div className="fin-dialog-summary">
                  <div className="fin-sub" style={{ margin: 0 }}>
                    {dialog.cashout.driver_name} · {dialog.cashout.driver_phone}
                  </div>
                  <div className="fin-dialog-summary__amount">{formatSom(dialog.cashout.amount_uzs)}</div>
                  <div className="fin-sub" style={{ margin: 0 }}>
                    {labelOf(CASHOUT_METHOD_LABELS, dialog.cashout.method)}
                    {dialog.cashout.payout_details && <> · {dialog.cashout.payout_details}</>}
                  </div>
                </div>

                {dialog.kind === 'approve' && (
                  <div className="rule-guard-banner">
                    <i className="ri-information-line" />
                    <div>
                      Tasdiqlash haydovchi balansini hali o‘zgartirmaydi. Mablag‘ haqiqatda berilgach, “To‘landi” tugmasi orqali
                      chek raqamini kiriting — shunda balansdan yechiladi.
                    </div>
                  </div>
                )}

                {dialog.kind === 'reject' && (
                  <>
                    <div className="audit-warning-box">
                      <i className="ri-alert-line" />
                      <div>Rad etish sababi audit jurnaliga yoziladi va haydovchiga ko‘rsatiladi.</div>
                    </div>
                    <div className="uyushma-form-group">
                      <label htmlFor="cashout-reject-reason">Rad etish sababi *</label>
                      <textarea
                        id="cashout-reject-reason"
                        className="uyushma-textarea"
                        rows={3}
                        maxLength={REJECT_REASON_MAX_LENGTH}
                        placeholder="Masalan: karta raqami noto‘g‘ri ko‘rsatilgan"
                        value={dialogInput}
                        onChange={(e) => setDialogInput(e.target.value)}
                        autoFocus
                      />
                      <span className="hint">
                        Kamida 3 ta belgi · {dialogInput.trim().length}/{REJECT_REASON_MAX_LENGTH}
                      </span>
                    </div>
                  </>
                )}

                {dialog.kind === 'paid' && (
                  <>
                    <div className="audit-warning-box">
                      <i className="ri-alert-line" />
                      <div>
                        Tasdiqlaganingizda haydovchi balansidan <strong>{formatSom(dialog.cashout.amount_uzs)}</strong> yechiladi. Bu
                        amalni ortga qaytarib bo‘lmaydi.
                      </div>
                    </div>
                    <div className="uyushma-form-group">
                      <label htmlFor="cashout-payment-reference">Kassa orderi / bank tranzaksiya raqami *</label>
                      <input
                        id="cashout-payment-reference"
                        type="text"
                        className="uyushma-input"
                        maxLength={PAYMENT_REFERENCE_MAX_LENGTH}
                        placeholder="Masalan: KO-000123"
                        value={dialogInput}
                        onChange={(e) => setDialogInput(e.target.value)}
                        autoFocus
                      />
                      <span className="hint">Haqiqiy to‘lov hujjati raqami (audit uchun saqlanadi)</span>
                    </div>
                  </>
                )}

                {dialogError && (
                  <div className="rule-conflict-alert" role="alert">
                    <i className="ri-error-warning-fill" />
                    <div>{dialogError}</div>
                  </div>
                )}
              </div>

              <div className="uyushma-modal-footer">
                <button type="button" className="btn-secondary-action" onClick={closeDialog} disabled={submitting}>
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="btn-primary-action"
                  style={dialog.kind === 'reject' ? { background: 'var(--danger)' } : undefined}
                  disabled={
                    submitting ||
                    (dialog.kind === 'reject' && validateRejectReason(dialogInput) !== null) ||
                    (dialog.kind === 'paid' && validatePaymentReference(dialogInput) !== null)
                  }
                >
                  {submitting
                    ? 'Saqlanmoqda…'
                    : dialog.kind === 'approve'
                      ? 'Tasdiqlash'
                      : dialog.kind === 'reject'
                        ? 'Rad etish'
                        : 'To‘landi deb tasdiqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fin-toast fin-toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          <i className={toast.kind === 'error' ? 'ri-error-warning-fill' : 'ri-checkbox-circle-fill'} />
          <p>{toast.text}</p>
          <button type="button" onClick={() => setToast(null)} aria-label="Yopish">
            <i className="ri-close-line" />
          </button>
        </div>
      )}
    </div>
  )
}
