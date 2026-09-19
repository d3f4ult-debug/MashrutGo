import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './UyushmaLayout.css';

/**
 * Desktop-first layout for Uyushma (Organization) role.
 * Sidebar navigation with collapsible state.
 * Responsive: collapses to bottom bar on mobile.
 */
export function UyushmaLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { to: '/uyushma', icon: 'ri-dashboard-3-line', label: 'Dashboard', end: true },
    { to: '/uyushma/routes', icon: 'ri-route-line', label: 'Yo\'nalishlar', end: false },
    { to: '/uyushma/drivers', icon: 'ri-steering-2-line', label: 'Haydovchilar', end: false },
    { to: '/uyushma/vehicles', icon: 'ri-bus-2-line', label: 'Transportlar', end: false },
    { to: '/uyushma/parkings', icon: 'ri-parking-box-line', label: 'Stoyankalar', end: false },
    { to: '/uyushma/fares', icon: 'ri-money-dollar-circle-line', label: 'Tariflar', end: false },
    { to: '/uyushma/payments', icon: 'ri-wallet-3-line', label: 'To\'lovlar', end: false },
    { to: '/uyushma/map', icon: 'ri-map-2-line', label: 'Live Xarita', end: false },
  ];

  return (
    <div className="uyushma-layout">
      {/* Desktop sidebar */}
      <aside className="uyushma-sidebar">
        <div className="uyushma-sidebar__brand">
          <i className="ri-building-2-fill" />
          <span>MashrutGo</span>
          <small>Uyushma</small>
        </div>

        <nav className="uyushma-sidebar__nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `uyushma-nav-link ${isActive ? 'active' : ''}`}
            >
              <i className={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="uyushma-sidebar__footer">
          <div className="uyushma-sidebar__user">
            <div className="uyushma-sidebar__avatar">
              <i className="ri-user-3-fill" />
            </div>
            <div className="uyushma-sidebar__user-info">
              <span className="uyushma-sidebar__user-name">{user?.full_name}</span>
              <span className="uyushma-sidebar__user-role">Uyushma</span>
            </div>
          </div>
          <button className="uyushma-sidebar__logout" onClick={handleLogout} title="Chiqish">
            <i className="ri-logout-box-r-line" />
            <span>Chiqish</span>
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="uyushma-mobile-header">
        <div className="uyushma-mobile-header__brand">
          <i className="ri-building-2-fill" />
          <span>MashrutGo</span>
        </div>
        <button className="uyushma-mobile-header__logout" onClick={handleLogout}>
          <i className="ri-logout-box-r-line" />
        </button>
      </header>

      {/* Main content */}
      <main className="uyushma-main">
        <Outlet />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="uyushma-mobile-nav">
        {navItems.slice(0, 5).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `uyushma-mobile-nav-item ${isActive ? 'active' : ''}`}
          >
            <i className={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
