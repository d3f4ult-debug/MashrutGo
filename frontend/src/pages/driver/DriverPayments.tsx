import { useEffect, useMemo, useState } from 'react'
import { useDriverPayments } from '../../hooks/useDriverPayments'
import { useDriverSession } from '../../contexts/DriverSessionContext'
import { errorMessage, newIdempotencyKey } from '../../services/api/client'
import { formatDateTime, formatSom, formatTime } from '../../utils/format'
import type { CashoutMethod, DriverPayment, LedgerEntry, PaymentPeriod } from '../../types/driver'
import './DriverPayments.css'

type TabType = 'payments' | 'ledger' | 'cashouts'

const PRESET_REFUND_REASONS = [
  "Mijoz adashib to'ladi",
  'Ortiqcha summa yuborildi',
  "Mijoz boshqa transportga o'tdi",
  'Texnik nosozlik',
  'Boshqa sabab',
]

const PERIODS: { id: PaymentPeriod; label: string }[] = [
  { id: 'today', label: 'Bugun' },
  { id: 'week', label: '7 kun' },
  { id: 'month', label: '30 kun' },
  { id: 'all', label: 'Barchasi' },
]

const METHOD_LABEL: Record<string, string> = { wallet: 'Hamyon', click: 'Click' }
const IDENT_LABEL: Record<string, string> = { qr: 'QR', nfc: 'NFC', manual: 'Raqam' }

const LEDGER_META: Record<string, { icon: string; label: string; css: string }> = {
  ride_earning: { icon: 'ri-arrow-down-line', label: 'Yo‘l haqi', css: 'ride_payment' },
  refund_reversal: { icon: 'ri-arrow-go-back-line', label: 'Qaytarish', css: 'refund' },
  cashout: { icon: 'ri-arrow-up-line', label: 'Pul yechish', css: 'cashout' },
  adjustment: { icon: 'ri-equalizer-line', label: 'Tuzatish', css: 'adjustment' },
}

function ledgerMeta(entry: LedgerEntry) {
  return LEDGER_META[entry.entryType] ?? { icon: 'ri-exchange-line', label: entry.entryType, css: 'adjustment' }
}

function canRefund(p: DriverPayment, now: number): boolean {
  return p.status === 'completed' && p.refundable && (p.refundableUntilMs === null || now < p.refundableUntilMs)
}

function minutesLeft(p: DriverPayment, now: number): number | null {
  if (p.refundableUntilMs === null) return null
  return Math.max(0, Math.ceil((p.refundableUntilMs - now) / 60_000))
}

