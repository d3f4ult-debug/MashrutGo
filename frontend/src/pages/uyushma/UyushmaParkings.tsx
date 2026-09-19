import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { uyushmaApi } from '../../services/api/uyushmaApi';
import type { UyushmaParking } from '../../types/uyushma';
import './UyushmaOperations.css';

export function UyushmaParkings() {
  const { user } = useAuth();
  const uyushmaId = user?.uyushma_id || 'uyushma-01';

  const [parkings, setParkings] = useState<UyushmaParking[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingParking, setEditingParking] = useState<UyushmaParking | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [lat, setLat] = useState<number>(40.783);
  const [lng, setLng] = useState<number>(72.344);
  const [radiusM, setRadiusM] = useState<number>(100);
  const [capacity, setCapacity] = useState<number>(15);
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const loadParkings = async () => {
    setIsLoading(true);
    try {
      const data = await uyushmaApi.getParkings(uyushmaId);
      setParkings(data);
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadParkings();
  }, [uyushmaId]);

  const openCreateModal = () => {
    setEditingParking(null);
    setName('');
    setLat(40.783);
    setLng(72.344);
    setRadiusM(120);
    setCapacity(15);
    setIsActive(true);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (p: UyushmaParking) => {
    setEditingParking(p);
    setName(p.name);
    setLat(p.lat);
    setLng(p.lng);
    setRadiusM(p.radius_m);
    setCapacity(p.capacity);
    setIsActive(p.is_active);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSaveParking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError("Stoyanka nomi majburiy.");
      return;
    }

    try {
      if (editingParking) {
        const updated = await uyushmaApi.updateParking(uyushmaId, editingParking.id, {
          name,
          lat,
          lng,
          radius_m: radiusM,
          capacity,
          is_active: isActive,
        });
        setParkings(prev => prev.map(p => (p.id === updated.id ? updated : p)));
      } else {
        const created = await uyushmaApi.createParking(uyushmaId, {
          name,
          lat,
          lng,
          radius_m: radiusM,
          capacity,
          is_active: isActive,
        });
        setParkings(prev => [created, ...prev]);
      }
      setIsModalOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Xatolik yuz berdi');
    }
  };

  const handleDeleteParking = async (parkingId: string) => {
    if (!window.confirm("Haqiqatan ham ushbu stoyankani o'chirmoqchimisiz?")) return;
    await uyushmaApi.deleteParking(uyushmaId, parkingId);
    setParkings(prev => prev.filter(p => p.id !== parkingId));
  };

  const filteredParkings = parkings.filter(p => {
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q);
  });

  return (
    <div className="uyushma-page-container">
      {/* Header */}
      <div className="uyushma-page-header">
        <div className="uyushma-page-header__left">
          <h1>
            <i className="ri-parking-box-line" style={{ color: 'var(--info)' }} />
            Stoyankalar (Geofence monitoring)
          </h1>
          <p>
            Marshrut bosh va oxirgi bekatlari, geofence radiusi va avtoturargoh sig'imi nazorati
          </p>
        </div>

        <div className="uyushma-page-header__actions">
          <button className="btn-secondary-action" onClick={loadParkings}>
            <i className="ri-refresh-line" />
            Yangilash
          </button>
          <button className="btn-primary-action" onClick={openCreateModal}>
            <i className="ri-add-line" />
            Yangi stoyanka qo'shish
          </button>
        </div>
      </div>

      {/* Geofence notice */}
      <div className="rule-guard-banner">
        <i className="ri-radar-line" />
        <div>
          <strong>Avtomatik geofence hisobi:</strong> Haydovchilar stoyankaga yetib borganida tizim GPS radius orqali avtomobilni avtomatik qayd etadi. Qo'lda belgilash talab qilinmaydi.
        </div>
      </div>

      {/* Toolbar */}
      <div className="uyushma-toolbar">
        <div className="uyushma-search-input">
          <i className="ri-search-line" />
          <input
            type="text"
            placeholder="Stoyanka nomi bo'yicha qidiruv..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Jami stoyankalar: <strong>{parkings.length} ta</strong>
        </div>
      </div>

      {/* Parkings Table */}
      <div className="uyushma-table-wrapper">
        <table className="uyushma-table">
          <thead>
            <tr>
              <th>Stoyanka nomi</th>
              <th>GPS Koordinatalari</th>
              <th>Geofence radiusi</th>
              <th>Avtomobillar soni</th>
              <th>Sig'im (Max)</th>
              <th>Holat</th>
              <th style={{ textAlign: 'right' }}>Amallar</th>
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
            ) : filteredParkings.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
                  Stoyankalar topilmadi.
                </td>
              </tr>
            ) : (
              filteredParkings.map(p => (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                  </td>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{p.radius_m}</span> metr
                  </td>
                  <td>
                    <span className="status-pill online">
                      <i className="ri-bus-2-fill" />
                      {p.current_vehicle_count} ta transport
                    </span>
                  </td>
                  <td>
                    {p.capacity} ta joy
                  </td>
                  <td>
                    <span className={`status-pill ${p.is_active ? 'active' : 'inactive'}`}>
                      {p.is_active ? 'Faol' : 'Nofaol'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="btn-table-action"
                        onClick={() => openEditModal(p)}
                        title="Tahrirlash"
                      >
                        <i className="ri-edit-line" />
                      </button>
                      <button
                        className="btn-table-action danger"
                        onClick={() => handleDeleteParking(p.id)}
                        title="O'chirish"
                      >
                        <i className="ri-delete-bin-line" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Create/Edit Parking */}
      {isModalOpen && (
        <div className="uyushma-modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="uyushma-modal-card" onClick={e => e.stopPropagation()}>
            <div className="uyushma-modal-header">
              <h3>
                <i className="ri-parking-box-line" style={{ color: 'var(--info)' }} />
                {editingParking ? "Stoyankani tahrirlash" : "Yangi stoyanka qo'shish"}
              </h3>
              <button className="btn-modal-close" onClick={() => setIsModalOpen(false)}>
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={handleSaveParking}>
              <div className="uyushma-modal-body">
                {formError && (
                  <div className="rule-conflict-alert">
                    <i className="ri-error-warning-fill" />
                    <div>{formError}</div>
                  </div>
                )}

                <div className="uyushma-form-group">
                  <label>Stoyanka nomi *</label>
                  <input
                    type="text"
                    className="uyushma-input"
                    placeholder="Masalan: O'sh ko'chasi bosh stoyankasi"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-grid-2">
                  <div className="uyushma-form-group">
                    <label>Kenglik (Latitude) *</label>
                    <input
                      type="number"
                      step="any"
                      className="uyushma-input"
                      value={lat}
                      onChange={e => setLat(parseFloat(e.target.value))}
                      required
                    />
                  </div>

                  <div className="uyushma-form-group">
                    <label>Uzunlik (Longitude) *</label>
                    <input
                      type="number"
                      step="any"
                      className="uyushma-input"
                      value={lng}
                      onChange={e => setLng(parseFloat(e.target.value))}
                      required
                    />
                  </div>
                </div>

                <div className="form-grid-2">
                  <div className="uyushma-form-group">
                    <label>Geofence radiusi (metr) *</label>
                    <input
                      type="number"
                      className="uyushma-input"
                      value={radiusM}
                      onChange={e => setRadiusM(parseInt(e.target.value))}
                      min={30}
                      max={1000}
                      required
                    />
                    <span className="hint">Avtomobil kirganini aniqlash zonasi</span>
                  </div>

                  <div className="uyushma-form-group">
                    <label>Sig'im (Max avtomobillar) *</label>
                    <input
                      type="number"
                      className="uyushma-input"
                      value={capacity}
                      onChange={e => setCapacity(parseInt(e.target.value))}
                      min={1}
                      required
                    />
                  </div>
                </div>

                <div className="uyushma-form-group">
                  <label>Holati</label>
                  <select
                    className="uyushma-select"
                    value={isActive ? 'true' : 'false'}
                    onChange={e => setIsActive(e.target.value === 'true')}
                  >
                    <option value="true">Faol</option>
                    <option value="false">Faol emas</option>
                  </select>
                </div>
              </div>

              <div className="uyushma-modal-footer">
                <button
                  type="button"
                  className="btn-secondary-action"
                  onClick={() => setIsModalOpen(false)}
                >
                  Bekor qilish
                </button>
                <button type="submit" className="btn-primary-action">
                  <i className="ri-save-line" />
                  Saqlash
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
