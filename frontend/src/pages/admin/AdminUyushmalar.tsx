import { useState, useEffect } from 'react';
import { adminApi } from '../../services/api/adminApi';
import type { AdminUyushma } from '../../types/admin';
import './AdminOperations.css';
import '../uyushma/UyushmaOperations.css';

export function AdminUyushmalar() {
  const [uyushmalar, setUyushmalar] = useState<AdminUyushma[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingUyushma, setEditingUyushma] = useState<AdminUyushma | null>(null);

  // Dangerous Archive Modal state
  const [archivingUyushma, setArchivingUyushma] = useState<AdminUyushma | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [isSubmittingArchive, setIsSubmittingArchive] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [region, setRegion] = useState('Andijon viloyati');
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('+998 ');
  const [adminEmail, setAdminEmail] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await adminApi.getUyushmalar();
      setUyushmalar(data);
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingUyushma(null);
    setName('');
    setRegion('Andijon viloyati, Andijon shahri');
    setContactPerson('');
    setContactPhone('+998 ');
    setAdminEmail('');
    setLicenseNumber(`LNZ-AND-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`);
    setFormError(null);
    setIsCreateModalOpen(true);
  };

  const openEditModal = (u: AdminUyushma) => {
    setEditingUyushma(u);
    setName(u.name);
    setRegion(u.region);
    setContactPerson(u.contact_person);
    setContactPhone(u.contact_phone);
    setAdminEmail(u.admin_email);
    setLicenseNumber(u.license_number);
    setFormError(null);
    setIsCreateModalOpen(true);
  };

  const handleSaveUyushma = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !adminEmail.trim()) {
      setFormError("Tashkilot nomi va admin emaili majburiy.");
      return;
    }

    try {
      if (editingUyushma) {
        const updated = await adminApi.updateUyushma(editingUyushma.id, {
          name,
          region,
          contact_person: contactPerson,
          contact_phone: contactPhone,
          admin_email: adminEmail,
          license_number: licenseNumber,
        });
        setUyushmalar(prev => prev.map(u => (u.id === updated.id ? updated : u)));
        setToastMessage("Uyushma ma'lumotlari yangilandi.");
      } else {
        const created = await adminApi.createUyushma({
          name,
          region,
          contact_person: contactPerson,
          contact_phone: contactPhone,
          admin_email: adminEmail,
          license_number: licenseNumber,
        });
        setUyushmalar(prev => [created, ...prev]);
        setToastMessage("Yangi Uyushma muvaffaqiyatli ro'yxatdan o'tkazildi!");
      }
      setIsCreateModalOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Xatolik yuz berdi');
    }
  };

  const handleConfirmArchive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archivingUyushma) return;
    if (!archiveReason.trim()) {
      alert("Iltimos, arxivlashning audit sababini kiriting.");
      return;
    }

    setIsSubmittingArchive(true);
    try {
      await adminApi.archiveUyushma(archivingUyushma.id, archiveReason);
      setUyushmalar(prev =>
        prev.map(u => (u.id === archivingUyushma.id ? { ...u, status: 'archived' } : u))
      );
      setArchivingUyushma(null);
      setArchiveReason('');
      setToastMessage("Uyushma arxivlandi va audit qaydnomasiga kiritildi.");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Xatolik');
    } finally {
      setIsSubmittingArchive(false);
    }
  };

  const filteredUyushmalar = uyushmalar.filter(u => {
    const q = searchQuery.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.region.toLowerCase().includes(q) ||
      u.admin_email.toLowerCase().includes(q) ||
      u.license_number.toLowerCase().includes(q)
    );
  });

  return (
    <div className="admin-page-container">
      {/* Header */}
      <div className="admin-page-header">
        <div className="admin-page-header__left">
          <h1>
            <i className="ri-building-2-line" style={{ color: 'var(--admin-accent)' }} />
            Uyushmalar boshqaruvi (Tashkilotlar)
          </h1>
          <p>Super Admin tomonidan yangi uyushmalarni yaratish, litsenziyalash va arxivlash</p>
        </div>

        <div className="uyushma-page-header__actions">
          <button className="btn-secondary-action" onClick={loadData}>
            <i className="ri-refresh-line" />
            Yangilash
          </button>
          <button className="btn-admin-primary" onClick={openCreateModal}>
            <i className="ri-add-line" />
            Yangi Uyushma ochish
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="uyushma-toolbar">
        <div className="uyushma-search-input">
          <i className="ri-search-line" />
          <input
            type="text"
            placeholder="Uyushma nomi, litsenziya, email yoki hudud..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Jami tashkilotlar: <strong>{uyushmalar.length} ta</strong>
        </div>
      </div>

      {/* Uyushmalar Table */}
      <div className="uyushma-table-wrapper">
        <table className="uyushma-table">
          <thead>
            <tr>
              <th>Uyushma nomi & Hudud</th>
              <th>Litsenziya raqami</th>
              <th>Mas'ul shaxs & Aloqa</th>
              <th>Yo'nalishlar</th>
              <th>Haydovchilar</th>
              <th>Holat</th>
              <th style={{ textAlign: 'right' }}>Amallar</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-secondary)' }}>
                  <i className="ri-loader-4-line ri-spin" style={{ fontSize: '1.5rem', color: 'var(--admin-accent)' }} />
                  <div style={{ marginTop: '0.5rem' }}>Yuklanmoqda...</div>
                </td>
              </tr>
            ) : filteredUyushmalar.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
                  Uyushmalar topilmadi.
                </td>
              </tr>
            ) : (
              filteredUyushmalar.map(u => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{u.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{u.region}</div>
                  </td>
                  <td>
                    <span className="vehicle-plate-badge" style={{ color: 'var(--admin-accent)' }}>
                      {u.license_number}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{u.contact_person}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                      {u.contact_phone} • {u.admin_email}
                    </div>
                  </td>
                  <td>
                    <strong style={{ color: 'var(--accent-primary)' }}>{u.routes_count}</strong> ta
                  </td>
                  <td>
                    <strong style={{ color: 'var(--success)' }}>{u.drivers_count}</strong> nafar
                  </td>
                  <td>
                    <span className={`status-pill ${u.status === 'active' ? 'active' : 'inactive'}`}>
                      {u.status === 'active' ? 'Faol' : 'Arxivlangan'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="btn-table-action"
                        onClick={() => openEditModal(u)}
                        title="Tahrirlash"
                      >
                        <i className="ri-edit-line" />
                      </button>

                      {u.status === 'active' && (
                        <button
                          className="btn-table-action danger"
                          onClick={() => {
                            setArchivingUyushma(u);
                            setArchiveReason('');
                          }}
                          title="Arxivlash (Destruktiv amal)"
                        >
                          <i className="ri-archive-line" />
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

      {/* Modal: Create/Edit Uyushma */}
      {isCreateModalOpen && (
        <div className="uyushma-modal-overlay" onClick={() => setIsCreateModalOpen(false)}>
          <div className="uyushma-modal-card" onClick={e => e.stopPropagation()}>
            <div className="uyushma-modal-header">
              <h3>
                <i className="ri-building-2-line" style={{ color: 'var(--admin-accent)' }} />
                {editingUyushma ? "Uyushmani tahrirlash" : "Yangi Uyushma ochish"}
              </h3>
              <button className="btn-modal-close" onClick={() => setIsCreateModalOpen(false)}>
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={handleSaveUyushma}>
              <div className="uyushma-modal-body">
                {formError && (
                  <div className="rule-conflict-alert">
                    <i className="ri-error-warning-fill" />
                    <div>{formError}</div>
                  </div>
                )}

                <div className="uyushma-form-group">
                  <label>Uyushma nomi (Yuridik shaxs) *</label>
                  <input
                    type="text"
                    className="uyushma-input"
                    placeholder="Masalan: Andijon Shahar Yo'lovchi Tashish DUK"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-grid-2">
                  <div className="uyushma-form-group">
                    <label>Hudud / Shahar *</label>
                    <input
                      type="text"
                      className="uyushma-input"
                      placeholder="Andijon viloyati, Andijon shahri"
                      value={region}
                      onChange={e => setRegion(e.target.value)}
                      required
                    />
                  </div>

                  <div className="uyushma-form-group">
                    <label>Litsenziya raqami *</label>
                    <input
                      type="text"
                      className="uyushma-input"
                      placeholder="LNZ-AND-2024-001"
                      value={licenseNumber}
                      onChange={e => setLicenseNumber(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-grid-2">
                  <div className="uyushma-form-group">
                    <label>Mas'ul shaxs (Rahbar/Menejer) *</label>
                    <input
                      type="text"
                      className="uyushma-input"
                      placeholder="Erkin Mahmudov"
                      value={contactPerson}
                      onChange={e => setContactPerson(e.target.value)}
                      required
                    />
                  </div>

                  <div className="uyushma-form-group">
                    <label>Aloqa telefoni *</label>
                    <input
                      type="text"
                      className="uyushma-input"
                      placeholder="+998 74 223 44 55"
                      value={contactPhone}
                      onChange={e => setContactPhone(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="uyushma-form-group">
                  <label>Uyushma bosh admin emaili *</label>
                  <input
                    type="email"
                    className="uyushma-input"
                    placeholder="andijon.trans@mashrutgo.uz"
                    value={adminEmail}
                    onChange={e => setAdminEmail(e.target.value)}
                    required
                  />
                  <span className="hint">Ushbu email bilan tashkilot admini tizimga kiradi</span>
                </div>
              </div>

              <div className="uyushma-modal-footer">
                <button
                  type="button"
                  className="btn-secondary-action"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  Bekor qilish
                </button>
                <button type="submit" className="btn-admin-primary">
                  <i className="ri-save-line" />
                  Saqlash
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Dangerous Action Confirmation (Archive Uyushma) */}
      {archivingUyushma && (
        <div className="uyushma-modal-overlay" onClick={() => !isSubmittingArchive && setArchivingUyushma(null)}>
          <div className="uyushma-modal-card" onClick={e => e.stopPropagation()}>
            <div className="uyushma-modal-header">
              <h3>
                <i className="ri-alert-line" style={{ color: 'var(--danger)' }} />
                Uyushmani arxivlash (Xavfli amal)
              </h3>
              <button
                className="btn-modal-close"
                onClick={() => setArchivingUyushma(null)}
                disabled={isSubmittingArchive}
              >
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={handleConfirmArchive}>
              <div className="uyushma-modal-body">
                <div className="dangerous-action-banner">
                  <i className="ri-error-warning-fill" />
                  <div>
                    <strong>Diqqat!</strong> Ushbu tashkilotni arxivlash uning barcha yo'nalishlari, haydovchilari va smenalarini vaqtincha to'xtatadi. Bu amal audit jurnalida doimiy saqlanadi.
                  </div>
                </div>

                <div style={{ background: 'var(--surface-elevated)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Tashkilot</div>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                    {archivingUyushma.name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.15rem' }}>
                    {archivingUyushma.region} • {archivingUyushma.license_number}
                  </div>
                </div>

                <div className="uyushma-form-group">
                  <label>Arxivlash sababi (Audit reason) *</label>
                  <textarea
                    className="uyushma-textarea"
                    rows={3}
                    placeholder="Masalan: Litsenziya muddati tugagan yoki tashkilot faoliyati rasman to'xtatilgan..."
                    value={archiveReason}
                    onChange={e => setArchiveReason(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="uyushma-modal-footer">
                <button
                  type="button"
                  className="btn-secondary-action"
                  onClick={() => setArchivingUyushma(null)}
                  disabled={isSubmittingArchive}
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="btn-primary-action"
                  style={{ background: 'var(--danger)' }}
                  disabled={isSubmittingArchive || !archiveReason.trim()}
                >
                  {isSubmittingArchive ? 'Arxivlanmoqda...' : 'Arxivlashni tasdiqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast */}
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
