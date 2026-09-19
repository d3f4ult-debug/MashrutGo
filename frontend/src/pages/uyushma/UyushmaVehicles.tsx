import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { uyushmaApi } from '../../services/api/uyushmaApi';
import type { UyushmaVehicle, UyushmaRoute, UyushmaDriver, VehicleType } from '../../types/uyushma';
import './UyushmaOperations.css';

export function UyushmaVehicles() {
  const { user } = useAuth();
  const uyushmaId = user?.uyushma_id || 'uyushma-01';

  const [vehicles, setVehicles] = useState<UyushmaVehicle[]>([]);
  const [routes, setRoutes] = useState<UyushmaRoute[]>([]);
  const [drivers, setDrivers] = useState<UyushmaDriver[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<UyushmaVehicle | null>(null);

  // Form fields
  const [internalId, setInternalId] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('isuzu');
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [vehData, routesData, driversData] = await Promise.all([
        uyushmaApi.getVehicles(uyushmaId),
        uyushmaApi.getRoutes(uyushmaId),
        uyushmaApi.getDrivers(uyushmaId),
      ]);
      setVehicles(vehData);
      setRoutes(routesData);
      setDrivers(driversData);
    } catch {
      // Fallback in API
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [uyushmaId]);

  const openCreateModal = () => {
    setEditingVehicle(null);
    setInternalId(`VEH-${Math.floor(100 + Math.random() * 900)}`);
    setLicensePlate('60 A ');
    setModel('Isuzu NP37');
    setColor('Oq');
    setVehicleType('isuzu');
    setSelectedRouteId(routes[0]?.id || '');
    setSelectedDriverId('');
    setIsActive(true);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (v: UyushmaVehicle) => {
    setEditingVehicle(v);
    setInternalId(v.id);
    setLicensePlate(v.license_plate || '');
    setModel(v.model || '');
    setColor(v.color || '');
    setVehicleType(v.type || 'isuzu');
    setSelectedRouteId(v.assigned_route_id || '');
    setSelectedDriverId(v.assigned_driver_id || '');
    setIsActive(v.is_active);
    setFormError(null);
    setIsModalOpen(true);
  };

  // 1-to-1 Conflict check
  const validationResult = uyushmaApi.validateAssignment(
    selectedDriverId || undefined,
    internalId || undefined,
    selectedRouteId || undefined,
    selectedDriverId || undefined,
    editingVehicle?.id
  );

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!internalId.trim()) {
      setFormError("Ichki transport ID majburiy.");
      return;
    }

    const check = uyushmaApi.validateAssignment(
      selectedDriverId || undefined,
      internalId,
      selectedRouteId || undefined,
      selectedDriverId || undefined,
      editingVehicle?.id
    );

    if (!check.valid) {
      setFormError(check.error || 'Noma\'lum xatolik');
      return;
    }

    try {
      if (editingVehicle) {
        const updated = await uyushmaApi.updateVehicle(uyushmaId, editingVehicle.id, {
          license_plate: licensePlate || undefined,
          model: model || undefined,
          color: color || undefined,
          type: vehicleType,
          assigned_route_id: selectedRouteId || undefined,
          assigned_driver_id: selectedDriverId || undefined,
          is_active: isActive,
        });
        setVehicles(prev => prev.map(v => (v.id === updated.id ? updated : v)));
      } else {
        const created = await uyushmaApi.createVehicle(uyushmaId, {
          id: internalId,
          license_plate: licensePlate || undefined,
          model: model || undefined,
          color: color || undefined,
          type: vehicleType,
          assigned_route_id: selectedRouteId || undefined,
          assigned_driver_id: selectedDriverId || undefined,
          is_active: isActive,
        });
        setVehicles(prev => [created, ...prev]);
      }
      setIsModalOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Xatolik yuz berdi');
    }
  };

  const handleDeleteVehicle = async (vehicleId: string) => {
    if (!window.confirm("Haqiqatan ham ushbu transportni o'chirmoqchimisiz?")) return;
    await uyushmaApi.deleteVehicle(uyushmaId, vehicleId);
    setVehicles(prev => prev.filter(v => v.id !== vehicleId));
  };

  const filteredVehicles = vehicles.filter(v => {
    const q = searchQuery.toLowerCase();
    return (
      v.id.toLowerCase().includes(q) ||
      (v.license_plate && v.license_plate.toLowerCase().includes(q)) ||
      (v.model && v.model.toLowerCase().includes(q)) ||
      (v.assigned_driver_name && v.assigned_driver_name.toLowerCase().includes(q)) ||
      (v.assigned_route_number && v.assigned_route_number.toLowerCase().includes(q))
    );
  });

  return (
    <div className="uyushma-page-container">
      {/* Header */}
      <div className="uyushma-page-header">
        <div className="uyushma-page-header__left">
          <h1>
            <i className="ri-bus-2-line" style={{ color: 'var(--warning)' }} />
            Transportlar reestri
          </h1>
          <p>
            Avtoparkdagi barcha transport vositalari, ularning davlat raqami, modeli va biriktirilgan haydovchilari
          </p>
        </div>

        <div className="uyushma-page-header__actions">
          <button className="btn-secondary-action" onClick={loadData}>
            <i className="ri-refresh-line" />
            Yangilash
          </button>
          <button className="btn-primary-action" onClick={openCreateModal}>
            <i className="ri-add-line" />
            Transport qo'shish
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="uyushma-toolbar">
        <div className="uyushma-search-input">
          <i className="ri-search-line" />
          <input
            type="text"
            placeholder="ID, davlat raqami, model yoki haydovchi..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Jami transportlar: <strong>{vehicles.length} ta</strong>
        </div>
      </div>

      {/* Vehicles Table */}
      <div className="uyushma-table-wrapper">
        <table className="uyushma-table">
          <thead>
            <tr>
              <th>Transport ID</th>
              <th>Davlat raqami</th>
              <th>Model & Rang</th>
              <th>Yo'nalish</th>
              <th>Biriktirilgan haydovchi</th>
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
            ) : filteredVehicles.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
                  Transportlar topilmadi.
                </td>
              </tr>
            ) : (
              filteredVehicles.map(v => (
                <tr key={v.id}>
                  <td>
                    <strong style={{ fontFamily: 'monospace' }}>{v.id}</strong>
                  </td>
                  <td>
                    {v.license_plate ? (
                      <span className="vehicle-plate-badge">{v.license_plate}</span>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>Ko'rsatilmagan</span>
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{v.model || 'Standart transport'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                      {v.color || 'Rangi yo\'q'} • {v.type?.toUpperCase() || 'ISUZU'}
                    </div>
                  </td>
                  <td>
                    {v.assigned_route_number ? (
                      <span className="route-number-badge">№ {v.assigned_route_number}</span>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>Biriktirilmagan</span>
                    )}
                  </td>
                  <td>
                    {v.assigned_driver_name ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <i className="ri-user-3-line" style={{ color: 'var(--accent-primary)' }} />
                        <span>{v.assigned_driver_name}</span>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>Haydovchisiz</span>
                    )}
                  </td>
                  <td>
                    {v.is_on_shift ? (
                      <span className="status-pill online">
                        <i className="ri-radio-button-fill" />
                        Liniyada
                      </span>
                    ) : (
                      <span className={`status-pill ${v.is_active ? 'active' : 'inactive'}`}>
                        {v.is_active ? 'Faol (Kutmoqda)' : 'Nofaol'}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="btn-table-action"
                        onClick={() => openEditModal(v)}
                        title="Tahrirlash"
                      >
                        <i className="ri-edit-line" />
                      </button>
                      <button
                        className="btn-table-action danger"
                        onClick={() => handleDeleteVehicle(v.id)}
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

      {/* Modal: Create/Edit Vehicle */}
      {isModalOpen && (
        <div className="uyushma-modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="uyushma-modal-card" onClick={e => e.stopPropagation()}>
            <div className="uyushma-modal-header">
              <h3>
                <i className="ri-bus-2-line" style={{ color: 'var(--warning)' }} />
                {editingVehicle ? "Transportni tahrirlash" : "Yangi transport qo'shish"}
              </h3>
              <button className="btn-modal-close" onClick={() => setIsModalOpen(false)}>
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={handleSaveVehicle}>
              <div className="uyushma-modal-body">
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
                    <label>Ichki Transport ID * (Majburiy)</label>
                    <input
                      type="text"
                      className="uyushma-input"
                      placeholder="VEH-105"
                      value={internalId}
                      onChange={e => setInternalId(e.target.value)}
                      disabled={!!editingVehicle}
                      required
                    />
                    <span className="hint">Tizimdagi noyob identifikator</span>
                  </div>

                  <div className="uyushma-form-group">
                    <label>Davlat raqami (Ixtiyoriy)</label>
                    <input
                      type="text"
                      className="uyushma-input"
                      placeholder="60 A 777 AA"
                      value={licensePlate}
                      onChange={e => setLicensePlate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-grid-2">
                  <div className="uyushma-form-group">
                    <label>Model (Ixtiyoriy)</label>
                    <input
                      type="text"
                      className="uyushma-input"
                      placeholder="Isuzu NP37 / Damas"
                      value={model}
                      onChange={e => setModel(e.target.value)}
                    />
                  </div>

                  <div className="uyushma-form-group">
                    <label>Rang (Ixtiyoriy)</label>
                    <input
                      type="text"
                      className="uyushma-input"
                      placeholder="Oq / Ko'k"
                      value={color}
                      onChange={e => setColor(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-grid-2">
                  <div className="uyushma-form-group">
                    <label>Transport turi</label>
                    <select
                      className="uyushma-select"
                      value={vehicleType}
                      onChange={e => setVehicleType(e.target.value as VehicleType)}
                    >
                      <option value="isuzu">Isuzu (Avtobus)</option>
                      <option value="damas">Damas (Mikroavtobus)</option>
                      <option value="bus">Katta avtobus (Yutong)</option>
                      <option value="minibus">Minibus</option>
                      <option value="other">Boshqa</option>
                    </select>
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
                      <label>Asosiy haydovchini tanlang</label>
                      <select
                        className="uyushma-select"
                        value={selectedDriverId}
                        onChange={e => setSelectedDriverId(e.target.value)}
                      >
                        <option value="">— Haydovchisiz —</option>
                        {drivers.map(d => (
                          <option key={d.id} value={d.id}>
                            {d.full_name} ({d.phone})
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
