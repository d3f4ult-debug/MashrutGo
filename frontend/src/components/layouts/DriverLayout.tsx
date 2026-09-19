import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import './DriverLayout.css'

/**
 * Mobile-first layout for Driver role.
 * Bottom navigation bar (iOS/Android native feel).
 * Top status bar with connection info.
 */
export function DriverLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="driver-layout">
      {/* Top status bar */}
      <header className="driver-header">
        <div className="driver-header__brand">
          <i className="ri-steering-2-fill" />
          <span>MashrutGo</span>
        </div>
        <div className="driver-header__user">
          <span className="driver-header__name">{user?.full_name}</span>
          <button className="driver-header__logout" onClick={handleLogout} title="Chiqish">
            <i className="ri-logout-box-r-line" />
          </button>
        </div>
      </header>

      {/* Main content area */}
      <main className="driver-main">
        <Outlet />
      </main>

      {/* Bottom navigation — mobile native feel */}
      <nav className="driver-bottom-nav">
        <NavLink to="/driver" end className={({ isActive }) => `driver-nav-item ${isActive ? 'active' : ''}`}>
          <i className="ri-dashboard-3-line" />
          <span>Dashboard</span>
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