export function DriverPayments() {
  const { me } = useDriverSession()
  const [period, setPeriod] = useState<PaymentPeriod>('today')
  const { payments, balance, ledger, cashouts, isLoading, error, refresh, refundPayment, requestCashout, toast, clearToast } =
    useDriverPayments(period)
  const vehicleLabel = me?.vehicle ? me.vehicle.plateNumber || me.vehicle.internalId : null

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(clearToast, 6000)
    return () => clearTimeout(t)
  }, [toast, clearToast])

  const [activeTab, setActiveTab] = useState<TabType>('payments')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'refunded'>('all')

  // Refund dialog
  const [refundTarget, setRefundTarget] = useState<DriverPayment | null>(null)
  const [selectedReason, setSelectedReason] = useState(PRESET_REFUND_REASONS[0])
  const [customReason, setCustomReason] = useState('')
  const [isRefunding, setIsRefunding] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)

  // Cash-out dialog (one idempotency key per dialog: retries never create a second request)
  const [isCashoutOpen, setIsCashoutOpen] = useState(false)
  const [cashoutKey, setCashoutKey] = useState('')
  const [cashoutAmount, setCashoutAmount] = useState<number>(0)
  const [cashoutMethod, setCashoutMethod] = useState<CashoutMethod>('cash')
  const [cashoutDetails, setCashoutDetails] = useState('')
  const [isSubmittingCashout, setIsSubmittingCashout] = useState(false)
  const [cashoutError, setCashoutError] = useState<string | null>(null)

  const filteredPayments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return payments.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (!q) return true
      return (
        p.reference.toLowerCase().includes(q) ||
        p.passengerLabel.toLowerCase().includes(q) ||
        (METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod).toLowerCase().includes(q)
      )
    })
  }, [payments, statusFilter, searchQuery])

  const openRefund = (payment: DriverPayment) => {
    setRefundTarget(payment)
    setSelectedReason(PRESET_REFUND_REASONS[0])
    setCustomReason('')
    setRefundError(null)
  }

  const finalReason = selectedReason === 'Boshqa sabab' ? customReason.trim() : selectedReason

  const handleConfirmRefund = async () => {
    if (!refundTarget) return
    if (finalReason.length < 3) {
      setRefundError('Sababni kamida 3 ta belgi bilan yozing')
      return
    }
    setIsRefunding(true)
    setRefundError(null)
    try {
      await refundPayment(refundTarget.id, finalReason)
      setRefundTarget(null)
    } catch (err) {
      setRefundError(errorMessage(err, 'To‘lovni qaytarishda xatolik yuz berdi'))
    } finally {
      setIsRefunding(false)
    }
  }

  const openCashout = () => {
    setCashoutKey(newIdempotencyKey())
    setCashoutAmount(balance?.availableBalance ?? 0)
    setCashoutMethod('cash')
    setCashoutDetails('')
    setCashoutError(null)
    setIsCashoutOpen(true)
  }

  const handleConfirmCashout = async () => {
    const available = balance?.availableBalance ?? 0
    if (!cashoutAmount || cashoutAmount <= 0) {
      setCashoutError('Summani to‘g‘ri kiriting')
      return
    }
    if (cashoutAmount > available) {
      setCashoutError(`Mavjud balansdan (${formatSom(available)}) ko‘p yechib bo‘lmaydi`)
      return
    }
    if (cashoutMethod !== 'cash' && cashoutDetails.trim().length < 4) {
      setCashoutError('Karta yoki hisob raqamini kiriting')
      return
    }
    setIsSubmittingCashout(true)
    setCashoutError(null)
    try {
      await requestCashout({ amountUzs: cashoutAmount, method: cashoutMethod, payoutDetails: cashoutDetails }, cashoutKey)
      setIsCashoutOpen(false)
    } catch (err) {
      setCashoutError(errorMessage(err, 'Pul yechish so‘rovini yuborishda xatolik'))
    } finally {
      setIsSubmittingCashout(false)
    }
  }

  const completedCount = payments.filter((p) => p.status === 'completed').length
  const refundedCount = payments.filter((p) => p.status === 'refunded').length

  return (
    <div className="driver-payments-container">
      {toast && (
        <div className={`payment-toast-banner ${toast.type}`} role="status">
          <div className="payment-toast-content">
            <i
              className={
                toast.type === 'success' ? 'ri-checkbox-circle-fill' : toast.type === 'warning' ? 'ri-arrow-go-back-line' : 'ri-information-fill'
              }
            />
            <div className="payment-toast-text">
              <h4>{toast.title}</h4>
              <p>{toast.message}</p>
            </div>
          </div>
          <button className="btn-toast-close" onClick={clearToast} aria-label="Yopish">
            <i className="ri-close-line" />
          </button>
        </div>
      )}

      <div className="payments-header">
        <div className="payments-header__title">
          <i className="ri-wallet-3-fill" style={{ fontSize: '1.4rem', color: 'var(--accent-primary)' }} />
          <h1>To'lovlar</h1>
          <span className="payments-live-badge">
            <span className="payments-live-badge__dot" />
            Jonli
          </span>
        </div>
        <div className="payments-header__actions">
          <button className="btn-refresh-icon" onClick={() => void refresh()} title="Yangilash" aria-label="Yangilash">
            <i className={`ri-refresh-line ${isLoading ? 'spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="vehicle-scope-banner">
        <div className="vehicle-scope-banner__info">
          <i className="ri-shield-check-line" />
          <span>
            Transportingiz: <strong className="vehicle-scope-badge">{vehicleLabel ?? 'biriktirilmagan'}</strong>
          </span>
        </div>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Faqat o'z to'lovlaringiz</span>
      </div>

      {error && (
        <div className="backend-rejection-alert" role="alert">
          <i className="ri-error-warning-fill" />
          <div>
            {error}{' '}
            <button className="filter-chip" onClick={() => void refresh()}>
              Qayta urinish
            </button>
          </div>
        </div>
      )}

      <div className="balance-card">
        <div className="balance-card__top">
          <div>
            <div className="balance-card__label">
              <i className="ri-bank-card-line" />
              Yechish mumkin
            </div>
            <div className="balance-card__amount">
              {/* Never show a real-looking 0 before the balance has arrived */}
              {balance ? balance.availableBalance.toLocaleString('ru-RU').replace(/,/g, ' ') : '—'}
              <span className="balance-card__currency">so'm</span>
            </div>
            {balance && balance.pendingCashout > 0 && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>
                {formatSom(balance.pendingCashout)} yechish so‘rovlarida band
              </div>
            )}
          </div>
          <button className="btn-cashout-cta" onClick={openCashout} disabled={!balance || balance.availableBalance <= 0}>
            <i className="ri-hand-coin-line" />
            Pul yechish
          </button>
        </div>

        <div className="balance-metrics-grid">
          <div className="metric-item">
            <span className="metric-item__label">Bugungi sof tushum</span>
            <span className="metric-item__value success">{balance ? `+${formatSom(balance.todayEarnings)}` : '—'}</span>
          </div>
          <div className="metric-item">
            <span className="metric-item__label">Bugungi qatnovlar</span>
            <span className="metric-item__value">{balance ? `${balance.ridesCountToday} ta` : '—'}</span>
          </div>
          <div className="metric-item">
            <span className="metric-item__label">Qaytarilgan</span>
            <span className="metric-item__value warning">{balance ? formatSom(balance.totalRefundedToday) : '—'}</span>
          </div>
        </div>
      </div>

      <div className="payments-tabs" role="tablist">
        <button role="tab" aria-selected={activeTab === 'payments'} className={`payments-tab-btn ${activeTab === 'payments' ? 'active' : ''}`} onClick={() => setActiveTab('payments')}>
          <i className="ri-list-check-2" />
          To'lovlar
          <span className="tab-count">{payments.length}</span>
        </button>
        <button role="tab" aria-selected={activeTab === 'ledger'} className={`payments-tab-btn ${activeTab === 'ledger' ? 'active' : ''}`} onClick={() => setActiveTab('ledger')}>
          <i className="ri-book-open-line" />
          Hisob tarixi
          <span className="tab-count">{ledger.length}</span>
        </button>
        <button role="tab" aria-selected={activeTab === 'cashouts'} className={`payments-tab-btn ${activeTab === 'cashouts' ? 'active' : ''}`} onClick={() => setActiveTab('cashouts')}>
          <i className="ri-hand-coin-line" />
          Yechishlar
          <span className="tab-count">{cashouts.length}</span>
        </button>
      </div>

      {activeTab === 'payments' && (
        <>
          <div className="payments-filter-bar">
            <div className="status-filter-chips">
              {PERIODS.map((p) => (
                <button key={p.id} className={`filter-chip ${period === p.id ? 'active' : ''}`} onClick={() => setPeriod(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="search-box">
              <i className="ri-search-line" />
              <input
                type="text"
                placeholder="Chek raqami yoki to‘lovchi…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Qidirish"
              />
              {searchQuery && (
                <button
                  style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
                  onClick={() => setSearchQuery('')}
                  aria-label="Tozalash"
                >
                  <i className="ri-close-circle-fill" />
                </button>
              )}
            </div>
            <div className="status-filter-chips">
              <button className={`filter-chip ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>
                Barchasi ({payments.length})
              </button>
              <button className={`filter-chip ${statusFilter === 'completed' ? 'active' : ''}`} onClick={() => setStatusFilter('completed')}>
                Muvaffaqiyatli ({completedCount})
              </button>
              <button className={`filter-chip ${statusFilter === 'refunded' ? 'active' : ''}`} onClick={() => setStatusFilter('refunded')}>
                Qaytarilgan ({refundedCount})
              </button>
            </div>
          </div>

          {isLoading && payments.length === 0 ? (
            <div className="empty-state-box">
              <div className="loading-spinner" />
              <p>To'lovlar yuklanmoqda...</p>
            </div>
          ) : filteredPayments.length === 0 ? (
            <div className="empty-state-box">
              <i className="ri-inbox-line" />
              <p>{payments.length === 0 ? 'Bu davrda to‘lovlar yo‘q.' : 'Mos keluvchi to‘lovlar topilmadi.'}</p>
            </div>
          ) : (
            <div className="payments-list">
              {filteredPayments.map((payment) => {
                const refundable = canRefund(payment, now)
                const left = minutesLeft(payment, now)
                return (
                  <div key={payment.id} className={`payment-card ${payment.status === 'refunded' ? 'refunded' : ''}`}>
                    <div className="payment-card__left">
                      <div className={`payment-method-icon ${payment.paymentMethod}`}>
                        <i className={payment.paymentMethod === 'wallet' ? 'ri-wallet-3-line' : 'ri-cursor-line'} />
                      </div>
                      <div className="payment-card__info">
                        <div className="payment-card__ref-row">
                          <span className="payment-card__ref">{payment.reference}</span>
                          <span className="payment-method-tag">
                            {METHOD_LABEL[payment.paymentMethod] ?? payment.paymentMethod} · {IDENT_LABEL[payment.identificationMethod] ?? payment.identificationMethod}
                          </span>
                        </div>
                        <div className="payment-card__meta">
                          <span>{payment.passengerLabel}</span>
                          <span className="dot">•</span>
                          <span>{period === 'today' ? formatTime(payment.createdAtMs) : formatDateTime(payment.createdAtMs)}</span>
                        </div>
                        {payment.status === 'refunded' && payment.refundReason && (
                          <div className="payment-card__meta">
                            <span>Sabab: {payment.refundReason}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="payment-card__right">
                      <div className={`payment-card__amount ${payment.status === 'refunded' ? 'refunded' : ''}`}>
                        {payment.status === 'refunded' ? '−' : '+'}
                        {formatSom(payment.amountUzs)}
                      </div>
                      {payment.status === 'completed' ? (
                        <>
                          <span className="payment-status-badge completed">
                            <i className="ri-checkbox-circle-fill" />
                            Qabul qilindi
                          </span>
                          {refundable ? (
                            <button className="btn-undo-refund" onClick={() => openRefund(payment)} title="Yo‘lovchiga pulni qaytarish">
                              <i className="ri-arrow-go-back-line" />
                              Bekor qilish{left !== null ? ` · ${left} daq` : ''}
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>Qaytarish muddati tugagan</span>
                          )}
                        </>
                      ) : payment.status === 'refunded' ? (
                        <span className="payment-status-badge refunded">
                          <i className="ri-arrow-go-back-fill" />
                          Qaytarildi
                        </span>
                      ) : (
                        <span className="payment-status-badge refunded">Muvaffaqiyatsiz</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {activeTab === 'ledger' && (
        <div className="ledger-timeline">
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.25rem 0' }}>
            Hisobingizdagi barcha kirim va chiqimlar (o‘zgarmas yozuvlar):
          </p>
          {ledger.length === 0 ? (
            <div className="empty-state-box">
              <i className="ri-file-list-3-line" />
              <p>{isLoading ? 'Yuklanmoqda…' : 'Hisob yozuvlari mavjud emas.'}</p>
            </div>
          ) : (
            ledger.map((item) => {
              const meta = ledgerMeta(item)
              return (
                <div key={item.id} className="ledger-item">
                  <div className="ledger-item__left">
                    <div className={`ledger-type-icon ${meta.css}`}>
                      <i className={meta.icon} />
                    </div>
                    <div>
                      <div className="ledger-item__desc">{item.description}</div>
                      <div className="ledger-item__meta">
                        <span>{meta.label}</span>
                        <span>•</span>
                        <span>{formatDateTime(item.createdAtMs)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="ledger-item__right">
                    <div className={`ledger-item__amount ${item.amountUzs > 0 ? 'credit' : 'debit'}`}>
                      {item.amountUzs > 0 ? '+' : '−'}
                      {formatSom(Math.abs(item.amountUzs))}
                    </div>
                    <div className="ledger-item__balance-after">Balans: {formatSom(item.balanceAfterUzs)}</div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {activeTab === 'cashouts' && (
        <div className="cashouts-list">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Yechish mumkin: <strong>{balance ? formatSom(balance.availableBalance) : '—'}</strong>
            </span>
            <button className="btn-cashout-cta" onClick={openCashout} disabled={!balance || balance.availableBalance <= 0}>
              <i className="ri-add-line" />
              Yangi so'rov
            </button>
          </div>

          {cashouts.length === 0 ? (
            <div className="empty-state-box">
              <i className="ri-hand-coin-line" />
              <p>Hozircha pul yechish so'rovlari mavjud emas.</p>
            </div>
          ) : (
            cashouts.map((req) => (
              <div key={req.id} className="cashout-card">
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{formatSom(req.amountUzs)}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {req.method === 'cash' ? 'Naqd (Uyushma kassasi)' : req.method === 'card' ? 'Karta' : 'Bank hisobi'}
                    {req.payoutDetails ? ` · ${req.payoutDetails}` : ''}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>
                    #{req.id} · {formatDateTime(req.createdAtMs)}
                    {req.paymentReference ? ` · Chek: ${req.paymentReference}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                  <span className={`cashout-status-badge ${req.status}`}>
                    {req.status === 'pending' && 'Kutilmoqda'}
                    {req.status === 'approved' && 'Tasdiqlandi'}
                    {req.status === 'paid' && "To'landi"}
                    {req.status === 'rejected' && 'Rad etildi'}
                  </span>
                  {req.rejectionReason && <span style={{ fontSize: '0.65rem', color: 'var(--danger)' }}>{req.rejectionReason}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {refundTarget && (
        <div className="modal-overlay" onClick={() => !isRefunding && setRefundTarget(null)}>
          <div className="modal-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <i className="ri-arrow-go-back-line" style={{ color: 'var(--warning)' }} />
                To'lovni bekor qilish
              </h3>
              <button className="btn-modal-close" onClick={() => setRefundTarget(null)} disabled={isRefunding} aria-label="Yopish">
                <i className="ri-close-line" />
              </button>
            </div>

            <div className="refund-warning-box">
              <i className="ri-alert-line" />
              <div>Summa yo‘lovchining hamyoniga qaytariladi va sizning balansingizdan yechiladi. Amal auditga yoziladi.</div>
            </div>

            <div className="modal-txn-summary">
              <div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Chek</div>
                <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{refundTarget.reference}</div>
              </div>
              <div className="amount">−{formatSom(refundTarget.amountUzs)}</div>
            </div>

            {refundError && (
              <div className="backend-rejection-alert" role="alert">
                <i className="ri-error-warning-fill" />
                <div>
                  <strong>Rad etildi:</strong> {refundError}
                </div>
              </div>
            )}

            <div className="form-group">
              <label>Bekor qilish sababi:</label>
              <div className="reasons-options-list">
                {PRESET_REFUND_REASONS.map((reason) => (
                  <label key={reason} className="reason-option-label">
                    <input type="radio" name="refundReason" value={reason} checked={selectedReason === reason} onChange={() => setSelectedReason(reason)} />
                    <span>{reason}</span>
                  </label>
                ))}
              </div>
            </div>

            {selectedReason === 'Boshqa sabab' && (
              <div className="form-group">
                <label htmlFor="refund-custom">Sabab:</label>
                <textarea
                  id="refund-custom"
                  className="form-textarea"
                  rows={2}
                  maxLength={255}
                  placeholder="Sababni yozing..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                />
              </div>
            )}

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setRefundTarget(null)} disabled={isRefunding}>
                Yopish
              </button>
              <button className="btn-confirm-refund" onClick={() => void handleConfirmRefund()} disabled={isRefunding || finalReason.length < 3}>
                {isRefunding ? (
                  <>
                    <div className="loading-spinner" style={{ width: 14, height: 14 }} />
                    Qaytarilmoqda...
                  </>
                ) : (
                  <>
                    <i className="ri-check-line" />
                    Ha, qaytarilsin
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {isCashoutOpen && (
        <div className="modal-overlay" onClick={() => !isSubmittingCashout && setIsCashoutOpen(false)}>
          <div className="modal-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <i className="ri-hand-coin-line" style={{ color: 'var(--accent-primary)' }} />
                Pul yechish so'rovi
              </h3>
              <button className="btn-modal-close" onClick={() => setIsCashoutOpen(false)} disabled={isSubmittingCashout} aria-label="Yopish">
                <i className="ri-close-line" />
              </button>
            </div>

            <div className="modal-txn-summary">
              <span style={{ color: 'var(--text-secondary)' }}>Yechish mumkin:</span>
              <strong style={{ color: 'var(--accent-primary)', fontSize: '1.1rem' }}>{formatSom(balance?.availableBalance ?? 0)}</strong>
            </div>

            {cashoutError && (
              <div className="backend-rejection-alert" role="alert">
                <i className="ri-error-warning-fill" />
                <div>{cashoutError}</div>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="cashout-amount">Summa (so‘m):</label>
              <input
                id="cashout-amount"
                type="number"
                inputMode="numeric"
                className="form-input"
                value={cashoutAmount || ''}
                onChange={(e) => setCashoutAmount(Math.floor(Number(e.target.value)))}
                min={1}
                step={1000}
              />
              <div className="quick-percentages-row">
                {[0.25, 0.5, 1].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    className="btn-quick-pct"
                    onClick={() => setCashoutAmount(Math.floor((balance?.availableBalance ?? 0) * pct))}
                  >
                    {pct * 100}%
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="cashout-method">Qabul qilish usuli:</label>
              <select id="cashout-method" className="form-select" value={cashoutMethod} onChange={(e) => setCashoutMethod(e.target.value as CashoutMethod)}>
                <option value="cash">Uyushma kassasidan naqd</option>
                <option value="card">Plastik karta (Uzcard / Humo)</option>
                <option value="bank">Bank hisob raqami</option>
              </select>
            </div>

            {cashoutMethod !== 'cash' && (
              <div className="form-group">
                <label htmlFor="cashout-details">{cashoutMethod === 'card' ? 'Karta raqami' : 'Hisob raqami'}:</label>
                <input
                  id="cashout-details"
                  type="text"
                  className="form-input"
                  value={cashoutDetails}
                  maxLength={255}
                  onChange={(e) => setCashoutDetails(e.target.value)}
                  placeholder={cashoutMethod === 'card' ? '8600 •••• •••• ••••' : '2020 8000 …'}
                />
              </div>
            )}

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setIsCashoutOpen(false)} disabled={isSubmittingCashout}>
                Bekor qilish
              </button>
              <button className="btn-confirm-cashout" onClick={() => void handleConfirmCashout()} disabled={isSubmittingCashout}>
                {isSubmittingCashout ? (
                  <>
                    <div className="loading-spinner" style={{ width: 14, height: 14 }} />
                    Yuborilmoqda...
                  </>
                ) : (
                  <>
                    <i className="ri-send-plane-line" />
                    So'rov yuborish
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
