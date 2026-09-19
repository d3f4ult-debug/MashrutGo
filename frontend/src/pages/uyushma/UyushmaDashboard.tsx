import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { uyushmaApi } from '../../services/api/uyushmaApi';
import type { UyushmaKPIs, UyushmaDriver } from '../../types/uyushma';
import './UyushmaOperations.css';

export function UyushmaDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const uyushmaId = user?.uyushma_id || 'uyushma-01';

  const [kpis, setKpis] = useState<UyushmaKPIs | null>(null);
  const [drivers, setDrivers] = useState<UyushmaDriver[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      const [kpiData, driversData] = await Promise.all([
        uyushmaApi.getKPIs(uyushmaId),
        uyushmaApi.getDrivers(uyushmaId),
      ]);
      setKpis(kpiData);
      setDrivers(driversData);
    } catch {
      // Fallback handled in API client
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [uyushmaId]);

  const activeDrivers = drivers.filter(d => d.active_shift?.is_online);

  return (
    <div className="uyushma-page-container">
      {/* Page Header */}
      <div className="uyushma-page-header">
        <div className="uyushma-page-header__left">
          <h1>
            <i className="ri-dashboard-3-line" style={{ color: 'var(--accent-primary)' }} />
            Uyushma Boshqaruv Paneli
          </h1>
          <p>Andijon viloyati marshrut transportlari operatsion monitoringi</p>
        </div>

        <div className="uyushma-page-header__actions">
          <button className="btn-secondary-action" onClick={loadDashboardData} disabled={isLoading}>
            <i className={isLoading ? "ri-loader-4-line ri-spin" : "ri-refresh-line"} />
            Yangilash
          </button>
          <button className="btn-primary-action" onClick={() => navigate('/uyushma/routes')}>
            <i className="ri-add-circle-line" />
            Yangi yo'nalish
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="uyushma-kpis-grid">
        {/* KPI 1: Owned Routes */}
        <div className="uyushma-kpi-card" onClick={() => navigate('/uyushma/routes')} style={{ cursor: 'pointer' }}>
          <div className="uyushma-kpi-card__icon" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>
            <i className="ri-route-line" />
          </div>
          <div className="uyushma-kpi-card__content">
            <span className="uyushma-kpi-card__value">{kpis?.owned_routes_count || 0}</span>
            <span className="uyushma-kpi-card__label">Biriktirilgan yo'nalishlar</span>
            <span className="uyushma-kpi-card__subtext">Barcha faol liniyalar</span>
          </div>
        </div>

        {/* KPI 2: Active Shifts / Live Vehicles */}
        <div className="uyushma-kpi-card" onClick={() => navigate('/uyushma/drivers')} style={{ cursor: 'pointer' }}>
          <div className="uyushma-kpi-card__icon" style={{ background: 'var(--success-subtle)', color: 'var(--success)' }}>
            <i className="ri-steering-2-line" />
          </div>
          <div className="uyushma-kpi-card__content">
            <span className="uyushma-kpi-card__value">
              {kpis?.active_shifts_count || 0} <span style={{ fontSize: '0.9rem', color: 'var(--text-tertiary)' }}>/ {kpis?.visible_vehicles_count || 0}</span>
            </span>
            <span className="uyushma-kpi-card__label">Faol smenalar / Avtomobillar</span>
            <span className="uyushma-kpi-card__subtext">Liniyadagi transportlar</span>
          </div>
        </div>

        {/* KPI 3: Parkings Count */}
        <div className="uyushma-kpi-card" onClick={() => navigate('/uyushma/parkings')} style={{ cursor: 'pointer' }}>
          <div className="uyushma-kpi-card__icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' }}>
            <i className="ri-parking-box-line" />
          </div>
          <div className="uyushma-kpi-card__content">
            <span className="uyushma-kpi-card__value">{kpis?.parkings_count || 0}</span>
            <span className="uyushma-kpi-card__label">Stoyankalar (Geofence)</span>
            <span className="uyushma-kpi-card__subtext">Nazorat ostidagi bekatlar</span>
          </div>
        </div>

        {/* KPI 4: Today's Payments Total */}
        <div className="uyushma-kpi-card" onClick={() => navigate('/uyushma/fares')} style={{ cursor: 'pointer' }}>
          <div className="uyushma-kpi-card__icon" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#a855f7' }}>
            <i className="ri-wallet-3-line" />
          </div>
          <div className="uyushma-kpi-card__content">
            <span className="uyushma-kpi-card__value">
              {((kpis?.today_payments_total || 0) / 1000).toLocaleString('uz-UZ')}k
            </span>
            <span className="uyushma-kpi-card__label">Bugungi to'lovlar (UZS)</span>
            <span className="uyushma-kpi-card__subtext">{kpis?.today_payments_count || 0} ta qatnov to'lovi</span>
          </div>
        </div>

        {/* KPI 5: Pending Cashouts */}
        <div className="uyushma-kpi-card">
          <div className="uyushma-kpi-card__icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)' }}>
            <i className="ri-hand-coin-line" />
          </div>
          <div className="uyushma-kpi-card__content">
            <span className="uyushma-kpi-card__value">{kpis?.pending_cashouts_count || 0}</span>
            <span className="uyushma-kpi-card__label">Kutilayotgan pul chiqarish</span>
            <span className="uyushma-kpi-card__subtext">
              {(kpis?.pending_cashouts_total || 0).toLocaleString('uz-UZ')} UZS
            </span>
          </div>
        </div>
      </div>

      {/* Quick Action Shortcuts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
        <button
          className="btn-secondary-action"
          style={{ justifyContent: 'center', padding: '0.75rem' }}
          onClick={() => navigate('/uyushma/routes')}
        >
          <i className="ri-route-line" style={{ color: 'var(--accent-primary)' }} />
          Yo'nalishlar boshqaruvi
        </button>

        <button
          className="btn-secondary-action"
          style={{ justifyContent: 'center', padding: '0.75rem' }}
          onClick={() => navigate('/uyushma/drivers')}
        >
          <i className="ri-user-add-line" style={{ color: 'var(--success)' }} />
          Yangi haydovchi yaratish
        </button>

        <button
          className="btn-secondary-action"
          style={{ justifyContent: 'center', padding: '0.75rem' }}
          onClick={() => navigate('/uyushma/vehicles')}
        >
          <i className="ri-bus-2-line" style={{ color: 'var(--warning)' }} />
          Transportlar ro'yxati
        </button>

        <button
          className="btn-secondary-action"
          style={{ justifyContent: 'center', padding: '0.75rem' }}
          onClick={() => navigate('/uyushma/parkings')}
        >
          <i className="ri-parking-box-line" style={{ color: 'var(--info)' }} />
          Stoyankalar (Geofence)
        </button>
      </div>

      {/* Active Shifts Table */}
      <div className="uyushma-table-wrapper">
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Liniyadagi faol haydovchilar ({activeDrivers.length})
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Ayni paytda smenada bo'lgan transportlar holati
            </p>
          </div>
          <button className="btn-secondary-action" onClick={() => navigate('/uyushma/map')}>
            <i className="ri-map-2-line" />
            Live xaritada ko'rish
          </button>
        </div>

        <table className="uyushma-table">
          <thead>
            <tr>
              <th>Haydovchi</th>
              <th>Yo'nalish</th>
              <th>Transport vositasi</th>
              <th>Smena boshlangan vaqt</th>
              <th>Holat</th>
            </tr>
          </thead>
          <tbody>
            {activeDrivers.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
                  Hozirda faol smenada bo'lgan haydovchilar mavjud emas.
                </td>
              </tr>
            ) : (
              activeDrivers.map(d => (
                <tr key={d.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{d.full_name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{d.phone}</div>
                  </td>
                  <td>
                    <span className="route-number-badge">№ {d.assigned_route_number}</span>
                  </td>
                  <td>
                    <span className="vehicle-plate-badge">{d.assigned_vehicle_plate || '—'}</span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {d.active_shift?.started_at ? new Date(d.active_shift.started_at).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td>
                    <span className="status-pill online">
                      <i className="ri-radio-button-fill" />
                      Liniyada faol
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
