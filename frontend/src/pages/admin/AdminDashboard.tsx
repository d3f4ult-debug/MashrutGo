import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../../services/api/adminApi';
import type { AdminGlobalKPIs, AuditLogEntry, AdminLiveShift } from '../../types/admin';
import './AdminOperations.css';
import '../uyushma/UyushmaOperations.css';

export function AdminDashboard() {
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<AdminGlobalKPIs | null>(null);
  const [recentAudits, setRecentAudits] = useState<AuditLogEntry[]>([]);
  const [liveShifts, setLiveShifts] = useState<AdminLiveShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      const [kpiData, auditData, shiftsData] = await Promise.all([
        adminApi.getGlobalKPIs(),
        adminApi.getAuditLogs(),
        adminApi.getLiveShifts(),
      ]);
      setKpis(kpiData);
      setRecentAudits(auditData.slice(0, 5));
      setLiveShifts(shiftsData);
    } catch {
      // Handled in API
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  const formatUZS = (val: number) => `${val.toLocaleString('uz-UZ')} UZS`;

  return (
    <div className="admin-page-container">
      {/* Header */}
      <div className="admin-page-header">
        <div className="admin-page-header__left">
          <h1>
            <i className="ri-shield-star-fill" style={{ color: 'var(--admin-accent)' }} />
            Super Admin global boshqaruv paneli
          </h1>
          <p>Butun platforma miqyosidagi tashkilotlar, yo'nalishlar, xavfsizlik va audit monitoringi</p>
        </div>

        <div className="uyushma-page-header__actions">
          <button className="btn-secondary-action" onClick={loadDashboardData} disabled={isLoading}>
            <i className={isLoading ? "ri-loader-4-line ri-spin" : "ri-refresh-line"} />
            Yangilash
          </button>
          <button className="btn-admin-primary" onClick={() => navigate('/admin/uyushmalar')}>
            <i className="ri-add-line" />
            Yangi Uyushma ochish
          </button>
        </div>
      </div>

      {/* Global KPIs Grid */}
      <div className="admin-kpis-grid">
        {/* KPI 1: Uyushmalar */}
        <div className="admin-kpi-card" onClick={() => navigate('/admin/uyushmalar')} style={{ cursor: 'pointer' }}>
          <div className="admin-kpi-card__icon" style={{ background: 'var(--admin-accent-subtle)', color: 'var(--admin-accent)' }}>
            <i className="ri-building-2-line" />
          </div>
          <div className="admin-kpi-card__content">
            <span className="admin-kpi-card__value">{kpis?.total_uyushmalar || 0}</span>
            <span className="admin-kpi-card__label">Faol Uyushmalar</span>
            <span className="admin-kpi-card__subtext">Yo'lovchi tashuvchi tashkilotlar</span>
          </div>
        </div>

        {/* KPI 2: Global Routes */}
        <div className="admin-kpi-card" onClick={() => navigate('/admin/routes')} style={{ cursor: 'pointer' }}>
          <div className="admin-kpi-card__icon" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>
            <i className="ri-route-line" />
          </div>
          <div className="admin-kpi-card__content">
            <span className="admin-kpi-card__value">{kpis?.total_routes || 0}</span>
            <span className="admin-kpi-card__label">Jami Yo'nalishlar</span>
            <span className="admin-kpi-card__subtext">Barcha hududlar bo'ylab</span>
          </div>
        </div>

        {/* KPI 3: Live Shifts & Drivers */}
        <div className="admin-kpi-card" onClick={() => navigate('/admin/shifts')} style={{ cursor: 'pointer' }}>
          <div className="admin-kpi-card__icon" style={{ background: 'var(--success-subtle)', color: 'var(--success)' }}>
            <i className="ri-steering-2-line" />
          </div>
          <div className="admin-kpi-card__content">
            <span className="admin-kpi-card__value">
              {kpis?.active_shifts || 0} <span style={{ fontSize: '0.9rem', color: 'var(--text-tertiary)' }}>/ {kpis?.total_drivers || 0}</span>
            </span>
            <span className="admin-kpi-card__label">Liniyadagi smenalar</span>
            <span className="admin-kpi-card__subtext">Jonli GPS faolligi</span>
          </div>
        </div>

        {/* KPI 4: Registered Clients */}
        <div className="admin-kpi-card" onClick={() => navigate('/admin/clients')} style={{ cursor: 'pointer' }}>
          <div className="admin-kpi-card__icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' }}>
            <i className="ri-group-line" />
          </div>
          <div className="admin-kpi-card__content">
            <span className="admin-kpi-card__value">{kpis?.total_clients || 0}</span>
            <span className="admin-kpi-card__label">Ro'yxatdan o'tgan mijozlar</span>
            <span className="admin-kpi-card__subtext">Ilova foydalanuvchilari</span>
          </div>
        </div>

        {/* KPI 5: Platform Revenue & Fee */}
        <div className="admin-kpi-card" onClick={() => navigate('/admin/payments')} style={{ cursor: 'pointer' }}>
          <div className="admin-kpi-card__icon" style={{ background: 'rgba(6, 182, 212, 0.15)', color: 'var(--info)' }}>
            <i className="ri-wallet-3-line" />
          </div>
          <div className="admin-kpi-card__content">
            <span className="admin-kpi-card__value">
              {formatUZS(kpis?.today_gross_revenue || 0)}
            </span>
            <span className="admin-kpi-card__label">Bugungi tizim aylanmasi</span>
            <span className="admin-kpi-card__subtext">
              Platforma ulushi (1%): {formatUZS(kpis?.today_platform_commission || 0)}
            </span>
          </div>
        </div>

        {/* KPI 6: System Status */}
        <div className="admin-kpi-card" onClick={() => navigate('/admin/settings')} style={{ cursor: 'pointer' }}>
          <div className="admin-kpi-card__icon" style={{ background: 'rgba(34, 197, 94, 0.15)', color: 'var(--success)' }}>
            <i className="ri-server-line" />
          </div>
          <div className="admin-kpi-card__content">
            <span className="admin-kpi-card__value" style={{ textTransform: 'capitalize' }}>
              {kpis?.system_status || 'Healthy'}
            </span>
            <span className="admin-kpi-card__label">Tizim holati (WebSocket & API)</span>
            <span className="admin-kpi-card__subtext">Normal ish faoliyatida</span>
          </div>
        </div>
      </div>

      {/* Quick Access Tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
        <button
          className="btn-secondary-action"
          style={{ justifyContent: 'center', padding: '0.85rem' }}
          onClick={() => navigate('/admin/uyushmalar')}
        >
          <i className="ri-building-2-line" style={{ color: 'var(--admin-accent)' }} />
          Uyushmalar boshqaruvi
        </button>

        <button
          className="btn-secondary-action"
          style={{ justifyContent: 'center', padding: '0.85rem' }}
          onClick={() => navigate('/admin/clients')}
        >
          <i className="ri-group-line" style={{ color: 'var(--warning)' }} />
          Mijozlar reestri
        </button>

        <button
          className="btn-secondary-action"
          style={{ justifyContent: 'center', padding: '0.85rem' }}
          onClick={() => navigate('/admin/shifts')}
        >
          <i className="ri-steering-2-line" style={{ color: 'var(--success)' }} />
          Jonli smenalar (Monitor)
        </button>

        <button
          className="btn-secondary-action"
          style={{ justifyContent: 'center', padding: '0.85rem' }}
          onClick={() => navigate('/admin/settings')}
        >
          <i className="ri-settings-4-line" style={{ color: 'var(--accent-primary)' }} />
          Tizim sozlamalari
        </button>

        <button
          className="btn-secondary-action"
          style={{ justifyContent: 'center', padding: '0.85rem' }}
          onClick={() => navigate('/admin/audit')}
        >
          <i className="ri-file-list-3-line" style={{ color: 'var(--danger)' }} />
          Audit xavfsizlik jurnali
        </button>
      </div>

      {/* Split View: Live Shifts & Recent Audit Activity */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '1.25rem' }}>
        {/* Live Active Shifts */}
        <div className="uyushma-table-wrapper">
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
              Faol smenalar ({liveShifts.length})
            </h3>
            <button
              className="btn-secondary-action"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
              onClick={() => navigate('/admin/shifts')}
            >
              Barchasi
            </button>
          </div>

          <table className="uyushma-table">
            <thead>
              <tr>
                <th>Haydovchi</th>
                <th>Tashkilot</th>
                <th>Yo'nalish</th>
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {liveShifts.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
                    Faol smenalar yo'q
                  </td>
                </tr>
              ) : (
                liveShifts.map(s => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.driver_name}</div>
                      <span className="vehicle-plate-badge">{s.vehicle_plate}</span>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {s.uyushma_name}
                    </td>
                    <td>
                      <span className="route-number-badge">№ {s.route_number}</span>
                    </td>
                    <td>
                      <span className="status-pill online">
                        <i className="ri-radio-button-fill" />
                        Online
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Recent Audit Log Stream */}
        <div className="uyushma-table-wrapper">
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
              So'nggi xavfsizlik va audit voqealari
            </h3>
            <button
              className="btn-secondary-action"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
              onClick={() => navigate('/admin/audit')}
            >
              To'liq jurnal
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', padding: '0.75rem 1.25rem', gap: '0.75rem' }}>
            {recentAudits.map(a => (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  padding: '0.5rem 0',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{a.description}</div>
                  <div style={{ fontSize: '0.725rem', color: 'var(--text-tertiary)', marginTop: '0.15rem' }}>
                    Ijrochi: {a.actor_name} ({a.actor_role}) • {a.ip_address || '127.0.0.1'}
                  </div>
                  {a.audit_reason && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--danger)', marginTop: '0.1rem' }}>
                      Sabab: {a.audit_reason}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                  {new Date(a.timestamp).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
