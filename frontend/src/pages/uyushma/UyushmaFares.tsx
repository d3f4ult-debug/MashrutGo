import { useState, useEffect, useCallback, useRef } from 'react';
import { useUyushmaScope } from '../../contexts/UyushmaScopeContext';
import { uyushmaApi } from '../../services/api/uyushmaApi';
import { errorMessage } from '../../services/api/client';
import { formatSom } from '../../utils/format';
import type { UyushmaFareRule, UyushmaRoute, FareRuleType } from '../../types/uyushma';
import './UyushmaOperations.css';

export function UyushmaFares() {
  const { uyushmaId: scopedUyushmaId } = useUyushmaScope();
  const uyushmaId = scopedUyushmaId ?? '';

  const [fares, setFares] = useState<UyushmaFareRule[]>([]);
  const [routes, setRoutes] = useState<UyushmaRoute[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  // Peak window, matching the backend default (07:00–10:00) when a rule does not set one
  const [peakStartHour, setPeakStartHour] = useState<number>(7);
  const [peakEndHour, setPeakEndHour] = useState<number>(10);
  const [targetRouteId, setTargetRouteId] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A Super Admin can switch uyushma mid-load: the answer of an abandoned scope must be ignored
  const activeScope = useRef(uyushmaId);
  activeScope.current = uyushmaId;

  const loadData = useCallback(async () => {
    if (!uyushmaId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const [faresData, routesData] = await Promise.all([
        uyushmaApi.getFareRules(uyushmaId),
        uyushmaApi.getRoutes(uyushmaId),
      ]);
      if (activeScope.current !== uyushmaId) return;
      setFares(faresData);
      setRoutes(routesData);
    } catch (err) {
      if (activeScope.current !== uyushmaId) return;
      setLoadError(errorMessage(err, "Tariflarni yuklab bo'lmadi"));
    } finally {
      if (activeScope.current === uyushmaId) setIsLoading(false);
    }
  }, [uyushmaId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Never leave a form open over a rule that belongs to the uyushma we just left
  useEffect(() => {
    setIsModalOpen(false);
    setEditingFare(null);
    setFormError(null);
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
    setPeakStartHour(7);
    setPeakEndHour(10);
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
    setPeakStartHour(f.peak_start_hour ?? 7);
    setPeakEndHour(f.peak_end_hour ?? 10);
    setTargetRouteId(f.target_route_id || '');
    setDescription(f.description || '');
    setIsActive(f.is_active);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSaveFare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return; // a second submit would create a second fare rule
    if (!name.trim()) {
      setFormError("Tarif nomi majburiy.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Tarif narxi musbat son bo'lishi kerak.");
      return;
    }
    if (ruleType === 'distance' && (!Number.isFinite(perKmRate) || perKmRate < 0 || !Number.isFinite(includedKm) || includedKm < 0)) {
      setFormError("Km narxi va bepul km musbat son bo'lishi kerak.");
      return;
    }
    if (ruleType === 'zone' && (!Number.isFinite(crossZoneExtra) || crossZoneExtra < 0)) {
      setFormError("Zona ustamasi musbat son bo'lishi kerak.");
      return;
    }
    if (ruleType === 'time_based') {
      if (!Number.isFinite(peakMultiplier) || peakMultiplier < 1) {
        setFormError("Pik koeffitsiyenti 1.0 dan kichik bo'lmasligi kerak.");
        return;
      }
      if (!Number.isInteger(peakStartHour) || !Number.isInteger(peakEndHour) || peakStartHour < 0 || peakStartHour > 23 || peakEndHour < 0 || peakEndHour > 23) {
        setFormError('Pik soatlari 0 va 23 orasida bo‘lishi kerak.');
        return;
      }
      if (peakStartHour === peakEndHour) {
        setFormError('Pik boshlanish va tugash soati bir xil bo‘lmasligi kerak.');
        return;
      }
    }

    setSaving(true);
    try {
      // Every field of the rule's own type is sent, because the backend stores `config` as a whole:
      // omitting the peak window here used to erase it on every save of a time_based rule.
      const extraConfig = {
        per_km_rate: ruleType === 'distance' ? perKmRate : undefined,
        included_km: ruleType === 'distance' ? includedKm : undefined,
        cross_zone_extra: ruleType === 'zone' ? crossZoneExtra : undefined,
        peak_multiplier: ruleType === 'time_based' ? peakMultiplier : undefined,
        peak_start_hour: ruleType === 'time_based' ? peakStartHour : undefined,
        peak_end_hour: ruleType === 'time_based' ? peakEndHour : undefined,
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
      setFormError(errorMessage(err, 'Xatolik yuz berdi'));
    } finally {
      setSaving(false);
    }
  };

  /** Tariffs referenced by payments are kept for history: "delete" deactivates the rule. */
  const handleDeleteFare = async (fareId: string) => {
    if (!window.confirm("Tarif faolsizlantirilsinmi? Yangi to'lovlarda qo'llanilmaydi (tarix saqlanadi).")) return;
    setLoadError(null);
    try {
      await uyushmaApi.deleteFareRule(uyushmaId, fareId);
      setFares(prev => prev.map(f => (f.id === fareId ? { ...f, is_active: false } : f)));
    } catch (err) {
      setLoadError(errorMessage(err, "Tarifni faolsizlantirib bo'lmadi"));
    }
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

      {!uyushmaId && (
        <div className="rule-conflict-alert">
          <i className="ri-building-2-line" />
          <div>Uyushma tanlanmagan. Yuqoridagi ro'yxatdan Uyushmani tanlang.</div>
        </div>
      )}
      {loadError && (
        <div className="rule-conflict-alert" role="alert">
          <i className="ri-error-warning-fill" />
          <div>{loadError}</div>
        </div>
      )}

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
                      {formatSom(f.amount)}
                    </strong>
                    {f.rule_type === 'distance' && f.per_km_rate && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                        +{formatSom(f.per_km_rate)}/km ({f.included_km || 3} km dan so'ng)
                      </div>
                    )}
                    {f.rule_type === 'zone' && f.cross_zone_extra && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                        +{formatSom(f.cross_zone_extra)} zona ustamasi
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
                    <div className="form-grid-2">
                      <div className="uyushma-form-group">
                        <label>Pik boshlanishi (soat)</label>
                        <input
                          type="number"
                          className="uyushma-input"
                          value={peakStartHour}
                          onChange={e => setPeakStartHour(parseInt(e.target.value, 10))}
                          min={0}
                          max={23}
                        />
                      </div>
                      <div className="uyushma-form-group">
                        <label>Pik tugashi (soat)</label>
                        <input
                          type="number"
                          className="uyushma-input"
                          value={peakEndHour}
                          onChange={e => setPeakEndHour(parseInt(e.target.value, 10))}
                          min={0}
                          max={23}
                        />
                      </div>
                    </div>
                    <span className="hint">
                      {peakStartHour > peakEndHour
                        ? `Tungi oyna: ${peakStartHour}:00 dan ertangi ${peakEndHour}:00 gacha`
                        : `Kunlik oyna: ${peakStartHour}:00 – ${peakEndHour}:00`}
                    </span>
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
                <button type="submit" className="btn-primary-action" disabled={saving}>
                  <i className={saving ? 'ri-loader-4-line ri-spin' : 'ri-save-line'} />
                  {saving ? 'Saqlanmoqda…' : 'Saqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
