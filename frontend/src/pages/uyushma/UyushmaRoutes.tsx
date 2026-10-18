import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { uyushmaApi } from '../../services/api/uyushmaApi';
import type { UyushmaRoute, RouteDirectionConfig } from '../../types/uyushma';
import './UyushmaOperations.css';

export function UyushmaRoutes() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const uyushmaId = user?.uyushma_id || 'uyushma-01';

  const [routes, setRoutes] = useState<UyushmaRoute[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<UyushmaRoute | null>(null);
  const [selectedRouteDirections, setSelectedRouteDirections] = useState<UyushmaRoute | null>(null);

  // Form fields
  const [routeNumber, setRouteNumber] = useState('');
  const [routeName, setRouteName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [formError, setFormError] = useState<string | null>(null);

  const loadRoutes = async () => {
    setIsLoading(true);
    try {
      const data = await uyushmaApi.getRoutes(uyushmaId);
      setRoutes(data);
    } catch {
      // Fallback in API client
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRoutes();
  }, [uyushmaId]);

  const openCreateModal = () => {
    setEditingRoute(null);
    setRouteNumber('');
    setRouteName('');
    setDescription('');
    setIsActive(true);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (r: UyushmaRoute) => {
    setEditingRoute(r);
    setRouteNumber(r.route_number);
    setRouteName(r.route_name);
    setDescription(r.description || '');
    setIsActive(r.is_active);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSaveRoute = async (e: React.FormEvent, openEditorAfter = false) => {
    e.preventDefault();
    if (!routeNumber.trim() || !routeName.trim()) {
      setFormError("Yo'nalish raqami va nomi majburiy.");
      return;
    }

    const startLabel = routeName.includes('—') ? routeName.split('—')[0].trim() : (routeName.split('-')[0]?.trim() || "Bosh nuqta");
    const endLabel = routeName.includes('—') ? routeName.split('—')[1].trim() : (routeName.split('-')[1]?.trim() || "Oxirgi nuqta");

    const directions: RouteDirectionConfig[] = [
      {
        id: editingRoute?.directions?.[0]?.id || `dir-${Date.now()}-out`,
        direction: 'outbound',
        start_name: startLabel,
        end_name: endLabel,
        stops_count: 0,
        distance_km: editingRoute?.directions?.[0]?.distance_km || 0,
        estimated_duration_min: editingRoute?.directions?.[0]?.estimated_duration_min || 0,
        is_active: true,
      },
      {
        id: editingRoute?.directions?.[1]?.id || `dir-${Date.now()}-in`,
        direction: 'inbound',
        start_name: endLabel,
        end_name: startLabel,
        stops_count: 0,
        distance_km: editingRoute?.directions?.[1]?.distance_km || 0,
        estimated_duration_min: editingRoute?.directions?.[1]?.estimated_duration_min || 0,
        is_active: true,
      },
    ];

    try {
      let savedRouteId = editingRoute?.id;
      if (editingRoute) {
        const updated = await uyushmaApi.updateRoute(uyushmaId, editingRoute.id, {
          route_number: routeNumber,
          route_name: routeName,
          description,
          is_active: isActive,
          directions,
        });
        setRoutes(prev => prev.map(r => (r.id === updated.id ? updated : r)));
        savedRouteId = updated.id;
      } else {
        const created = await uyushmaApi.createRoute(uyushmaId, {
          route_number: routeNumber,
          route_name: routeName,
          description,
          is_active: isActive,
          directions,
        });
        setRoutes(prev => [created, ...prev]);
        savedRouteId = created.id;
      }
      setIsModalOpen(false);

      if (openEditorAfter && savedRouteId) {
        navigate(`/uyushma/routes/editor/${savedRouteId}`);
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Xatolik yuz berdi');
    }
  };

  const handleDeleteRoute = async (routeId: string) => {
    if (!window.confirm("Haqiqatan ham ushbu yo'nalishni o'chirmoqchimisiz?")) return;
    await uyushmaApi.deleteRoute(uyushmaId, routeId);
    setRoutes(prev => prev.filter(r => r.id !== routeId));
  };

  const filteredRoutes = routes.filter(r => {
    const q = searchQuery.toLowerCase();
    return (
      r.route_number.toLowerCase().includes(q) ||
      r.route_name.toLowerCase().includes(q) ||
      (r.description && r.description.toLowerCase().includes(q))
    );
  });

  return (
    <div className="uyushma-page-container">
      {/* Header */}
      <div className="uyushma-page-header">
        <div className="uyushma-page-header__left">
          <h1>
            <i className="ri-route-line" style={{ color: 'var(--accent-primary)' }} />
            Yo'nalishlar boshqaruvi
          </h1>
          <p>Tashkilot tasarrufidagi barcha jamoat transporti yo'nalishlari va ularning yo'nalish qismlari (directions)</p>
        </div>

        <div className="uyushma-page-header__actions">
          <button className="btn-secondary-action" onClick={() => navigate('/uyushma/routes/editor')}>
            <i className="ri-map-2-line" style={{ color: 'var(--accent-primary)' }} />
            Visual Editor
          </button>
          <button className="btn-secondary-action" onClick={loadRoutes}>
            <i className="ri-refresh-line" />
            Yangilash
          </button>
          <button className="btn-primary-action" onClick={openCreateModal}>
            <i className="ri-add-line" />
            Yangi yo'nalish
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="uyushma-toolbar">
        <div className="uyushma-search-input">
          <i className="ri-search-line" />
          <input
            type="text"
            placeholder="Yo'nalish raqami yoki nomi bo'yicha qidirish..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Jami yo'nalishlar: <strong>{routes.length} ta</strong>
        </div>
      </div>

      {/* Routes Table */}
      <div className="uyushma-table-wrapper">
        <table className="uyushma-table">
          <thead>
            <tr>
              <th>Raqam</th>
              <th>Yo'nalish nomi</th>
              <th>Marshrut chizig'i (Xarita)</th>
              <th>Transportlar</th>
              <th>Haydovchilar</th>
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
            ) : filteredRoutes.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
                  Yo'nalishlar topilmadi.
                </td>
              </tr>
            ) : (
              filteredRoutes.map(r => (
                <tr key={r.id}>
                  <td>
                    <span className="route-number-badge">№ {r.route_number}</span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.route_name}</div>
                    {r.description && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{r.description}</div>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn-secondary-action"
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                      onClick={() => navigate(`/uyushma/routes/editor/${r.id}`)}
                    >
                      <i className="ri-pencil-ruler-2-line" style={{ color: 'var(--accent-primary)' }} />
                      Xaritada chizish / tahrirlash
                    </button>
                  </td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{r.assigned_vehicles_count}</span> ta
                  </td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{r.assigned_drivers_count}</span> ta
                  </td>
                  <td>
                    <span className={`status-pill ${r.is_active ? 'active' : 'inactive'}`}>
                      <i className="ri-circle-fill" style={{ fontSize: '0.5rem' }} />
                      {r.is_active ? 'Faol' : 'To\'xtatilgan'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="btn-table-action"
                        onClick={() => navigate(`/uyushma/routes/editor/${r.id}`)}
                        title="Visual Route Editor (Xaritada chizish)"
                      >
                        <i className="ri-pencil-ruler-2-line" style={{ color: 'var(--accent-primary)' }} />
                      </button>
                      <button
                        className="btn-table-action"
                        onClick={() => openEditModal(r)}
                        title="Tahrirlash"
                      >
                        <i className="ri-edit-line" />
                      </button>
                      <button
                        className="btn-table-action danger"
                        onClick={() => handleDeleteRoute(r.id)}
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

      {/* Modal: Create/Edit Route */}
      {isModalOpen && (
        <div className="uyushma-modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="uyushma-modal-card" onClick={e => e.stopPropagation()}>
            <div className="uyushma-modal-header">
              <h3>
                <i className="ri-route-line" style={{ color: 'var(--accent-primary)' }} />
                {editingRoute ? "Yo'nalishni tahrirlash" : "Yangi yo'nalish yaratish"}
              </h3>
              <button className="btn-modal-close" onClick={() => setIsModalOpen(false)}>
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={(e) => handleSaveRoute(e, false)}>
              <div className="uyushma-modal-body">
                {formError && (
                  <div className="rule-conflict-alert">
                    <i className="ri-error-warning-fill" />
                    <div>{formError}</div>
                  </div>
                )}

                <div className="form-grid-2">
                  <div className="uyushma-form-group">
                    <label>Yo'nalish raqami *</label>
                    <input
                      type="text"
                      className="uyushma-input"
                      placeholder="Masalan: 12"
                      value={routeNumber}
                      onChange={e => setRouteNumber(e.target.value)}
                      required
                    />
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

                <div className="uyushma-form-group">
                  <label>Yo'nalish nomi *</label>
                  <input
                    type="text"
                    className="uyushma-input"
                    placeholder="Masalan: O'sh ko'chasi — Yangi Bozor"
                    value={routeName}
                    onChange={e => setRouteName(e.target.value)}
                    required
                  />
                </div>

                <div className="uyushma-form-group">
                  <label>Tavsif (ixtiyoriy)</label>
                  <textarea
                    className="uyushma-textarea"
                    rows={2}
                    placeholder="Marshrut, ko'chalar yoki yo'nalish haqida qisqacha ma'lumot..."
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                  />
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
                <button type="submit" className="btn-secondary-action">
                  <i className="ri-save-line" />
                  Saqlash
                </button>
                <button
                  type="button"
                  className="btn-primary-action"
                  onClick={(e) => handleSaveRoute(e, true)}
                >
                  <i className="ri-pencil-ruler-2-line" />
                  Saqlash va Xaritada chizish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: View Directions details */}
      {selectedRouteDirections && (
        <div className="uyushma-modal-overlay" onClick={() => setSelectedRouteDirections(null)}>
          <div className="uyushma-modal-card" onClick={e => e.stopPropagation()}>
            <div className="uyushma-modal-header">
              <h3>
                <span className="route-number-badge" style={{ marginRight: '0.5rem' }}>№ {selectedRouteDirections.route_number}</span>
                Yo'nalish qismlari (Directions)
              </h3>
              <button className="btn-modal-close" onClick={() => setSelectedRouteDirections(null)}>
                <i className="ri-close-line" />
              </button>
            </div>

            <div className="uyushma-modal-body">
              <div className="directions-list">
                {selectedRouteDirections.directions.map(dir => (
                  <div key={dir.id} className="direction-card">
                    <div>
                      <div className="direction-card__name">
                        {dir.direction === 'outbound' ? '➡️ Borish yo\'nalishi (Outbound)' : '⬅️ Qaytish yo\'nalishi (Inbound)'}
                      </div>
                      <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                        {dir.start_name} ➔ {dir.end_name}
                      </div>
                      <div className="direction-card__stats">
                        {dir.distance_km} km • {dir.stops_count} ta bekat • ~{dir.estimated_duration_min} daqiqa
                      </div>
                    </div>
                    <span className={`status-pill ${dir.is_active ? 'active' : 'inactive'}`}>
                      {dir.is_active ? 'Faol' : 'Nofaol'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="uyushma-modal-footer">
              <button
                type="button"
                className="btn-primary-action"
                onClick={() => setSelectedRouteDirections(null)}
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
