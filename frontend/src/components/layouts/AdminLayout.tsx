import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import './AdminLayout.css'

/**
 * Desktop-first layout for Super Admin role.
 * Similar to Uyushma but with wider sidebar and admin-specific styling.
 */
export function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const navItems = [
    { to: '/admin', icon: 'ri-dashboard-3-line', label: 'Dashboard', end: true },
    { to: '/admin/uyushmalar', icon: 'ri-building-2-line', label: 'Uyushmalar', end: false },
    { to: '/admin/routes', icon: 'ri-route-line', label: "Yo'nalishlar", end: false },
    { to: '/admin/drivers', icon: 'ri-steering-2-line', label: 'Haydovchilar', end: false },
    { to: '/admin/vehicles', icon: 'ri-bus-2-line', label: 'Transportlar', end: false },
    { to: '/admin/clients', icon: 'ri-group-line', label: 'Clientlar', end: false },
    { to: '/admin/parkings', icon: 'ri-parking-box-line', label: 'Stoyankalar', end: false },
    { to: '/admin/payments', icon: 'ri-wallet-3-line', label: "To'lovlar", end: false },
    { to: '/admin/shifts', icon: 'ri-radar-line', label: 'Jonli Smenalar', end: false },
    { to: '/admin/map', icon: 'ri-map-2-line', label: 'Live Xarita', end: false },
    { to: '/admin/settings', icon: 'ri-settings-4-line', label: 'Sozlamalar', end: false },
    { to: '/admin/audit', icon: 'ri-file-list-3-line', label: 'Audit Log', end: false }
  ]

  return (
    <div className="admin-layout">
      {/* Desktop sidebar */}
      <aside className="admin-sidebar">
        <Link to="/" className="admin-sidebar__brand" title="Mijozlar ilovasiga qaytish">
          <i className="ri-shield-star-fill" />
          <span>MashrutGo</span>
          <small>Admin</small>
        </Link>

        <nav className="admin-sidebar__nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}
            >
              <i className={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar__footer">
          <div className="admin-sidebar__user">
            <div className="admin-sidebar__avatar">
              <i className="ri-shield-user-fill" />
            </div>
            <div className="admin-sidebar__user-info">
              <span className="admin-sidebar__user-name">{user?.full_name}</span>
              <span className="admin-sidebar__user-role">Super Admin</span>
            </div>
          </div>
          <button className="admin-sidebar__logout" onClick={handleLogout} title="Chiqish">
            <i className="ri-logout-box-r-line" />
            <span>Chiqish</span>
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="admin-mobile-header">
        <div className="admin-mobile-header__brand">
          <i className="ri-shield-star-fill" />
          <span>MashrutGo Admin</span>
        </div>
        <button className="admin-mobile-header__logout" onClick={handleLogout}>
          <i className="ri-logout-box-r-line" />
        </button>
      </header>

      {/* Main content */}
      <main className="admin-main">
        <Outlet />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="admin-mobile-nav">
        {navItems.slice(0, 5).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `admin-mobile-nav-item ${isActive ? 'active' : ''}`}
          >
            <i className={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default AdminLayout
