import type { LiveVehicleTelemetry } from '../../types/realtimeFleet';

interface Props {
  vehicle: LiveVehicleTelemetry | null;
  onClose: () => void;
  onCenterMap: (lat: number, lng: number) => void;
}

export function VehicleDetailDrawer({ vehicle, onClose, onCenterMap }: Props) {
  if (!vehicle) return null;

  const getStatusBadge = () => {
    if (vehicle.is_offline || vehicle.shift_status === 'offline') {
      return (
        <span className="status-badge" style={{ background: 'rgba(107, 114, 128, 0.2)', color: '#9ca3af' }}>
          <i className="ri-shut-down-line" /> Aloqada emas / GPS yo'q
        </span>
      );
    }
    if (vehicle.is_stale) {
      return (
        <span className="status-badge" style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}>
          <i className="ri-time-line" /> GPS kechikmoqda (Stale)
        </span>
      );
    }
    if (vehicle.shift_status === 'in_parking') {
      return (
        <span className="status-badge" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}>
          <i className="ri-parking-box-line" /> Stoyankada
        </span>
      );
    }
    return (
      <span className="status-badge" style={{ background: 'var(--success-subtle)', color: 'var(--success)' }}>
        <i className="ri-checkbox-circle-line" /> Yo'nalishda (Faol)
      </span>
    );
  };

  const getTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 5) return 'Hozir';
    if (seconds < 60) return `${seconds} soniya oldin`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} daqiqa oldin`;
  };

  return (
    <>
      <div className="vehicle-drawer-backdrop" onClick={onClose} />
      <div className="vehicle-drawer">
        <div className="vehicle-drawer__header">
          <h2>
            <i className="ri-bus-fill" style={{ color: 'var(--admin-accent)' }} />
            Transport Tafsilotlari
          </h2>
          <button className="modal-close-btn" onClick={onClose}>
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="vehicle-drawer__body">
          {/* Driver profile card */}
          <div className="drawer-driver-card">
            <div className="drawer-driver-avatar">
              {vehicle.driver_name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                {vehicle.driver_name}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                {vehicle.driver_phone}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--admin-accent)', marginTop: '0.2rem' }}>
                {vehicle.uyushma_name}
              </div>
            </div>
          </div>

          {/* Vehicle and Route Info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'var(--surface-sunken)', padding: '1rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                {vehicle.plate_number}
              </span>
              <span className="route-badge-pill" style={{ background: 'var(--admin-accent-subtle)', color: 'var(--admin-accent)', fontWeight: 800 }}>
                № {vehicle.route_number}
              </span>
            </div>

            <div style={{ fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
              Model: <strong style={{ color: 'var(--text-primary)' }}>{vehicle.model}</strong> {vehicle.color && `(${vehicle.color})`}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.4rem', borderTop: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Yo'nalish tomoni:</span>
              <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {vehicle.direction === 'outbound' ? 'Borish' : 'Qaytish'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Holat:</span>
              {getStatusBadge()}
            </div>
          </div>

          {/* Telemetry Tiles */}
          <div className="drawer-telemetry-grid">
            <div className="drawer-telemetry-tile">
              <span className="drawer-telemetry-tile__label">Tezlik</span>
              <span className="drawer-telemetry-tile__val">
                {vehicle.is_offline ? '0' : vehicle.speed_kmh} <small style={{ fontSize: '0.7rem', fontWeight: 'normal' }}>km/h</small>
              </span>
            </div>

            <div className="drawer-telemetry-tile">
              <span className="drawer-telemetry-tile__label">So'nggi aloqa</span>
              <span className="drawer-telemetry-tile__val" style={{ fontSize: '0.85rem' }}>
                {getTimeAgo(vehicle.last_seen)}
              </span>
            </div>

            <div className="drawer-telemetry-tile">
              <span className="drawer-telemetry-tile__label">Yo'nalish burchagi</span>
              <span className="drawer-telemetry-tile__val">
                {vehicle.heading}°
              </span>
            </div>

            <div className="drawer-telemetry-tile">
              <span className="drawer-telemetry-tile__label">GPS koordinata</span>
              <span className="drawer-telemetry-tile__val" style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
                {vehicle.lat.toFixed(4)}, {vehicle.lng.toFixed(4)}
              </span>
            </div>
          </div>

          {/* Stale / Offline Notice */}
          {(vehicle.is_stale || vehicle.is_offline) && (
            <div className="dangerous-action-banner" style={{ background: 'rgba(245, 158, 11, 0.1)', borderColor: '#f59e0b', color: '#fde68a' }}>
              <i className="ri-information-line" style={{ color: '#f59e0b' }} />
              <div>
                <strong>Diqqat:</strong> Ushbu transport vositasi so'nggi 30 soniyadan ortiq vaqt davomida yangi GPS koordinatalarini uzatmadi. Oxirgi ma'lum bo'lgan koordinata saqlanib turibdi.
              </div>
            </div>
          )}
        </div>

        <div className="vehicle-drawer__footer">
          <button
            className="btn-operations-secondary"
            onClick={() => onCenterMap(vehicle.lat, vehicle.lng)}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            <i className="ri-focus-3-line" /> Xaritada Markazlashtirish
          </button>

          <a
            href={`tel:${vehicle.driver_phone.replace(/\s+/g, '')}`}
            className="btn-admin-primary"
            style={{ textDecoration: 'none', justifyContent: 'center' }}
          >
            <i className="ri-phone-fill" /> Haydovchiga Qo'ng'iroq Qilish
          </a>
        </div>
      </div>
    </>
  );
}
