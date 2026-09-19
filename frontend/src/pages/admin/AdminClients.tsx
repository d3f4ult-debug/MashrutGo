import { useState, useEffect } from 'react';
import { adminApi } from '../../services/api/adminApi';
import type { AdminClientUser } from '../../types/admin';
import './AdminOperations.css';
import '../uyushma/UyushmaOperations.css';

export function AdminClients() {
  const [clients, setClients] = useState<AdminClientUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked'>('all');
  const [isLoading, setIsLoading] = useState(true);

  // Block / Unblock Modal State
  const [selectedClient, setSelectedClient] = useState<AdminClientUser | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await adminApi.getClients();
      setClients(data);
    } catch {
      // Fallback handled in adminApi
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openToggleBlockModal = (client: AdminClientUser) => {
    setSelectedClient(client);
    setBlockReason('');
    setModalError(null);
  };

  const handleConfirmToggleBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) return;

    const isBlocking = !selectedClient.is_blocked;
    if (isBlocking && !blockReason.trim()) {
      setModalError("Mijozni bloklash uchun sabab ko'rsatish majburiy!");
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await adminApi.toggleClientBlock(
        selectedClient.id,
        isBlocking,
        blockReason.trim() || undefined
      );

      setClients(prev => prev.map(c => (c.id === updated.id ? updated : c)));
      setToastMessage(
        isBlocking
          ? `${selectedClient.phone} muvaffaqiyatli bloklandi.`
          : `${selectedClient.phone} blokdan chiqarildi.`
      );
      setSelectedClient(null);
    } catch (err: any) {
      setModalError(err?.message || "Amalni bajarishda xatolik yuz berdi");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredClients = clients.filter(client => {
    const matchesSearch =
      (client.full_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.phone.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'active'
        ? !client.is_blocked
        : client.is_blocked;

    return matchesSearch && matchesStatus;
  });

  const totalBalance = clients.reduce((sum, c) => sum + c.wallet_balance, 0);

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
            <i className="ri-user-heart-line" style={{ color: 'var(--admin-accent)' }} />
            Mijozlar Boshqaruvi
          </h1>
          <p>Tizimda ro'yxatdan o'tgan barcha yo'lovchilar, hamyon balanslari va xavfsizlik nazorati</p>
        </div>
      </div>

      {/* Quick Summary Cards */}
      <div className="admin-kpis-grid">
        <div className="admin-kpi-card">
          <div className="admin-kpi-card__icon" style={{ background: 'var(--admin-accent-subtle)', color: 'var(--admin-accent)' }}>
            <i className="ri-group-line" />
          </div>
          <div className="admin-kpi-card__content">
            <span className="admin-kpi-card__value">{clients.length}</span>
            <span className="admin-kpi-card__label">Jami Ro'yxatdan O'tgan</span>
          </div>
        </div>

        <div className="admin-kpi-card">
          <div className="admin-kpi-card__icon" style={{ background: 'var(--success-subtle)', color: 'var(--success)' }}>
            <i className="ri-user-follow-line" />
          </div>
          <div className="admin-kpi-card__content">
            <span className="admin-kpi-card__value">{clients.filter(c => !c.is_blocked).length}</span>
            <span className="admin-kpi-card__label">Faol Mijozlar</span>
          </div>
        </div>

        <div className="admin-kpi-card">
          <div className="admin-kpi-card__icon" style={{ background: 'var(--danger-subtle)', color: 'var(--danger)' }}>
            <i className="ri-user-forbid-line" />
          </div>
          <div className="admin-kpi-card__content">
            <span className="admin-kpi-card__value">{clients.filter(c => c.is_blocked).length}</span>
            <span className="admin-kpi-card__label">Bloklanganlar</span>
          </div>
        </div>

        <div className="admin-kpi-card">
          <div className="admin-kpi-card__icon" style={{ background: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6' }}>
            <i className="ri-wallet-3-line" />
          </div>
          <div className="admin-kpi-card__content">
            <span className="admin-kpi-card__value">{totalBalance.toLocaleString()} UZS</span>
            <span className="admin-kpi-card__label">Jami Hamyon Mablag'i</span>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="operations-filter-bar">
        <div className="operations-filter-bar__search">
          <i className="ri-search-line" />
          <input
            type="text"
            placeholder="Telefon raqami yoki F.I.O. bo'yicha qidiruv..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className={`finance-tab ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            Hammasi ({clients.length})
          </button>
          <button
            className={`finance-tab ${statusFilter === 'active' ? 'active' : ''}`}
            onClick={() => setStatusFilter('active')}
          >
            Faol ({clients.filter(c => !c.is_blocked).length})
          </button>
          <button
            className={`finance-tab ${statusFilter === 'blocked' ? 'active' : ''}`}
            onClick={() => setStatusFilter('blocked')}
          >
            Bloklangan ({clients.filter(c => c.is_blocked).length})
          </button>
        </div>
      </div>

      {/* Clients Table */}
      <div className="operations-table-card">
        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <i className="ri-loader-4-line ri-spin" style={{ fontSize: '2rem', color: 'var(--admin-accent)' }} />
            <p style={{ marginTop: '0.5rem' }}>Mijozlar ro'yxati yuklanmoqda...</p>
          </div>
        ) : filteredClients.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <i className="ri-user-search-line" style={{ fontSize: '2.5rem', opacity: 0.5 }} />
            <p style={{ marginTop: '0.5rem' }}>Hech qanday mijoz topilmadi</p>
          </div>
        ) : (
          <div className="operations-table-wrap">
            <table className="operations-table">
              <thead>
                <tr>
                  <th>Mijoz (Telefon / F.I.O.)</th>
                  <th>Hamyon Balansi</th>
                  <th>Jami Qatnovlar</th>
                  <th>Holat</th>
                  <th>So'nggi Faollik</th>
                  <th style={{ textAlign: 'right' }}>Amallar</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.map(client => (
                  <tr key={client.id} style={{ background: client.is_blocked ? 'rgba(239, 68, 68, 0.04)' : undefined }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            background: client.is_blocked ? 'var(--danger-subtle)' : 'var(--admin-accent-subtle)',
                            color: client.is_blocked ? 'var(--danger)' : 'var(--admin-accent)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '0.9rem',
                          }}
                        >
                          {client.full_name ? client.full_name.charAt(0).toUpperCase() : 'U'}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {client.full_name || 'Ismi kiritilmagan'}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                            {client.phone}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                        {client.wallet_balance.toLocaleString()} UZS
                      </span>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-secondary)' }}>
                        <i className="ri-route-line" />
                        {client.total_rides} ta
                      </span>
                    </td>
                    <td>
                      {client.is_blocked ? (
                        <div>
                          <span className="status-badge" style={{ background: 'var(--danger-subtle)', color: 'var(--danger)' }}>
                            <i className="ri-forbid-line" /> Bloklangan
                          </span>
                          {client.block_reason && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.2rem', maxWidth: 220 }}>
                              {client.block_reason}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="status-badge" style={{ background: 'var(--success-subtle)', color: 'var(--success)' }}>
                          <i className="ri-checkbox-circle-line" /> Faol
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {new Date(client.last_active_at).toLocaleString('uz-UZ', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => openToggleBlockModal(client)}
                        style={{
                          background: client.is_blocked ? 'var(--success-subtle)' : 'var(--danger-subtle)',
                          color: client.is_blocked ? 'var(--success)' : 'var(--danger)',
                          border: `1px solid ${client.is_blocked ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
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
                        <i className={client.is_blocked ? 'ri-lock-unlock-line' : 'ri-user-forbid-line'} />
                        {client.is_blocked ? 'Blokdan chiqarish' : 'Bloklash'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Block / Unblock Modal */}
      {selectedClient && (
        <div className="operations-modal-backdrop">
          <div className="operations-modal" style={{ maxWidth: 500 }}>
            <div className="operations-modal__header">
              <h2>
                <i
                  className={selectedClient.is_blocked ? 'ri-lock-unlock-line' : 'ri-user-forbid-line'}
                  style={{ color: selectedClient.is_blocked ? 'var(--success)' : 'var(--danger)' }}
                />
                {selectedClient.is_blocked ? "Mijozni blokdan chiqarish" : "Mijoz akkauntini bloklash"}
              </h2>
              <button className="modal-close-btn" onClick={() => setSelectedClient(null)}>
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={handleConfirmToggleBlock}>
              <div className="operations-modal__body">
                {modalError && (
                  <div className="form-error-banner">
                    <i className="ri-error-warning-line" />
                    <span>{modalError}</span>
                  </div>
                )}

                <div className="dangerous-action-banner" style={{ background: selectedClient.is_blocked ? 'rgba(34, 197, 94, 0.1)' : undefined, borderColor: selectedClient.is_blocked ? 'var(--success)' : undefined, color: selectedClient.is_blocked ? '#86efac' : undefined }}>
                  <i
                    className={selectedClient.is_blocked ? 'ri-information-line' : 'ri-alarm-warning-line'}
                    style={{ color: selectedClient.is_blocked ? 'var(--success)' : 'var(--danger)' }}
                  />
                  <div>
                    {selectedClient.is_blocked ? (
                      <span>Ushbu mijoz qayta faollashtiriladi va unga mobil ilovadan foydalanish, qatnovlarni bron qilish va to'lov qilish imkoniyati qaytariladi.</span>
                    ) : (
                      <span><strong>Diqqat:</strong> Akkaunt bloklangandan so'ng mijoz ilovaga kira olmaydi, uning aktiv qatnovlari bekor qilinadi. Ushbu amal ma'murlar audit jurnalida qayd etiladi.</span>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: '1rem', background: 'var(--surface-sunken)', padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {selectedClient.full_name || 'Noma\'lum mijoz'}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    Tel: {selectedClient.phone} | Balans: {selectedClient.wallet_balance.toLocaleString()} UZS
                  </div>
                </div>

                {!selectedClient.is_blocked && (
                  <div className="form-group" style={{ marginTop: '1rem' }}>
                    <label>
                      Bloklash sababi (Audit jurnaliga yoziladi) <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <textarea
                      rows={3}
                      value={blockReason}
                      onChange={e => setBlockReason(e.target.value)}
                      placeholder="Masalan: To'lov tizimida shubhali faollik yoki takroriy noto'g'ri so'rovlar..."
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
                )}
              </div>

              <div className="operations-modal__footer">
                <button
                  type="button"
                  className="btn-operations-secondary"
                  onClick={() => setSelectedClient(null)}
                  disabled={isSubmitting}
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    background: selectedClient.is_blocked ? 'var(--success)' : 'var(--danger)',
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
                      <i className="ri-loader-4-line ri-spin" /> Bajarilmoqda...
                    </>
                  ) : (
                    <>
                      <i className={selectedClient.is_blocked ? 'ri-lock-unlock-line' : 'ri-user-forbid-line'} />
                      {selectedClient.is_blocked ? 'Blokdan chiqarishni tasdiqlash' : 'Bloklashni tasdiqlash'}
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
