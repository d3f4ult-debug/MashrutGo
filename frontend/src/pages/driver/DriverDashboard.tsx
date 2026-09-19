import './DriverDashboard.css';

/**
 * Driver Dashboard — Stage 0 placeholder.
 * Will be expanded in Stage 1 with shift controls, GPS status, etc.
 */
export function DriverDashboard() {
  return (
    <div className="driver-dashboard">
      <div className="dashboard-welcome">
        <div className="dashboard-welcome__icon">
          <i className="ri-steering-2-fill" />
        </div>
        <h1>Haydovchi paneli</h1>
        <p>Smena, GPS va to'lovlarni boshqarish uchun tayyor.</p>
      </div>

      <div className="dashboard-cards">
        <div className="dashboard-card">
          <div className="dashboard-card__icon" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>
            <i className="ri-play-circle-line" />
          </div>
          <div className="dashboard-card__content">
            <span className="dashboard-card__label">Smena holati</span>
            <span className="dashboard-card__value">Faol emas</span>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="dashboard-card__icon" style={{ background: 'var(--success-subtle)', color: 'var(--success)' }}>
            <i className="ri-gps-line" />
          </div>
          <div className="dashboard-card__content">
            <span className="dashboard-card__label">GPS holati</span>
            <span className="dashboard-card__value">—</span>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="dashboard-card__icon" style={{ background: 'var(--warning-subtle)', color: 'var(--warning)' }}>
            <i className="ri-route-line" />
          </div>
          <div className="dashboard-card__content">
            <span className="dashboard-card__label">Yo'nalish</span>
            <span className="dashboard-card__value">Tayinlanmagan</span>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="dashboard-card__icon" style={{ background: 'var(--info-subtle)', color: 'var(--info)' }}>
            <i className="ri-wifi-line" />
          </div>
          <div className="dashboard-card__content">
            <span className="dashboard-card__label">Aloqa</span>
            <span className="dashboard-card__value">Online</span>
          </div>
        </div>
      </div>
    </div>
  );
}
