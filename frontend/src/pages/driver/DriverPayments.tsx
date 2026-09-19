import { useState, useMemo } from 'react';
import { useDriverPayments } from '../../hooks/useDriverPayments';
import type { DriverPayment } from '../../types/payment';
import './DriverPayments.css';

type TabType = 'payments' | 'ledger' | 'cashouts';

const PRESET_REFUND_REASONS = [
  "Mijoz adashib to'ladi",
  "Ortiqcha summa yuborildi",
  "Boshqa transportga o'tdi",
  "Texnik nosozlik tufayli",
  "Boshqa sabab",
];

export function DriverPayments() {
  const {
    payments,
    balance,
    ledger,
    cashouts,
    isLoading,
    refresh,
    refundPayment,
    requestCashout,
    simulateIncomingPayment,
    recentNotification,
    clearNotification,
    vehicleId,
  } = useDriverPayments();

  // Active tab state
  const [activeTab, setActiveTab] = useState<TabType>('payments');

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'refunded'>('all');

  // Refund modal state
  const [refundTarget, setRefundTarget] = useState<DriverPayment | null>(null);
  const [selectedReason, setSelectedReason] = useState<string>(PRESET_REFUND_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [isRefunding, setIsRefunding] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  // Cash-out modal state
  const [isCashoutOpen, setIsCashoutOpen] = useState(false);
  const [cashoutAmount, setCashoutAmount] = useState<number>(50000);
  const [cashoutMethod, setCashoutMethod] = useState<'card' | 'bank' | 'cash'>('card');
  const [cashoutDetails, setCashoutDetails] = useState('8600 •••• 4123 (Uzcard)');
  const [isSubmittingCashout, setIsSubmittingCashout] = useState(false);
  const [cashoutError, setCashoutError] = useState<string | null>(null);

  // Filter payments
  const filteredPayments = useMemo(() => {
    return payments.filter(p => {
      // Security check: strictly vehicle's payments
      if (p.vehicle_id !== vehicleId) return false;

      // Status filter
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const refMatch = p.reference_id.toLowerCase().includes(q);
        const methodMatch = p.method.toLowerCase().includes(q);
        const passMatch = p.passenger_identifier?.toLowerCase().includes(q) || false;
        return refMatch || methodMatch || passMatch;
      }

      return true;
    });
  }, [payments, vehicleId, statusFilter, searchQuery]);

  // Handle open refund modal
  const handleOpenRefund = (payment: DriverPayment) => {
    // Client-side verification
    if (payment.vehicle_id !== vehicleId) {
      alert("Xavfsizlik: Boshqa transport to'lovini bekor qilib bo'lmaydi!");
      return;
    }
    setRefundTarget(payment);
    setSelectedReason(PRESET_REFUND_REASONS[0]);
    setCustomReason('');
    setRefundError(null);
  };

  // Confirm refund execution
  const handleConfirmRefund = async () => {
    if (!refundTarget) return;

    setIsRefunding(true);
    setRefundError(null);

    const finalReason = selectedReason === "Boshqa sabab" && customReason.trim()
      ? customReason.trim()
      : selectedReason;

    try {
      await refundPayment(refundTarget.id, finalReason);
      setRefundTarget(null);
    } catch (err: unknown) {
      // Backend rejection handling & display
      const msg = err instanceof Error ? err.message : "To'lovni bekor qilishda xatolik yuz berdi.";
      setRefundError(msg);
    } finally {
      setIsRefunding(false);
    }
  };

  // Submit cash-out request
  const handleConfirmCashout = async () => {
    if (!cashoutAmount || cashoutAmount <= 0) {
      setCashoutError("Iltimos, to'g'ri summani kiriting.");
      return;
    }

    if (balance && cashoutAmount > balance.available_balance) {
      setCashoutError(`Mavjud balansdan (${balance.available_balance.toLocaleString('uz-UZ')} so'm) ko'p mablag' yechib bo'lmaydi.`);
      return;
    }

    setIsSubmittingCashout(true);
    setCashoutError(null);

    try {
      await requestCashout(cashoutAmount, cashoutMethod, cashoutDetails);
      setIsCashoutOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Pul chiqarish so'rovini yuborishda xatolik.";
      setCashoutError(msg);
    } finally {
      setIsSubmittingCashout(false);
    }
  };

  // Helper for relative or formatted time
  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="driver-payments-container">
      {/* ── Toast notification for incoming payments / alerts ── */}
      {recentNotification && (
        <div className={`payment-toast-banner ${recentNotification.type}`}>
          <div className="payment-toast-content">
            <i className={
              recentNotification.type === 'success'
                ? 'ri-checkbox-circle-fill'
                : recentNotification.type === 'warning'
                ? 'ri-arrow-go-back-line'
                : 'ri-information-fill'
            } />
            <div className="payment-toast-text">
              <h4>{recentNotification.title}</h4>
              <p>{recentNotification.message}</p>
            </div>
          </div>
          <button className="btn-toast-close" onClick={clearNotification}>
            <i className="ri-close-line" />
          </button>
        </div>
      )}

      {/* ── Header ── */}
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
          {import.meta.env.DEV && (
            <button
              className="btn-simulate-payment"
              onClick={() => simulateIncomingPayment('click')}
              title="Dev mode: Yangi to'lov tushishini sinash"
            >
              <i className="ri-add-circle-line" />
              + To'lov
            </button>
          )}
          <button className="btn-refresh-icon" onClick={refresh} title="Yangilash">
            <i className="ri-refresh-line" />
          </button>
        </div>
      </div>

      {/* ── Vehicle Scope Security Notice ── */}
      <div className="vehicle-scope-banner">
        <div className="vehicle-scope-banner__info">
          <i className="ri-shield-check-line" />
          <span>Transportingiz: <strong className="vehicle-scope-badge">{vehicleId}</strong></span>
        </div>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
          Faqat o'z to'lovlaringiz
        </span>
      </div>

      {/* ── Balance & Earnings Summary Card ── */}
      <div className="balance-card">
        <div className="balance-card__top">
          <div>
            <div className="balance-card__label">
              <i className="ri-bank-card-line" />
              Mavjud balans
            </div>
            <div className="balance-card__amount">
              {(balance?.available_balance || 0).toLocaleString('uz-UZ')}
              <span className="balance-card__currency">UZS</span>
            </div>
          </div>
          <button className="btn-cashout-cta" onClick={() => setIsCashoutOpen(true)}>
            <i className="ri-hand-coin-line" />
            Pul yechish
          </button>
        </div>

        <div className="balance-metrics-grid">
          <div className="metric-item">
            <span className="metric-item__label">Bugungi sof tushum</span>
            <span className="metric-item__value success">
              +{(balance?.today_earnings || 0).toLocaleString('uz-UZ')}
            </span>
          </div>

          <div className="metric-item">
            <span className="metric-item__label">Jami qatnovlar</span>
            <span className="metric-item__value">
              {balance?.rides_count_today || 0} ta
            </span>
          </div>

          <div className="metric-item">
            <span className="metric-item__label">Qaytarilgan (Refund)</span>
            <span className="metric-item__value warning">
              {(balance?.total_refunded_today || 0).toLocaleString('uz-UZ')}
            </span>
          </div>
        </div>
      </div>

      {/* ── Segmented Navigation Tabs ── */}
      <div className="payments-tabs">
        <button
          className={`payments-tab-btn ${activeTab === 'payments' ? 'active' : ''}`}
          onClick={() => setActiveTab('payments')}
        >
          <i className="ri-list-check-2" />
          To'lovlar
          <span className="tab-count">{payments.length}</span>
        </button>

        <button
          className={`payments-tab-btn ${activeTab === 'ledger' ? 'active' : ''}`}
          onClick={() => setActiveTab('ledger')}
        >
          <i className="ri-book-open-line" />
          Ledger tarixi
          <span className="tab-count">{ledger.length}</span>
        </button>

        <button
          className={`payments-tab-btn ${activeTab === 'cashouts' ? 'active' : ''}`}
          onClick={() => setActiveTab('cashouts')}
        >
          <i className="ri-hand-coin-line" />
          Chiqarishlar
          <span className="tab-count">{cashouts.length}</span>
        </button>
      </div>

      {/* ── Tab 1: Real-time Payments List ── */}
      {activeTab === 'payments' && (
        <>
          {/* Search & Filter Bar */}
          <div className="payments-filter-bar">
            <div className="search-box">
              <i className="ri-search-line" />
              <input
                type="text"
                placeholder="ID yoki to'lovchi bo'yicha qidiruv..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
                  onClick={() => setSearchQuery('')}
                >
                  <i className="ri-close-circle-fill" />
                </button>
              )}
            </div>

            <div className="status-filter-chips">
              <button
                className={`filter-chip ${statusFilter === 'all' ? 'active' : ''}`}
                onClick={() => setStatusFilter('all')}
              >
                Barchasi ({payments.length})
              </button>
              <button
                className={`filter-chip ${statusFilter === 'completed' ? 'active' : ''}`}
                onClick={() => setStatusFilter('completed')}
              >
                Muvaffaqiyatli ({payments.filter(p => p.status === 'completed').length})
              </button>
              <button
                className={`filter-chip ${statusFilter === 'refunded' ? 'active' : ''}`}
                onClick={() => setStatusFilter('refunded')}
              >
                Qaytarilgan ({payments.filter(p => p.status === 'refunded').length})
              </button>
            </div>
          </div>

          {/* Payments List */}
          {isLoading && payments.length === 0 ? (
            <div className="empty-state-box">
              <div className="loading-spinner" />
              <p>To'lovlar yuklanmoqda...</p>
            </div>
          ) : filteredPayments.length === 0 ? (
            <div className="empty-state-box">
              <i className="ri-inbox-line" />
              <p>Mos keluvchi to'lovlar topilmadi.</p>
            </div>
          ) : (
            <div className="payments-list">
              {filteredPayments.map(payment => (
                <div
                  key={payment.id}
                  className={`payment-card ${payment.status === 'refunded' ? 'refunded' : ''}`}
                >
                  <div className="payment-card__left">
                    <div className={`payment-method-icon ${payment.method}`}>
                      {payment.method === 'click' && <i className="ri-cursor-line" />}
                      {payment.method === 'payme' && <i className="ri-bank-card-2-line" />}
                      {payment.method === 'nfc' && <i className="ri-rfid-line" />}
                      {payment.method === 'wallet' && <i className="ri-wallet-3-line" />}
                      {payment.method === 'cash' && <i className="ri-money-cny-box-line" />}
                    </div>

                    <div className="payment-card__info">
                      <div className="payment-card__ref-row">
                        <span className="payment-card__ref">{payment.reference_id}</span>
                        <span className="payment-method-tag">{payment.method}</span>
                      </div>

                      <div className="payment-card__meta">
                        <span>{payment.passenger_identifier || 'Mijoz'}</span>
                        <span className="dot">•</span>
                        <span>{formatTime(payment.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="payment-card__right">
                    <div className={`payment-card__amount ${payment.status === 'refunded' ? 'refunded' : ''}`}>
                      {payment.status === 'refunded' ? '-' : '+'}
                      {payment.amount.toLocaleString('uz-UZ')} UZS
                    </div>

                    {payment.status === 'completed' ? (
                      <>
                        <span className="payment-status-badge completed">
                          <i className="ri-checkbox-circle-fill" />
                          Muvaffaqiyatli
                        </span>

                        {payment.refundable ? (
                          <button
                            className="btn-undo-refund"
                            onClick={() => handleOpenRefund(payment)}
                            title="Mijozga to'lovni qaytarish"
                          >
                            <i className="ri-arrow-go-back-line" />
                            Bekor qilish
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>
                            Muddati tugagan
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="payment-status-badge refunded">
                        <i className="ri-arrow-go-back-fill" />
                        Qaytarildi
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Tab 2: Ledger Tarixi ── */}
      {activeTab === 'ledger' && (
        <div className="ledger-timeline">
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.25rem 0' }}>
            Barcha debet va kredit harakatlarining shaffof auditi:
          </p>

          {ledger.length === 0 ? (
            <div className="empty-state-box">
              <i className="ri-file-list-3-line" />
              <p>Ledger yozuvlari mavjud emas.</p>
            </div>
          ) : (
            ledger.map(item => (
              <div key={item.id} className="ledger-item">
                <div className="ledger-item__left">
                  <div className={`ledger-type-icon ${item.entry_type}`}>
                    {item.entry_type === 'ride_payment' && <i className="ri-arrow-down-line" />}
                    {item.entry_type === 'refund' && <i className="ri-arrow-go-back-line" />}
                    {item.entry_type === 'cashout' && <i className="ri-arrow-up-line" />}
                    {item.entry_type === 'commission' && <i className="ri-percent-line" />}
                    {item.entry_type === 'adjustment' && <i className="ri-equalizer-line" />}
                  </div>

                  <div>
                    <div className="ledger-item__desc">{item.description}</div>
                    <div className="ledger-item__meta">
                      <span>{item.reference_id}</span>
                      <span>•</span>
                      <span>{formatTime(item.created_at)}</span>
                    </div>
                  </div>
                </div>

                <div className="ledger-item__right">
                  <div className={`ledger-item__amount ${item.amount > 0 ? 'credit' : 'debit'}`}>
                    {item.amount > 0 ? `+${item.amount.toLocaleString('uz-UZ')}` : item.amount.toLocaleString('uz-UZ')} UZS
                  </div>
                  <div className="ledger-item__balance-after">
                    Balans: {item.balance_after.toLocaleString('uz-UZ')}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Tab 3: Pul yechish (Cashout Requests) ── */}
      {activeTab === 'cashouts' && (
        <div className="cashouts-list">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Mavjud balans: <strong>{balance?.available_balance.toLocaleString('uz-UZ')} UZS</strong>
            </span>
            <button className="btn-cashout-cta" onClick={() => setIsCashoutOpen(true)}>
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
            cashouts.map(req => (
              <div key={req.id} className="cashout-card">
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    {req.amount.toLocaleString('uz-UZ')} UZS
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {req.payout_details}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>
                    {formatTime(req.created_at)}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                  <span className={`cashout-status-badge ${req.status}`}>
                    {req.status === 'pending' && 'Kutilmoqda'}
                    {req.status === 'paid' && 'To\'landi'}
                    {req.status === 'approved' && 'Tasdiqlandi'}
                    {req.status === 'rejected' && 'Rad etildi'}
                  </span>
                  {req.rejection_reason && (
                    <span style={{ fontSize: '0.65rem', color: 'var(--danger)' }}>
                      {req.rejection_reason}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Modal: Undo / Refund Confirmation Dialog ── */}
      {refundTarget && (
        <div className="modal-overlay" onClick={() => !isRefunding && setRefundTarget(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <i className="ri-arrow-go-back-line" style={{ color: 'var(--warning)' }} />
                To'lovni bekor qilish (Refund)
              </h3>
              <button
                className="btn-modal-close"
                onClick={() => setRefundTarget(null)}
                disabled={isRefunding}
              >
                <i className="ri-close-line" />
              </button>
            </div>

            <div className="refund-warning-box">
              <i className="ri-alert-line" />
              <div>
                Diqqat! Ushbu amal to'lov summasini yo'lovchiga qaytaradi va sizning balansingizdan chegiriladi.
              </div>
            </div>

            <div className="modal-txn-summary">
              <div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Tranzaksiya</div>
                <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{refundTarget.reference_id}</div>
              </div>
              <div className="amount">
                -{refundTarget.amount.toLocaleString('uz-UZ')} UZS
              </div>
            </div>

            {/* Backend Rejection / Reason Handling Banner */}
            {refundError && (
              <div className="backend-rejection-alert">
                <i className="ri-error-warning-fill" />
                <div>
                  <strong>Rad etildi:</strong> {refundError}
                </div>
              </div>
            )}

            <div className="form-group">
              <label>Bekor qilish sababi:</label>
              <div className="reasons-options-list">
                {PRESET_REFUND_REASONS.map(reason => (
                  <label key={reason} className="reason-option-label">
                    <input
                      type="radio"
                      name="refundReason"
                      value={reason}
                      checked={selectedReason === reason}
                      onChange={() => setSelectedReason(reason)}
                    />
                    <span>{reason}</span>
                  </label>
                ))}
              </div>
            </div>

            {selectedReason === "Boshqa sabab" && (
              <div className="form-group">
                <label>Qo'shimcha izoh:</label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  placeholder="Sababni yozing..."
                  value={customReason}
                  onChange={e => setCustomReason(e.target.value)}
                />
              </div>
            )}

            <div className="modal-actions">
              <button
                className="btn-cancel"
                onClick={() => setRefundTarget(null)}
                disabled={isRefunding}
              >
                Bekor qilish
              </button>
              <button
                className="btn-confirm-refund"
                onClick={handleConfirmRefund}
                disabled={isRefunding}
              >
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

      {/* ── Modal: Cash-out Request Dialog ── */}
      {isCashoutOpen && (
        <div className="modal-overlay" onClick={() => !isSubmittingCashout && setIsCashoutOpen(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <i className="ri-hand-coin-line" style={{ color: 'var(--accent-primary)' }} />
                Pul yechish so'rovi
              </h3>
              <button
                className="btn-modal-close"
                onClick={() => setIsCashoutOpen(false)}
                disabled={isSubmittingCashout}
              >
                <i className="ri-close-line" />
              </button>
            </div>

            <div className="modal-txn-summary">
              <span style={{ color: 'var(--text-secondary)' }}>Mavjud mablag':</span>
              <strong style={{ color: 'var(--accent-primary)', fontSize: '1.1rem' }}>
                {(balance?.available_balance || 0).toLocaleString('uz-UZ')} UZS
              </strong>
            </div>

            {cashoutError && (
              <div className="backend-rejection-alert">
                <i className="ri-error-warning-fill" />
                <div>{cashoutError}</div>
              </div>
            )}

            <div className="form-group">
              <label>Chiqariladigan summa (UZS):</label>
              <input
                type="number"
                className="form-input"
                value={cashoutAmount || ''}
                onChange={e => setCashoutAmount(Number(e.target.value))}
                min={10000}
                step={5000}
              />

              <div className="quick-percentages-row">
                <button
                  type="button"
                  className="btn-quick-pct"
                  onClick={() => setCashoutAmount(Math.floor((balance?.available_balance || 0) * 0.25))}
                >
                  25%
                </button>
                <button
                  type="button"
                  className="btn-quick-pct"
                  onClick={() => setCashoutAmount(Math.floor((balance?.available_balance || 0) * 0.5))}
                >
                  50%
                </button>
                <button
                  type="button"
                  className="btn-quick-pct"
                  onClick={() => setCashoutAmount(balance?.available_balance || 0)}
                >
                  100%
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>Qabul qilish usuli:</label>
              <select
                className="form-select"
                value={cashoutMethod}
                onChange={e => setCashoutMethod(e.target.value as 'card' | 'bank' | 'cash')}
              >
                <option value="card">Plastik karta (Uzcard / Humo)</option>
                <option value="cash">Uyushma kassasi (Naqd)</option>
                <option value="bank">Bank hisob raqami</option>
              </select>
            </div>

            <div className="form-group">
              <label>Karta yoki qabul qiluvchi ma'lumotlari:</label>
              <input
                type="text"
                className="form-input"
                value={cashoutDetails}
                onChange={e => setCashoutDetails(e.target.value)}
                placeholder="8600 •••• •••• ••••"
              />
            </div>

            <div className="modal-actions">
              <button
                className="btn-cancel"
                onClick={() => setIsCashoutOpen(false)}
                disabled={isSubmittingCashout}
              >
                Bekor qilish
              </button>
              <button
                className="btn-confirm-cashout"
                onClick={handleConfirmCashout}
                disabled={isSubmittingCashout}
              >
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
  );
}
