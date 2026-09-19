import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { uyushmaApi } from '../../services/api/uyushmaApi';
import type { UyushmaDriver, UyushmaRoute, UyushmaVehicle } from '../../types/uyushma';
import './UyushmaOperations.css';

export function UyushmaDrivers() {
  const { user } = useAuth();
  const uyushmaId = user?.uyushma_id || 'uyushma-01';

  const [drivers, setDrivers] = useState<UyushmaDriver[]>([]);
  const [routes, setRoutes] = useState<UyushmaRoute[]>([]);
  const [vehicles, setVehicles] = useState<UyushmaVehicle[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<UyushmaDriver | null>(null);

  // Form fields
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('+998 ');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [driversData, routesData, vehiclesData] = await Promise.all([
        uyushmaApi.getDrivers(uyushmaId),
        uyushmaApi.getRoutes(uyushmaId),
        uyushmaApi.getVehicles(uyushmaId),
      ]);
      setDrivers(driversData);
      setRoutes(routesData);
      setVehicles(vehiclesData);
    } catch {
      // Fallback handled
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [uyushmaId]);

  const openCreateModal = () => {
    setEditingDriver(null);
    setFullName('');
    setPhone('+998 ');
    setEmail('');
    setPassword('Haydovchi2026!');
    setSelectedRouteId(routes[0]?.id || '');
    setSelectedVehicleId('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (d: UyushmaDriver) => {
    setEditingDriver(d);
    setFullName(d.full_name);
    setPhone(d.phone);
    setEmail(d.email);
    setPassword(''); // keep blank if unchanged
    setSelectedRouteId(d.assigned_route_id || '');
    setSelectedVehicleId(d.assigned_vehicle_id || '');
    setFormError(null);
    setIsModalOpen(true);
  };

  // Real-time conflict validation
  const validationResult = uyushmaApi.validateAssignment(
    editingDriver?.id,
    selectedVehicleId || undefined,
    selectedRouteId || undefined,
    editingDriver?.id
  );

  const handleSaveDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Enforce 1 Driver = 1 Vehicle = 1 Route validation
    const check = uyushmaApi.validateAssignment(
      editingDriver?.id,
      selectedVehicleId || undefined,
      selectedRouteId || undefined,
      editingDriver?.id
    );

    if (!check.valid) {
      setFormError(check.error || 'Qoida buzilishi!');
      return;
    }

    try {
      if (editingDriver) {
        const updated = await uyushmaApi.updateDriver(uyushmaId, editingDriver.id, {
          full_name: fullName,
          phone,
          email,
          assigned_route_id: selectedRouteId || undefined,
          assigned_vehicle_id: selectedVehicleId || undefined,
        });
        setDrivers(prev => prev.map(d => (d.id === updated.id ? updated : d)));
      } else {
        const created = await uyushmaApi.createDriver(uyushmaId, {
          full_name: fullName,
          phone,
          email,
          password,
          assigned_route_id: selectedRouteId || undefined,
          assigned_vehicle_id: selectedVehicleId || undefined,
        });
        setDrivers(prev => [created, ...prev]);
      }
      setIsModalOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Xatolik yuz berdi');
    }
  };

  const handleDeleteDriver = async (driverId: string) => {
    if (!window.confirm("Haqiqatan ham ushbu haydovchi hisobini o'chirmoqchimisiz?")) return;
    await uyushmaApi.deleteDriver(uyushmaId, driverId);
    setDrivers(prev => prev.filter(d => d.id !== driverId));
  };

  const filteredDrivers = drivers.filter(d => {
    const q = searchQuery.toLowerCase();
    return (
      d.full_name.toLowerCase().includes(q) ||
      d.phone.toLowerCase().includes(q) ||
      d.email.toLowerCase().includes(q) ||
      (d.assigned_route_number && d.assigned_route_number.toLowerCase().includes(q))
    );
  });

  return (
    <div className="uyushma-page-container">
      {/* Header */}
      <div className="uyushma-page-header">
        <div className="uyushma-page-header__left">
          <h1>
            <i className="ri-steering-2-line" style={{ color: 'var(--success)' }} />
            Haydovchilar boshqaruvi
          </h1>
          <p>
            Haydovchilar hisoblarini yaratish, yo'nalish va transport vositalarini biriktirish (1 Driver = 1 Vehicle = 1 Route)
          </p>
        </div>

        <div className="uyushma-page-header__actions">
          <button className="btn-secondary-action" onClick={loadData}>
            <i className="ri-refresh-line" />
            Yangilash
          </button>
          <button className="btn-primary-action" onClick={openCreateModal}>
            <i className="ri-user-add-line" />
            Haydovchi yaratish
          </button>
        </div>
      </div>

      {/* Rule Notice */}
      <div className="rule-guard-banner">
        <i className="ri-information-fill" />
        <div>
          <strong>Muhim tizim qoidasi:</strong> Haydovchilar mustaqil ro'yxatdan o'ta olmaydi. Uyushma haydovchi hisobini ochadi, unga bitta yo'nalish va bitta transport biriktiradi (1 Haydovchi = 1 Transport = 1 Yo'nalish).
        </div>
      </div>

      {/* Toolbar */}
      <div className="uyushma-toolbar">
        <div className="uyushma-search-input">
          <i className="ri-search-line" />
          <input
            type="text"
            placeholder="Haydovchi ismi, telefon yoki yo'nalish..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Jami haydovchilar: <strong>{drivers.length} nafar</strong>
        </div>
      </div>

      {/* Drivers Table */}
      <div className="uyushma-table-wrapper">
        <table className="uyushma-table">
          <thead>
            <tr>
              <th>F.I.SH & Aloqa</th>
              <th>Biriktirilgan yo'nalish</th>
              <th>Biriktirilgan transport</th>
              <th>Smena holati</th>
              <th>Hisob holati</th>
              <th style={{ textAlign: 'right' }}>Amallar</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-secondary)' }}>
                  <i className="ri-loader-4-line ri-spin" style={{ fontSize: '1.5rem', color: 'var(--accent-primary)' }} />
                  <div style={{ marginTop: '0.5rem' }}>Yuklanmoqda...</div>
                </td>
              </tr>
            ) : filteredDrivers.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
                  Haydovchilar topilmadi.
                </td>
              </tr>
            ) : (
              filteredDrivers.map(d => (
                <tr key={d.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{d.full_name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                      {d.phone} • {d.email}
                    </div>
                  </td>
                  <td>
                    {d.assigned_route_number ? (
                      <span className="route-number-badge">№ {d.assigned_route_number}</span>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>Biriktirilmagan</span>
                    )}
                  </td>
                  <td>
                    {d.assigned_vehicle_plate ? (
                      <span className="vehicle-plate-badge">{d.assigned_vehicle_plate}</span>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>Biriktirilmagan</span>
                    )}
                  </td>
                  <td>
                    {d.active_shift?.is_online ? (
                      <span className="status-pill online">
                        <i className="ri-radio-button-fill" />
                        Smenada
                      </span>
                    ) : (
                      <span className="status-pill offline">
                        <i className="ri-moon-line" />
                        Smenada emas
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`status-pill ${d.is_active ? 'active' : 'inactive'}`}>
                      {d.is_active ? 'Faol' : 'Bloklangan'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="btn-table-action"
                        onClick={() => openEditModal(d)}
                        title="Tahrirlash"
                      >
                        <i className="ri-edit-line" />
                      </button>
                      <button
                        className="btn-table-action danger"
                        onClick={() => handleDeleteDriver(d.id)}
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

      {/* Modal: Create/Edit Driver */}
      {isModalOpen && (
        <div className="uyushma-modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="uyushma-modal-card" onClick={e => e.stopPropagation()}>
            <div className="uyushma-modal-header">
              <h3>
                <i className="ri-user-add-line" style={{ color: 'var(--success)' }} />
                {editingDriver ? "Haydovchini tahrirlash" : "Yangi haydovchi yaratish (Account)"}
              </h3>
              <button className="btn-modal-close" onClick={() => setIsModalOpen(false)}>
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={handleSaveDriver}>
              <div className="uyushma-modal-body">
                {/* Real-time conflict warning */}
                {!validationResult.valid && (
                  <div className="rule-conflict-alert">
                    <i className="ri-error-warning-fill" />
                    <div>{validationResult.error}</div>
                  </div>
                )}

                {formError && (
                  <div className="rule-conflict-alert">
                    <i className="ri-error-warning-fill" />
                    <div>{formError}</div>
                  </div>
                )}

                <div className="form-grid-2">
                  <div className="uyushma-form-group">
                    <label>F.I.SH (To'liq ism) *</label>
                    <input
                      type="text"
                      className="uyushma-input"
                      placeholder="Anvar Qodirov"
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="uyushma-form-group">
                    <label>Telefon raqami *</label>
                    <input
                      type="text"
                      className="uyushma-input"
                      placeholder="+998 90 123 45 67"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-grid-2">
                  <div className="uyushma-form-group">
                    <label>Login Email *</label>
                    <input
                      type="email"
                      className="uyushma-input"
                      placeholder="driver@mashrutgo.uz"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  {!editingDriver && (
                    <div className="uyushma-form-group">
                      <label>Dastlabki parol *</label>
                      <input
                        type="text"
                        className="uyushma-input"
                        placeholder="Parol kiriting"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                      />
                      <span className="hint">Haydovchiga PWA ilovasiga kirish uchun beriladi</span>
                    </div>
                  )}
                </div>

                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem', display: 'block' }}>
                    <i className="ri-link" style={{ color: 'var(--accent-primary)', marginRight: '0.4rem' }} />
                    Biriktirish (1 Driver = 1 Vehicle = 1 Route)
                  </label>

                  <div className="form-grid-2">
                    <div className="uyushma-form-group">
                      <label>Yo'nalishni tanlang</label>
                      <select
                        className="uyushma-select"
                        value={selectedRouteId}
                        onChange={e => setSelectedRouteId(e.target.value)}
                      >
                        <option value="">— Yo'nalishsiz —</option>
                        {routes.map(r => (
                          <option key={r.id} value={r.id}>
                            № {r.route_number} ({r.route_name})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="uyushma-form-group">
                      <label>Transport vositasini tanlang</label>
                      <select
                        className="uyushma-select"
                        value={selectedVehicleId}
                        onChange={e => setSelectedVehicleId(e.target.value)}
                      >
                        <option value="">— Transportsiz —</option>
                        {vehicles.map(v => (
                          <option key={v.id} value={v.id}>
                            {v.license_plate || v.id} {v.model ? `(${v.model})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
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
                <button
                  type="submit"
                  className="btn-primary-action"
                  disabled={!validationResult.valid}
                >
                  <i className="ri-save-line" />
                  Hisobni yaratish / saqlash
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
