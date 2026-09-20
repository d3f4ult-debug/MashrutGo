import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { formatDateTime, parseUtc, timeAgo } from '../../utils/format'
import type { LiveFleetVehicle } from '../../types/realtimeFleet'
import type { FleetRouteDetails } from '../../hooks/useLiveFleet'
import {
  FLEET_STATUS_ICONS,
  FLEET_STATUS_LABELS,
  directionText,
  formatSpeed,
  lastSeenText,
  shiftDuration,
  telHref,
  vehicleTitle,
} from './fleetUi'

interface Props {
  vehicle: LiveFleetVehicle
  route?: FleetRouteDetails
  now: number
  showTenant: boolean
  /** in-app link to the drivers page of the current portal (tenant scope only) */
  driversLink?: string
  onClose: () => void
  onCenterMap: (lat: number, lng: number) => void
}

export function VehicleDetailDrawer({ vehicle, route, now, showTenant, driversLink, onClose, onCenterMap }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasPosition = vehicle.lat !== null && vehicle.lng !== null
  const isLive = vehicle.status === 'on_route' || vehicle.status === 'in_parking'
  const parkingLabel = vehicle.parking_id ? vehicle.parking_name || `Stoyanka #${vehicle.parking_id}` : null

  return (
    <aside className="vehicle-drawer" role="dialog" aria-modal="false" aria-labelledby="vehicle-drawer-title">
      <div className="vehicle-drawer__header">
        <h2 id="vehicle-drawer-title">
          <i className="ri-bus-fill" style={{ color: 'var(--admin-accent)' }} />
          <span className="fleet-mono">{vehicleTitle(vehicle)}</span>
          <span className="fleet-route-pill">№ {vehicle.route_number || '—'}</span>
        </h2>
        <button type="button" className="fleet-icon-btn" onClick={onClose} aria-label="Yopish">
          <i className="ri-close-line" />
        </button>
      </div>

      <div className="vehicle-drawer__body">
        <div className={`fleet-status-banner fleet-status-banner--${vehicle.status}`}>
          <i className={FLEET_STATUS_ICONS[vehicle.status]} />
          <div>
            <strong>
              {FLEET_STATUS_LABELS[vehicle.status]}
              {vehicle.status === 'in_parking' && parkingLabel ? `: ${parkingLabel}` : ''}
            </strong>
            <div>{lastSeenText(vehicle, now)}</div>
            {vehicle.status === 'awaiting_gps' && (
              <div className="fleet-muted">Haydovchi ilovasi birinchi GPS nuqtani yuborgach xaritada ko‘rinadi.</div>
            )}
            {vehicle.status === 'stale' && (
              <div className="fleet-muted">Xaritada oxirgi ma’lum joyi ko‘rsatilmoqda.</div>
            )}
          </div>
        </div>

        <div className="drawer-driver-card">
          <div className="drawer-driver-avatar">{(vehicle.driver_name || '?').charAt(0).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="fleet-strong">{vehicle.driver_name || '—'}</div>
            {vehicle.driver_phone ? (
              <a className="fleet-link" href={telHref(vehicle.driver_phone)}>
                <i className="ri-phone-line" /> {vehicle.driver_phone}
              </a>
            ) : (
              <div className="fleet-muted">Telefon ko‘rsatilmagan</div>
            )}
            {showTenant && <div className="fleet-muted" style={{ color: 'var(--admin-accent)' }}>{vehicle.uyushma_name}</div>}
          </div>
        </div>

        <dl className="fleet-facts">
          <div>
            <dt>Davlat raqami</dt>
            <dd className="fleet-mono">{vehicle.plate_number || '—'}</dd>
          </div>
          <div>
            <dt>Ichki ID</dt>
            <dd className="fleet-mono">{vehicle.vehicle_id}</dd>
          </div>
          {(vehicle.model || vehicle.color) && (
            <div>
              <dt>Model</dt>
              <dd>{[vehicle.model, vehicle.color].filter(Boolean).join(', ')}</dd>
            </div>
          )}
          <div>
            <dt>Yo‘nalish</dt>
            <dd>
              № {vehicle.route_number}
              {route?.route_name || vehicle.route_name ? ` — ${route?.route_name || vehicle.route_name}` : ''}
            </dd>
          </div>
          <div>
            <dt>Yo‘nalish tomoni</dt>
            <dd>{directionText(vehicle, route)}</dd>
          </div>
          <div>
            <dt>Stoyanka</dt>
            <dd>{parkingLabel ?? '—'}</dd>
          </div>
        </dl>

        <div className="drawer-telemetry-grid">
          <div className="drawer-telemetry-tile">
            <span className="drawer-telemetry-tile__label">{isLive ? 'Tezlik' : 'Oxirgi tezlik'}</span>
            <span className="drawer-telemetry-tile__val">{vehicle.has_fix ? formatSpeed(vehicle.speed_kmh) : '—'}</span>
          </div>
          <div className="drawer-telemetry-tile">
            <span className="drawer-telemetry-tile__label">Oxirgi GPS</span>
            <span className="drawer-telemetry-tile__val fleet-tile-small">
              {vehicle.last_seen ? timeAgo(vehicle.last_seen, now) : 'Signal yo‘q'}
            </span>
            {vehicle.last_seen && <span className="fleet-muted">{formatDateTime(vehicle.last_seen)}</span>}
          </div>
          <div className="drawer-telemetry-tile">
            <span className="drawer-telemetry-tile__label">Smena boshlangan</span>
            <span className="drawer-telemetry-tile__val fleet-tile-small">{formatDateTime(vehicle.shift_started_at)}</span>
            <span className="fleet-muted">{shiftDuration(vehicle.shift_started_at, now, parseUtc)} davomida</span>
          </div>
          <div className="drawer-telemetry-tile">
            <span className="drawer-telemetry-tile__label">Koordinata</span>
            <span className="drawer-telemetry-tile__val fleet-tile-small fleet-mono">
              {hasPosition ? `${vehicle.lat!.toFixed(5)}, ${vehicle.lng!.toFixed(5)}` : '—'}
            </span>
            {hasPosition && <span className="fleet-muted">Yo‘nalish burchagi {Math.round(vehicle.heading)}°</span>}
          </div>
        </div>
      </div>

      <div className="vehicle-drawer__footer">
        <button
          type="button"
          className="fleet-btn"
          onClick={() => hasPosition && onCenterMap(vehicle.lat!, vehicle.lng!)}
          disabled={!hasPosition}
        >
          <i className="ri-focus-3-line" /> {hasPosition ? 'Xaritada ko‘rsatish' : 'Joylashuv hali yo‘q'}
        </button>
        {vehicle.driver_phone && (
          <a href={telHref(vehicle.driver_phone)} className="fleet-btn fleet-btn--primary">
            <i className="ri-phone-fill" /> Haydovchiga qo‘ng‘iroq
          </a>
        )}
        {driversLink && (
          <Link to={driversLink} className="fleet-link" style={{ textAlign: 'center', fontSize: '0.8rem' }}>
            Haydovchilar ro‘yxatiga o‘tish
          </Link>
        )}
      </div>
    </aside>
  )
}
