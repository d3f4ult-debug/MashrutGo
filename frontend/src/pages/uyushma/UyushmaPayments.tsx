import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { financeApi } from '../../services/api/financeApi';
import { uyushmaApi } from '../../services/api/uyushmaApi';
import type {
  UyushmaPaymentTransaction,
  UyushmaCashoutRequest,
  FinanceSummary,
} from '../../types/finance';
import type { UyushmaRoute } from '../../types/uyushma';
import './UyushmaOperations.css';
import './UyushmaFinance.css';

type FinanceTab = 'payments' | 'cashouts' | 'summary';

export function UyushmaPayments() {
  const { user } = useAuth();
  const uyushmaId = user?.uyushma_id || 'uyushma-01';

  const [activeTab, setActiveTab] = useState<FinanceTab>('payments');
  const [payments, setPayments] = useState<UyushmaPaymentTransaction[]>([]);
  const [cashouts, setCashouts] = useState<UyushmaCashoutRequest[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [routes, setRoutes] = useState<UyushmaRoute[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [selectedMethod, setSelectedMethod] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  // Cashout Modals
  const [rejectingCashout, setRejectingCashout] = useState<UyushmaCashoutRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isSubmittingReject, setIsSubmittingReject] = useState(false);

  const [payingCashout, setPayingCashout] = useState<UyushmaCashoutRequest | null>(null);
  const [paymentReference, setPaymentReference] = useState('');
  const [isSubmittingPay, setIsSubmittingPay] = useState(false);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [pmts, csh, sum, rts] = await Promise.all([
        financeApi.getPayments(uyushmaId),
        financeApi.getCashouts(uyushmaId),
        financeApi.getFinanceSummary(uyushmaId),
        uyushmaApi.getRoutes(uyushmaId),
      ]);
      setPayments(pmts);
      setCashouts(csh);
      setSummary(sum);
      setRoutes(rts);
    } catch {
      // Fallback in API
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [uyushmaId]);

  // Filtered Payments
  const filteredPayments = useMemo(() => {
    return payments.filter(p => {
      if (selectedRouteId && p.route_id !== selectedRouteId) return false;
      if (selectedMethod !== 'all' && p.method !== selectedMethod) return false;
      if (selectedStatus !== 'all' && p.status !== selectedStatus) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const refMatch = p.reference_id.toLowerCase().includes(q);
        const driverMatch = p.driver_name.toLowerCase().includes(q);
        const plateMatch = p.vehicle_plate.toLowerCase().includes(q);
        return refMatch || driverMatch || plateMatch;
      }
      return true;
    });
  }, [payments, selectedRouteId, selectedMethod, selectedStatus, searchQuery]);

  // Cashout Actions
  const handleApproveCashout = async (cshId: string) => {
    if (!window.confirm("Ushbu pul yechish so'rovini tasdiqlaysizmi?")) return;
    try {
      const updated = await financeApi.approveCashout(uyushmaId, cshId);
      setCashouts(prev => prev.map(c => (c.id === updated.id ? updated : c)));
      setToastMessage("So'rov muvaffaqiyatli tasdiqlandi (Approved).");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Xatolik yuz berdi');
    }
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingCashout) return;
    if (!rejectionReason.trim()) {
      alert("Iltimos, rad etishning audit sababini kiriting.");
      return;
    }

    setIsSubmittingReject(true);
    try {
      const updated = await financeApi.rejectCashout(uyushmaId, rejectingCashout.id, rejectionReason);
      setCashouts(prev => prev.map(c => (c.id === updated.id ? updated : c)));
      setRejectingCashout(null);
      setRejectionReason('');
      setToastMessage("So'rov rad etildi va audit yozuviga qayd qilindi.");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Xatolik');
    } finally {
      setIsSubmittingReject(false);
    }
  };

  const handleConfirmMarkPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingCashout) return;
    if (!paymentReference.trim()) {
      alert("Iltimos, to'lov cheki yoki bank tranzaksiya raqamini kiriting.");
      return;
    }

    setIsSubmittingPay(true);
    try {
      const updated = await financeApi.markCashoutPaid(uyushmaId, payingCashout.id, paymentReference);
      setCashouts(prev => prev.map(c => (c.id === updated.id ? updated : c)));
      setPayingCashout(null);
      setPaymentReference('');
      setToastMessage("So'rov 'To'landi' deb belgilandi va kassa/bank hisobotiga kiritildi.");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Xatolik');
    } finally {
      setIsSubmittingPay(false);
    }
  };

  const formatUZS = (num: number) => `${num.toLocaleString('uz-UZ')} UZS`;

  return (
    <div className="uyushma-page-container">
      {/* Header */}
      <div className="uyushma-page-header">
        <div className="uyushma-page-header__left">
          <h1>
            <i className="ri-wallet-3-fill" style={{ color: 'var(--accent-primary)' }} />
            Moliya va to'lovlar operatsiyalari
          </h1>
          <p>
            Barcha yo'nalishlar bo'yicha tushumlar, qaytarishlar (refunds) va haydovchilarning pul chiqarish so'rovlari nazorati
          </p>
        </div>

        <div className="uyushma-page-header__actions">
          <button className="btn-secondary-action" onClick={loadData}>
            <i className="ri-refresh-line" />
            Yangilash
          </button>
        </div>
      </div>

      {/* Financial KPIs Grid */}
      <div className="finance-kpis-grid">
        <div className="finance-kpi-card">
          <div className="finance-kpi-card__top">
            <span className="finance-kpi-card__title">Jami tushum (Gross)</span>
            <div className="finance-kpi-card__icon" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>
              <i className="ri-arrow-down-circle-line" />
            </div>
          </div>
          <div className="finance-kpi-card__amount success">
            {formatUZS(summary?.gross_revenue || 0)}
          </div>
          <span className="finance-kpi-card__subtext">
            {summary?.completed_rides_count || 0} ta muvaffaqiyatli qatnov to'lovi
          </span>
        </div>

        <div className="finance-kpi-card">
          <div className="finance-kpi-card__top">
            <span className="finance-kpi-card__title">Qaytarilgan (Refunds)</span>
            <div className="finance-kpi-card__icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' }}>
              <i className="ri-arrow-go-back-line" />
            </div>
          </div>
          <div className="finance-kpi-card__amount warning">
            {formatUZS(summary?.total_refunds || 0)}
          </div>
          <span className="finance-kpi-card__subtext">
            {summary?.refunded_rides_count || 0} ta bekor qilingan tranzaksiya
          </span>
        </div>

        <div className="finance-kpi-card">
          <div className="finance-kpi-card__top">
            <span className="finance-kpi-card__title">Sof tushum (Net)</span>
            <div className="finance-kpi-card__icon" style={{ background: 'var(--success-subtle)', color: 'var(--success)' }}>
              <i className="ri-safe-2-line" />
            </div>
          </div>
          <div className="finance-kpi-card__amount">
            {formatUZS(summary?.net_revenue || 0)}
          </div>
          <span className="finance-kpi-card__subtext">
            Komissiyalar va qaytarishlardan so'ng
          </span>
        </div>

        <div className="finance-kpi-card">
          <div className="finance-kpi-card__top">
            <span className="finance-kpi-card__title">Kutilayotgan pul chiqarish</span>
            <div className="finance-kpi-card__icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)' }}>
              <i className="ri-hand-coin-line" />
            </div>
          </div>
          <div className="finance-kpi-card__amount danger">
            {formatUZS(summary?.pending_cashouts_total || 0)}
          </div>
          <span className="finance-kpi-card__subtext">
            {cashouts.filter(c => c.status === 'pending' || c.status === 'approved').length} ta so'rov kutilmoqda
          </span>
        </div>
      </div>

      {/* Segmented Navigation Tabs */}
      <div className="finance-nav-tabs">
        <button
          className={`finance-tab-btn ${activeTab === 'payments' ? 'active' : ''}`}
          onClick={() => setActiveTab('payments')}
        >
          <i className="ri-file-list-3-line" />
          Barcha to'lovlar va qaytarishlar
          <span className="badge-pill">{payments.length}</span>
        </button>

        <button
          className={`finance-tab-btn ${activeTab === 'cashouts' ? 'active' : ''}`}
          onClick={() => setActiveTab('cashouts')}
        >
          <i className="ri-hand-coin-line" />
          Pul yechish so'rovlari
          <span className="badge-pill" style={{ background: 'var(--warning-subtle)', color: 'var(--warning)' }}>
            {cashouts.filter(c => c.status === 'pending').length} yangi
          </span>
        </button>

        <button
          className={`finance-tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          <i className="ri-pie-chart-line" />
          Tizim komissiyasi va hisobot
        </button>
      </div>

      {/* ── Tab 1: Payments & Refunds List ── */}
      {activeTab === 'payments' && (
        <>
          {/* Filters Bar */}
          <div className="uyushma-toolbar">
            <div className="uyushma-search-input">
              <i className="ri-search-line" />
              <input
                type="text"
                placeholder="Tranzaksiya ID, haydovchi yoki transport raqami..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="finance-filters-row">
              <select
                className="finance-filter-select"
                value={selectedRouteId}
                onChange={e => setSelectedRouteId(e.target.value)}
              >
                <option value="">Barcha yo'nalishlar</option>
                {routes.map(r => (
                  <option key={r.id} value={r.id}>№ {r.route_number}</option>
                ))}
              </select>

              <select
                className="finance-filter-select"
                value={selectedMethod}
                onChange={e => setSelectedMethod(e.target.value)}
              >
                <option value="all">Barcha to'lov usullari</option>
                <option value="click">Click</option>
                <option value="payme">Payme</option>
                <option value="nfc">NFC (Humo/Uzcard)</option>
                <option value="wallet">Hamyon</option>
              </select>

              <select
                className="finance-filter-select"
                value={selectedStatus}
                onChange={e => setSelectedStatus(e.target.value)}
              >
                <option value="all">Barcha holatlar</option>
                <option value="completed">Muvaffaqiyatli</option>
                <option value="refunded">Qaytarilgan (Refund)</option>
              </select>
            </div>
          </div>

          {/* Payments Table */}
          <div className="uyushma-table-wrapper">
            <table className="uyushma-table">
              <thead>
                <tr>
                  <th>Tranzaksiya ID</th>
                  <th>Yo'nalish</th>
                  <th>Transport & Haydovchi</th>
                  <th>To'lov usuli</th>
                  <th>Summa</th>
                  <th>Holat</th>
                  <th>Vaqt</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-secondary)' }}>
                      <i className="ri-loader-4-line ri-spin" style={{ fontSize: '1.5rem', color: 'var(--accent-primary)' }} />
                      <div style={{ marginTop: '0.5rem' }}>Yuklanmoqda...</div>
                    </td>
                  </tr>
                ) : filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
                      To'lovlar topilmadi.
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map(p => (
                    <tr key={p.id}>
                      <td>
                        <strong style={{ fontFamily: 'monospace', fontSize: '0.825rem' }}>{p.reference_id}</strong>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                          {p.passenger_identifier || 'Mijoz'}
                        </div>
                      </td>
                      <td>
                        <span className="route-number-badge">№ {p.route_number}</span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.driver_name}</div>
                        <span className="vehicle-plate-badge">{p.vehicle_plate}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
                          {p.method}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, color: p.status === 'refunded' ? 'var(--text-tertiary)' : 'var(--success)' }}>
                          {p.status === 'refunded' ? '-' : '+'}
                          {formatUZS(p.amount)}
                        </div>
                        {p.status === 'refunded' && (
                          <div style={{ fontSize: '0.675rem', color: 'var(--warning)' }}>
                            {p.refund_reason || 'Qaytarilgan'}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`status-pill ${p.status === 'completed' ? 'active' : 'inactive'}`}>
                          {p.status === 'completed' ? 'Muvaffaqiyatli' : 'Qaytarilgan'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {new Date(p.created_at).toLocaleString('uz-UZ', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Tab 2: Cash-out Requests Approval & Audit ── */}
      {activeTab === 'cashouts' && (
        <div className="uyushma-table-wrapper">
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
                Haydovchilarning pul chiqarish so'rovlari ({cashouts.length})
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
                Bank kartasiga, hisob raqamga yoki kassadan naqd berish uchun tasdiqlash va to'lash jarayoni
              </p>
            </div>
          </div>

          <table className="uyushma-table">
            <thead>
              <tr>
                <th>Haydovchi</th>
                <th>Transport</th>
                <th>Chiqariladigan summa</th>
                <th>To'lov rekvizitlari</th>
                <th>Holat</th>
                <th>So'rov vaqti</th>
                <th style={{ textAlign: 'right' }}>Amallar</th>
              </tr>
            </thead>
            <tbody>
              {cashouts.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
                    Pul yechish so'rovlari mavjud emas.
                  </td>
                </tr>
              ) : (
                cashouts.map(c => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.driver_name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{c.driver_phone}</div>
                    </td>
                    <td>
                      <span className="vehicle-plate-badge">{c.vehicle_plate}</span>
                    </td>
                    <td>
                      <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>
                        {formatUZS(c.amount)}
                      </strong>
                    </td>
                    <td>
                      <div style={{ fontSize: '0.85rem' }}>{c.payout_details}</div>
                      {c.payment_reference && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', fontFamily: 'monospace' }}>
                          Chek: {c.payment_reference}
                        </div>
                      )}
                      {c.rejection_reason && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--danger)' }}>
                          Sabab: {c.rejection_reason}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`status-pill ${c.status === 'paid' ? 'active' : c.status === 'rejected' ? 'inactive' : 'inactive'}`}
                        style={{
                          background: c.status === 'pending' ? 'var(--warning-subtle)' : undefined,
                          color: c.status === 'pending' ? 'var(--warning)' : undefined,
                        }}
                      >
                        {c.status === 'pending' && 'Kutilmoqda'}
                        {c.status === 'approved' && 'Tasdiqlangan'}
                        {c.status === 'paid' && 'To\'langan'}
                        {c.status === 'rejected' && 'Rad etilgan'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {new Date(c.created_at).toLocaleString('uz-UZ', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td>
                      <div className="cashout-action-btns" style={{ justifyContent: 'flex-end' }}>
                        {c.status === 'pending' && (
                          <>
                            <button
                              className="btn-approve-cashout"
                              onClick={() => handleApproveCashout(c.id)}
                              title="Tasdiqlash"
                            >
                              <i className="ri-check-line" />
                              Tasdiqlash
                            </button>
                            <button
                              className="btn-reject-cashout"
                              onClick={() => {
                                setRejectingCashout(c);
                                setRejectionReason('');
                              }}
                              title="Rad etish (Audit)"
                            >
                              <i className="ri-close-line" />
                              Rad etish
                            </button>
                          </>
                        )}

                        {c.status === 'approved' && (
                          <button
                            className="btn-mark-paid"
                            onClick={() => {
                              setPayingCashout(c);
                              setPaymentReference(`CHQ-${Date.now().toString().slice(-6)}`);
                            }}
                            title="To'landi deb belgilash"
                          >
                            <i className="ri-bank-card-line" />
                            To'landi (Chek)
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Tab 3: Summary Breakdown ── */}
      {activeTab === 'summary' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
          <div className="finance-kpi-card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 1rem 0' }}>
              Daromad va Qaytarishlar taqsimoti
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Umumiy qatnov to'lovlari (Gross):</span>
                <strong>{formatUZS(summary?.gross_revenue || 0)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Yo'lovchilarga qaytarilgan (Refunds):</span>
                <strong style={{ color: 'var(--warning)' }}>-{formatUZS(summary?.total_refunds || 0)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Tizim xizmat haqi (Platform commission):</span>
                <strong style={{ color: 'var(--danger)' }}>-{formatUZS(summary?.platform_commission || 0)}</strong>
              </div>
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 800 }}>
                <span>Sof tushum (Net):</span>
                <span style={{ color: 'var(--success)' }}>{formatUZS(summary?.net_revenue || 0)}</span>
              </div>
            </div>
          </div>

          <div className="finance-kpi-card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 1rem 0' }}>
              To'lovlar audit ma'lumotlari
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Haydovchilarga to'lab berilgan pul:</span>
                <strong style={{ color: 'var(--success)' }}>{formatUZS(summary?.paid_cashouts_total || 0)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Kutilayotgan yechib olishlar:</span>
                <strong style={{ color: 'var(--warning)' }}>{formatUZS(summary?.pending_cashouts_total || 0)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Jami muvaffaqiyatli tranzaksiyalar:</span>
                <strong>{summary?.completed_rides_count || 0} ta</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Destructive Cashout Rejection with Audit Reason ── */}
      {rejectingCashout && (
        <div className="uyushma-modal-overlay" onClick={() => !isSubmittingReject && setRejectingCashout(null)}>
          <div className="uyushma-modal-card" onClick={e => e.stopPropagation()}>
            <div className="uyushma-modal-header">
              <h3>
                <i className="ri-close-circle-fill" style={{ color: 'var(--danger)' }} />
                Pul chiqarish so'rovini rad etish (Audit)
              </h3>
              <button
                className="btn-modal-close"
                onClick={() => setRejectingCashout(null)}
                disabled={isSubmittingReject}
              >
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={handleConfirmReject}>
              <div className="uyushma-modal-body">
                <div className="audit-warning-box">
                  <i className="ri-alert-line" />
                  <div>
                    <strong>Moliyaviy destruktiv amal:</strong> Rad etish haqidagi audit sababi tizimda doimiy saqlanadi va haydovchi ilovasida aks etadi.
                  </div>
                </div>

                <div style={{ background: 'var(--surface-elevated)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Haydovchi va Summa</div>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>
                    {rejectingCashout.driver_name} — {formatUZS(rejectingCashout.amount)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>
                    {rejectingCashout.payout_details}
                  </div>
                </div>

                <div className="uyushma-form-group">
                  <label>Rad etish sababi (Audit reason) *</label>
                  <textarea
                    className="uyushma-textarea"
                    rows={3}
                    placeholder="Masalan: Karta raqami noto'g'ri ko'rsatilgan yoki haydovchining shaxsiy hisobida qarzdorlik mavjud..."
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="uyushma-modal-footer">
                <button
                  type="button"
                  className="btn-secondary-action"
                  onClick={() => setRejectingCashout(null)}
                  disabled={isSubmittingReject}
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="btn-primary-action"
                  style={{ background: 'var(--danger)' }}
                  disabled={isSubmittingReject || !rejectionReason.trim()}
                >
                  {isSubmittingReject ? 'Rad etilmoqda...' : 'Rad etishni tasdiqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Mark Cashout Paid with Transaction Reference ── */}
      {payingCashout && (
        <div className="uyushma-modal-overlay" onClick={() => !isSubmittingPay && setPayingCashout(null)}>
          <div className="uyushma-modal-card" onClick={e => e.stopPropagation()}>
            <div className="uyushma-modal-header">
              <h3>
                <i className="ri-bank-card-line" style={{ color: 'var(--accent-primary)' }} />
                To'lov amalga oshirilganini tasdiqlash
              </h3>
              <button
                className="btn-modal-close"
                onClick={() => setPayingCashout(null)}
                disabled={isSubmittingPay}
              >
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={handleConfirmMarkPaid}>
              <div className="uyushma-modal-body">
                <div style={{ background: 'var(--surface-elevated)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>To'lanadigan summa</div>
                  <div style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--success)' }}>
                    {formatUZS(payingCashout.amount)}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', marginTop: '0.2rem' }}>
                    {payingCashout.driver_name} ({payingCashout.payout_details})
                  </div>
                </div>

                <div className="uyushma-form-group">
                  <label>To'lov cheki yoki tranzaksiya raqami (Reference ID) *</label>
                  <input
                    type="text"
                    className="uyushma-input"
                    placeholder="Masalan: BNK-TXN-90241"
                    value={paymentReference}
                    onChange={e => setPaymentReference(e.target.value)}
                    required
                  />
                  <span className="hint">Bank to'lov kvitansiyasi yoki kassa orderi raqami</span>
                </div>
              </div>

              <div className="uyushma-modal-footer">
                <button
                  type="button"
                  className="btn-secondary-action"
                  onClick={() => setPayingCashout(null)}
                  disabled={isSubmittingPay}
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="btn-primary-action"
                  disabled={isSubmittingPay || !paymentReference.trim()}
                >
                  {isSubmittingPay ? 'Saqlanmoqda...' : 'To\'landi deb tasdiqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast popup */}
      {toastMessage && (
        <div
          className="payment-toast-banner success"
          style={{ top: '5rem', zIndex: 9999 }}
          onClick={() => setToastMessage(null)}
        >
          <div className="payment-toast-content">
            <i className="ri-checkbox-circle-fill" />
            <div className="payment-toast-text">
              <p>{toastMessage}</p>
            </div>
          </div>
          <button className="btn-toast-close" onClick={() => setToastMessage(null)}>
            <i className="ri-close-line" />
          </button>
        </div>
      )}
    </div>
  );
}
