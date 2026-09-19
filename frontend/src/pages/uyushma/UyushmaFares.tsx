import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { uyushmaApi } from '../../services/api/uyushmaApi';
import type { UyushmaFareRule, UyushmaRoute, FareRuleType } from '../../types/uyushma';
import './UyushmaOperations.css';

export function UyushmaFares() {
  const { user } = useAuth();
  const uyushmaId = user?.uyushma_id || 'uyushma-01';

  const [fares, setFares] = useState<UyushmaFareRule[]>([]);
  const [routes, setRoutes] = useState<UyushmaRoute[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFare, setEditingFare] = useState<UyushmaFareRule | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [ruleType, setRuleType] = useState<FareRuleType>('fixed');
  const [amount, setAmount] = useState<number>(3000);
  const [perKmRate, setPerKmRate] = useState<number>(500);
  const [includedKm, setIncludedKm] = useState<number>(3);
  const [crossZoneExtra, setCrossZoneExtra] = useState<number>(1000);
  const [peakMultiplier, setPeakMultiplier] = useState<number>(1.25);
  const [targetRouteId, setTargetRouteId] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [faresData, routesData] = await Promise.all([
        uyushmaApi.getFareRules(uyushmaId),
        uyushmaApi.getRoutes(uyushmaId),
      ]);
      setFares(faresData);
      setRoutes(routesData);
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [uyushmaId]);

  const openCreateModal = () => {
    setEditingFare(null);
    setName('');
    setRuleType('fixed');
    setAmount(3000);
    setPerKmRate(500);
    setIncludedKm(3);
    setCrossZoneExtra(1000);
    setPeakMultiplier(1.25);
    setTargetRouteId('');
    setDescription('');
    setIsActive(true);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (f: UyushmaFareRule) => {
    setEditingFare(f);
    setName(f.name);
    setRuleType(f.rule_type);
    setAmount(f.amount);
    setPerKmRate(f.per_km_rate || 500);
    setIncludedKm(f.included_km || 3);
    setCrossZoneExtra(f.cross_zone_extra || 1000);
    setPeakMultiplier(f.peak_multiplier || 1.25);
    setTargetRouteId(f.target_route_id || '');
    setDescription(f.description || '');
    setIsActive(f.is_active);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSaveFare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError("Tarif nomi majburiy.");
      return;
    }
    if (amount <= 0) {
      setFormError("Tarif narxi musbat bo'lishi kerak.");
      return;
    }

    try {
      const extraConfig = {
        per_km_rate: ruleType === 'distance' ? perKmRate : undefined,
        included_km: ruleType === 'distance' ? includedKm : undefined,
        cross_zone_extra: ruleType === 'zone' ? crossZoneExtra : undefined,
        peak_multiplier: ruleType === 'time_based' ? peakMultiplier : undefined,
      };

      if (editingFare) {
        const route = routes.find(r => r.id === targetRouteId);
        const updated = await uyushmaApi.updateFareRule(uyushmaId, editingFare.id, {
          name,
          rule_type: ruleType,
          amount,
          target_route_id: targetRouteId || undefined,
          target_route_number: route?.route_number,
          description,
          is_active: isActive,
          ...extraConfig,
        });
        setFares(prev => prev.map(f => (f.id === updated.id ? updated : f)));
      } else {
        const created = await uyushmaApi.createFareRule(uyushmaId, {
          name,
          rule_type: ruleType,
          amount,
          target_route_id: targetRouteId || undefined,
          description,
          is_active: isActive,
          ...extraConfig,
        });
        setFares(prev => [created, ...prev]);
      }
      setIsModalOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Xatolik yuz berdi');
    }
  };

  const handleDeleteFare = async (fareId: string) => {
    if (!window.confirm("Haqiqatan ham ushbu tarifni o'chirmoqchimisiz?")) return;
    await uyushmaApi.deleteFareRule(uyushmaId, fareId);
    setFares(prev => prev.filter(f => f.id !== fareId));
  };

  const filteredFares = fares.filter(f => {
    const q = searchQuery.toLowerCase();
    return (
      f.name.toLowerCase().includes(q) ||
      (f.target_route_number && f.target_route_number.toLowerCase().includes(q)) ||
      (f.description && f.description.toLowerCase().includes(q))
    );
  });

  return (
    <div className="uyushma-page-container">
      {/* Header */}
      <div className="uyushma-page-header">
        <div className="uyushma-page-header__left">
          <h1>
            <i className="ri-money-dollar-circle-line" style={{ color: '#a855f7' }} />
            Tariflar va to'lov qoidalari
          </h1>
          <p>
            Shahar ichi marshrutlari uchun belgilangan tariflar (MVP qat'iy narx, kelajakda masofa va zonalarga moslashtirilgan)
          </p>
        </div>

        <div className="uyushma-page-header__actions">
          <button className="btn-secondary-action" onClick={loadData}>
            <i className="ri-refresh-line" />
            Yangilash
          </button>
          <button className="btn-primary-action" onClick={openCreateModal}>
            <i className="ri-add-line" />
            Yangi tarif yaratish
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="uyushma-toolbar">
        <div className="uyushma-search-input">
          <i className="ri-search-line" />
          <input
            type="text"
            placeholder="Tarif nomi yoki yo'nalish..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Jami tariflar: <strong>{fares.length} ta</strong>
        </div>
      </div>

      {/* Fares Table */}
      <div className="uyushma-table-wrapper">
        <table className="uyushma-table">
          <thead>
            <tr>
              <th>Tarif nomi</th>
              <th>Tarif turi</th>
              <th>Yo'l haqi summasi</th>
              <th>Qo'llaniladigan yo'nalish</th>
              <th>Tavsif</th>
              <th>Holat</th>
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
            ) : filteredFares.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
                  Tariflar topilmadi.
                </td>
              </tr>
            ) : (
              filteredFares.map(f => (
                <tr key={f.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{f.name}</div>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', background: 'var(--surface-hover)', padding: '0.15rem 0.4rem', borderRadius: 4 }}>
                      {f.rule_type === 'fixed' && 'Qat\'iy narx'}
                      {f.rule_type === 'distance' && 'Masofaga bog\'liq'}
                      {f.rule_type === 'zone' && 'Zonaviy tarif'}
                      {f.rule_type === 'time_based' && 'Vaqt / Pik'}
                    </span>
                  </td>
                  <td>
                    <strong style={{ fontSize: '1rem', color: 'var(--success)' }}>
                      {f.amount.toLocaleString('uz-UZ')} UZS
                    </strong>
                    {f.rule_type === 'distance' && f.per_km_rate && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                        +{f.per_km_rate.toLocaleString('uz-UZ')} UZS/km ({f.included_km || 3} km dan so'ng)
                      </div>
                    )}
                    {f.rule_type === 'zone' && f.cross_zone_extra && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                        +{f.cross_zone_extra.toLocaleString('uz-UZ')} UZS zona ustamasi
                      </div>
                    )}
                    {f.rule_type === 'time_based' && f.peak_multiplier && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                        x{f.peak_multiplier} pik koeffitsiyenti
                      </div>
                    )}
                  </td>
                  <td>
                    {f.target_route_number ? (
                      <span className="route-number-badge">№ {f.target_route_number}</span>
                    ) : (
                      <span style={{ color: 'var(--accent-primary)', fontSize: '0.8rem', fontWeight: 600 }}>
                        Barcha yo'nalishlar
                      </span>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    {f.description || '—'}
                  </td>
                  <td>
                    <span className={`status-pill ${f.is_active ? 'active' : 'inactive'}`}>
                      {f.is_active ? 'Faol' : 'Nofaol'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="btn-table-action"
                        onClick={() => openEditModal(f)}
                        title="Tahrirlash"
                      >
                        <i className="ri-edit-line" />
                      </button>
                      <button
                        className="btn-table-action danger"
                        onClick={() => handleDeleteFare(f.id)}
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

      {/* Modal: Create/Edit Fare Rule */}
      {isModalOpen && (
        <div className="uyushma-modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="uyushma-modal-card" onClick={e => e.stopPropagation()}>
            <div className="uyushma-modal-header">
              <h3>
                <i className="ri-money-dollar-circle-line" style={{ color: '#a855f7' }} />
                {editingFare ? "Tarifni tahrirlash" : "Yangi tarif yaratish"}
              </h3>
              <button className="btn-modal-close" onClick={() => setIsModalOpen(false)}>
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={handleSaveFare}>
              <div className="uyushma-modal-body">
                {formError && (
                  <div className="rule-conflict-alert">
                    <i className="ri-error-warning-fill" />
                    <div>{formError}</div>
                  </div>
                )}

                <div className="uyushma-form-group">
                  <label>Tarif nomi *</label>
                  <input
                    type="text"
                    className="uyushma-input"
                    placeholder="Masalan: Standart shahar tarifi"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-grid-2">
                  <div className="uyushma-form-group">
                    <label>Yo'l haqi summasi (UZS) *</label>
                    <input
                      type="number"
                      className="uyushma-input"
                      value={amount}
                      onChange={e => setAmount(parseInt(e.target.value))}
                      min={500}
                      step={500}
                      required
                    />
                  </div>

                  <div className="uyushma-form-group">
                    <label>Tarif modeli</label>
                    <select
                      className="uyushma-select"
                      value={ruleType}
                      onChange={e => setRuleType(e.target.value as FareRuleType)}
                    >
                      <option value="fixed">Qat'iy narx (Fixed MVP)</option>
                      <option value="distance">Masofaga bog'liq (Distance)</option>
                      <option value="zone">Zonaviy narx (Zone)</option>
                      <option value="time_based">Vaqtga bog'liq (Time-based / Peak)</option>
                    </select>
                  </div>
                </div>

                {/* Extensible Parameters */}
                {ruleType === 'distance' && (
                  <div className="form-grid-2" style={{ background: 'var(--surface-elevated)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                    <div className="uyushma-form-group">
                      <label>Dastlabki kiritilgan masofa (km)</label>
                      <input
                        type="number"
                        className="uyushma-input"
                        value={includedKm}
                        onChange={e => setIncludedKm(parseFloat(e.target.value))}
                        min={1}
                      />
                    </div>
                    <div className="uyushma-form-group">
                      <label>Har 1 km uchun qo'shimcha narx (UZS)</label>
                      <input
                        type="number"
                        className="uyushma-input"
                        value={perKmRate}
                        onChange={e => setPerKmRate(parseInt(e.target.value))}
                        min={100}
                        step={100}
                      />
                    </div>
                  </div>
                )}

                {ruleType === 'zone' && (
                  <div style={{ background: 'var(--surface-elevated)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                    <div className="uyushma-form-group">
                      <label>Zonalararo o'tish ustamasi (UZS)</label>
                      <input
                        type="number"
                        className="uyushma-input"
                        value={crossZoneExtra}
                        onChange={e => setCrossZoneExtra(parseInt(e.target.value))}
                        min={500}
                        step={500}
                      />
                    </div>
                  </div>
                )}

                {ruleType === 'time_based' && (
                  <div style={{ background: 'var(--surface-elevated)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                    <div className="uyushma-form-group">
                      <label>Pik soatlaridagi ko'paytiruvchi koeffitsiyent (Multiplier)</label>
                      <input
                        type="number"
                        step="0.05"
                        className="uyushma-input"
                        value={peakMultiplier}
                        onChange={e => setPeakMultiplier(parseFloat(e.target.value))}
                        min={1.0}
                        max={3.0}
                      />
                      <span className="hint">Masalan 1.25 = tirbandlik vaqtida 25% qo'shimcha</span>
                    </div>
                  </div>
                )}

                <div className="form-grid-2">
                  <div className="uyushma-form-group">
                    <label>Qaysi yo'nalishga qo'llaniladi?</label>
                    <select
                      className="uyushma-select"
                      value={targetRouteId}
                      onChange={e => setTargetRouteId(e.target.value)}
                    >
                      <option value="">Barcha yo'nalishlar uchun</option>
                      {routes.map(r => (
                        <option key={r.id} value={r.id}>
                          № {r.route_number} ({r.route_name})
                        </option>
                      ))}
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

                <div className="uyushma-form-group">
                  <label>Tavsif (Ixtiyoriy)</label>
                  <textarea
                    className="uyushma-textarea"
                    rows={2}
                    placeholder="Masalan: Soat 20:00 dan keyingi tungi qatnovlar uchun yoki talabalar uchun imtiyozli qatnov..."
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
