import { useState, useEffect } from 'react';
import { adminApi } from '../../services/api/adminApi';
import type { AdminLiveShift } from '../../types/admin';
import './AdminOperations.css';
import '../uyushma/UyushmaOperations.css';

export function AdminShifts() {
  const [shifts, setShifts] = useState<AdminLiveShift[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [isLoading, setIsLoading] = useState(true);

  // Force End Shift Modal State
  const [selectedShift, setSelectedShift] = useState<AdminLiveShift | null>(null);
  const [forceEndReason, setForceEndReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await adminApi.getLiveShifts();
      setShifts(data);
    } catch {
      // Handled in adminApi fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000); // 10s auto-refresh
    return () => clearInterval(interval);
  }, []);

  const openForceEndModal = (shift: AdminLiveShift) => {
    setSelectedShift(shift);
    setForceEndReason('');
    setModalError(null);
  };

  const handleConfirmForceEnd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShift) return;

    if (!forceEndReason.trim()) {
      setModalError("Smenani majburiy yakunlash uchun sabab ko'rsatish shart!");
      return;
    }

    setIsSubmitting(true);
    try {
      await adminApi.forceEndShift(selectedShift.id, forceEndReason.trim());
      setShifts(prev =>
        prev.map(s => (s.id === selectedShift.id ? { ...s, is_online: false } : s))
      );
      setToastMessage(`${selectedShift.driver_name} (${selectedShift.vehicle_plate}) smenasi majburiy yakunlandi.`);
      setSelectedShift(null);
    } catch (err: any) {
      setModalError(err?.message || "Amalni bajarishda xatolik yuz berdi");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredShifts = shifts.filter(shift => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      shift.driver_name.toLowerCase().includes(query) ||
      shift.vehicle_plate.toLowerCase().includes(query) ||
      shift.uyushma_name.toLowerCase().includes(query) ||
      shift.route_number.toLowerCase().includes(query);

    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'online'
        ? shift.is_online
        : !shift.is_online;

    return matchesSearch && matchesStatus;
  });

  const onlineCount = shifts.filter(s => s.is_online).length;

  return (
    <div className="admin-page-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '1.5rem',
            right: '1.5rem',
            zIndex: 9999,
            background: 'var(--surface-elevated)',
            border: '1px solid var(--admin-accent)',
            color: 'var(--text-primary)',
            padding: '0.85rem 1.25rem',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <i className="ri-checkbox-circle-fill" style={{ color: 'var(--admin-accent)', fontSize: '1.25rem' }} />
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', marginLeft: '0.5rem' }}
          >
            <i className="ri-close-line" />
          </button>
        </div>
      )}

      {/* Page Header */}
      <div className="admin-page-header">
        <div className="admin-page-header__left">
          <h1>
            <i className="ri-radar-line" style={{ color: 'var(--admin-accent)' }} />
            Faol Smenalar va Jonli Transport Nazorati
          </h1>
          <p>Barcha korxona/uyushmalar bo'yicha real-vaqtdagi qatnovlar, telemetriya va dispecherlik nazorati</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            className="btn-operations-secondary"
            onClick={loadData}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <i className="ri-refresh-line" /> Yangilash
          </button>
        </div>
      </div>

      {/* Quick Summary KPIs */}
      <div className="admin-kpis-grid">
        <div className="admin-kpi-card">
          <div className="admin-kpi-card__icon" style={{ background: 'var(--admin-accent-subtle)', color: 'var(--admin-accent)' }}>
            <i className="ri-steering-2-line" />
          </div>
          <div className="admin-kpi-card__content">
            <span className="admin-kpi-card__value">{shifts.length}</span>
            <span className="admin-kpi-card__label">Bugungi Jami Smenalar</span>
          </div>
        </div>

        <div className="admin-kpi-card">
          <div className="admin-kpi-card__icon" style={{ background: 'var(--success-subtle)', color: 'var(--success)' }}>
            <i className="ri-signal-tower-line" />
          </div>
          <div className="admin-kpi-card__content">
            <span className="admin-kpi-card__value">{onlineCount}</span>
            <span className="admin-kpi-card__label">Hozir Yo'nalishda (Online)</span>
          </div>
        </div>

        <div className="admin-kpi-card">
          <div className="admin-kpi-card__icon" style={{ background: 'var(--danger-subtle)', color: 'var(--danger)' }}>
            <i className="ri-shut-down-line" />
          </div>
          <div className="admin-kpi-card__content">
            <span className="admin-kpi-card__value">{shifts.length - onlineCount}</span>
            <span className="admin-kpi-card__label">To'xtatilgan / Oflayn</span>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="operations-filter-bar">
        <div className="operations-filter-bar__search">
          <i className="ri-search-line" />
          <input
            type="text"
            placeholder="Haydovchi, davlat raqami, uyushma yoki yo'nalish bo'yicha qidiruv..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className={`finance-tab ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            Hammasi ({shifts.length})
          </button>
          <button
            className={`finance-tab ${statusFilter === 'online' ? 'active' : ''}`}
            onClick={() => setStatusFilter('online')}
          >
            Online ({onlineCount})
          </button>
          <button
            className={`finance-tab ${statusFilter === 'offline' ? 'active' : ''}`}
            onClick={() => setStatusFilter('offline')}
          >
            Oflayn ({shifts.length - onlineCount})
          </button>
        </div>
      </div>

      {/* Shifts Table */}
      <div className="operations-table-card">
        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <i className="ri-loader-4-line ri-spin" style={{ fontSize: '2rem', color: 'var(--admin-accent)' }} />
            <p style={{ marginTop: '0.5rem' }}>Jonli smena ma'lumotlari yuklanmoqda...</p>
          </div>
        ) : filteredShifts.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <i className="ri-steering-line" style={{ fontSize: '2.5rem', opacity: 0.5 }} />
            <p style={{ marginTop: '0.5rem' }}>Mos keluvchi smenalar topilmadi</p>
          </div>
        ) : (
          <div className="operations-table-wrap">
            <table className="operations-table">
              <thead>
                <tr>
                  <th>Haydovchi</th>
                  <th>Tegishli Uyushma</th>
                  <th>Mashina & Yo'nalish</th>
                  <th>Boshlangan Vaqti</th>
                  <th>So'nggi Telemetriya (GPS)</th>
                  <th>Holat</th>
                  <th style={{ textAlign: 'right' }}>Amallar</th>
                </tr>
              </thead>
              <tbody>
                {filteredShifts.map(shift => (
                  <tr key={shift.id}>
                    <td>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {shift.driver_name}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                          {shift.driver_phone}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                        {shift.uyushma_name}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)', background: 'var(--surface-sunken)', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                          {shift.vehicle_plate}
                        </span>
                        <span className="route-badge-pill" style={{ background: 'var(--admin-accent-subtle)', color: 'var(--admin-accent)' }}>
                          № {shift.route_number}
                        </span>
                      </div>
                    </td>
                    <td style={{ fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
                      {new Date(shift.started_at).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                        <i className="ri-gps-line" style={{ color: shift.is_online ? 'var(--success)' : 'var(--text-tertiary)' }} />
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {new Date(shift.last_heartbeat_at).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    </td>
                    <td>
                      {shift.is_online ? (
                        <span className="status-badge" style={{ background: 'var(--success-subtle)', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success)' }} />
                          Faol (Online)
                        </span>
                      ) : (
                        <span className="status-badge" style={{ background: 'var(--surface-sunken)', color: 'var(--text-tertiary)' }}>
                          Yakunlangan
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {shift.is_online && (
                        <button
                          onClick={() => openForceEndModal(shift)}
                          style={{
                            background: 'var(--danger-subtle)',
                            color: 'var(--danger)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            padding: '0.4rem 0.8rem',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '0.775rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                          }}
                        >
                          <i className="ri-shut-down-line" />
                          Majburiy To'xtatish
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Force End Shift Modal */}
      {selectedShift && (
        <div className="operations-modal-backdrop">
          <div className="operations-modal" style={{ maxWidth: 500 }}>
            <div className="operations-modal__header">
              <h2>
                <i className="ri-alarm-warning-line" style={{ color: 'var(--danger)' }} />
                Smenani Majburiy To'xtatish
              </h2>
              <button className="modal-close-btn" onClick={() => setSelectedShift(null)}>
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={handleConfirmForceEnd}>
              <div className="operations-modal__body">
                {modalError && (
                  <div className="form-error-banner">
                    <i className="ri-error-warning-line" />
                    <span>{modalError}</span>
                  </div>
                )}

                <div className="dangerous-action-banner">
                  <i className="ri-alert-fill" />
                  <div>
                    <strong>OGOHLANTIRISH:</strong> Ushbu amal haydovchining joriy qatnovini ma'muriy tartibda zudlik bilan to'xtatadi, yo'lovchilar jonli xaritasidan transportni o'chiradi va qayta ulanishni cheklaydi.
                  </div>
                </div>

                <div style={{ marginTop: '1rem', background: 'var(--surface-sunken)', padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    Haydovchi: {selectedShift.driver_name} ({selectedShift.driver_phone})
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                    Transport: {selectedShift.vehicle_plate} | Yo'nalish: № {selectedShift.route_number}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>
                    Tashkilot: {selectedShift.uyushma_name}
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label>
                    To'xtatish sababi (Audit jurnaliga majburiy yoziladi) <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <textarea
                    rows={3}
                    value={forceEndReason}
                    onChange={e => setForceEndReason(e.target.value)}
                    placeholder="Masalan: Marshrut chizig'idan asossiz chetga chiqish, GPS uzilishi yoki qoida buzilishi..."
                    required
                    style={{
                      width: '100%',
                      background: 'var(--surface-sunken)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: '0.65rem',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      resize: 'vertical',
                    }}
                  />
                </div>
              </div>

              <div className="operations-modal__footer">
                <button
                  type="button"
                  className="btn-operations-secondary"
                  onClick={() => setSelectedShift(null)}
                  disabled={isSubmitting}
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    background: 'var(--danger)',
                    color: '#fff',
                    border: 'none',
                    padding: '0.6rem 1.2rem',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: 600,
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  {isSubmitting ? (
                    <>
                      <i className="ri-loader-4-line ri-spin" /> To'xtatilmoqda...
                    </>
                  ) : (
                    <>
                      <i className="ri-shut-down-line" /> Majburiy To'xtatishni Tasdiqlash
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
