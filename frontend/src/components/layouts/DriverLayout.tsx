import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { DriverSessionProvider, useDriverSession } from '../../contexts/DriverSessionContext'
import { NotificationsBell } from '../driver/NotificationsBell'
import './DriverLayout.css'

/**
 * Mobile-first layout for the Driver role.
 * The driver session (shift, GPS transmission, realtime channel) lives here so it keeps running
 * while the driver moves between pages.
 */
export function DriverLayout() {
  return (
    <DriverSessionProvider>
      <DriverShell />
    </DriverSessionProvider>
  )
}

function StatusDots() {
  const { shift, gps, wsState } = useDriverSession()
  const gpsTone = !shift ? 'idle' : gps.permission === 'denied' || gps.lastError ? 'bad' : gps.queued > 0 || !gps.online ? 'warn' : 'ok'
  const gpsTitle = !shift
    ? 'Smena faol emas — GPS yuborilmaydi'
    : gps.lastError ?? (gps.queued > 0 ? `${gps.queued} ta GPS nuqta navbatda` : 'GPS yuborilmoqda')
  const wsTone = wsState === 'connected' ? 'ok' : wsState === 'disconnected' ? 'bad' : 'warn'
  return (
    <div className="driver-header__status" aria-label="Aloqa holati">
      <span className={`driver-status-dot driver-status-dot--${gpsTone}`} title={gpsTitle}>
        <i className="ri-gps-line" />
      </span>
      <span className={`driver-status-dot driver-status-dot--${wsTone}`} title={`Real-time: ${wsState}`}>
        <i className="ri-broadcast-line" />
      </span>
    </div>
  )
}

function DriverShell() {
  const { user, logout } = useAuth()
  const { shift, notice, dismissNotice } = useDriverSession()
  const navigate = useNavigate()

  const handleLogout = () => {
    if (
      shift &&
      !window.confirm('Smena hali faol. Chiqsangiz GPS yuborilishi to‘xtaydi va transportingiz xaritada ko‘rinmay qoladi. Baribir chiqasizmi?')
    ) {
      return
    }
    logout()
    navigate('/login')
  }

  return (
    <div className="driver-layout">
      <header className="driver-header">
        <Link to="/" className="driver-header__brand" title="Mijozlar ilovasiga qaytish">
          <i className="ri-steering-2-fill" />
          <span>MashrutGo</span>
        </Link>
        <div className="driver-header__user">
          <StatusDots />
          <NotificationsBell />
          <span className="driver-header__name">{user?.full_name}</span>
          <button className="driver-header__logout" onClick={handleLogout} title="Chiqish" aria-label="Chiqish">
            <i className="ri-logout-box-r-line" />
          </button>
        </div>
      </header>

      {notice && (
        <div className="driver-notice" role="alert">
          <i className="ri-error-warning-fill" />
          <span>{notice}</span>
          <button onClick={dismissNotice} aria-label="Yopish">
            <i className="ri-close-line" />
          </button>
        </div>
      )}

      <main className="driver-main">
        <Outlet />
      </main>

      <nav className="driver-bottom-nav">
        <NavLink to="/driver" end className={({ isActive }) => `driver-nav-item ${isActive ? 'active' : ''}`}>
          <i className="ri-dashboard-3-line" />
          <span>Smena</span>
        </NavLink>
        <NavLink to="/driver/map" className={({ isActive }) => `driver-nav-item ${isActive ? 'active' : ''}`}>
          <i className="ri-map-2-line" />
          <span>Xarita</span>
        </NavLink>
        <NavLink to="/driver/payments" className={({ isActive }) => `driver-nav-item ${isActive ? 'active' : ''}`}>
          <i className="ri-wallet-3-line" />
          <span>To'lovlar</span>
        </NavLink>
        <NavLink to="/driver/profile" className={({ isActive }) => `driver-nav-item ${isActive ? 'active' : ''}`}>
          <i className="ri-user-3-line" />
          <span>Profil</span>
        </NavLink>
      </nav>
    </div>
  )
}

export default DriverLayout
