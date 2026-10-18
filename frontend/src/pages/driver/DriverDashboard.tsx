import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API_BASE } from '../../services/api/client';
import './DriverDashboard.css';

/**
 * Driver Dashboard — displays real-time shift controls or pending verification notice.
 */
export function DriverDashboard() {
  const { user } = useAuth();
  const [checking, setChecking] = useState(false);
  const [isVerified, setIsVerified] = useState<boolean>(() => {
    return user?.is_verified ?? true;
  });

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setIsVerified(Boolean(data.is_verified));
      }
    } catch {
      // Keep state
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  if (!isVerified) {
    return (
      <div className="driver-dashboard" style={{ padding: '1.5rem', textAlign: 'center' }}>
        <div
          style={{
            background: 'var(--bg-surface, #ffffff)',
            borderRadius: '16px',
            padding: '2.5rem 1.5rem',
            boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
            maxWidth: '480px',
            margin: '2rem auto',
            border: '1px solid var(--border-color, #e2e8f0)',
          }}
        >
          <div
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              background: 'rgba(234, 179, 8, 0.15)',
              color: '#ca8a04',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
              margin: '0 auto 1.5rem',
            }}
          >
            <i className="ri-time-line" />
          </div>

          <h2 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
            Uyushma tasdiqlashi kutilmoqda
          </h2>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5', marginBottom: '1.5rem' }}>
            Hurmatli <strong>{user?.full_name || 'Haydovchi'}</strong>, sizning ro'yxatdan o'tish arizangiz tanlangan Uyushmaga yuborildi. Uyushma arizangiz va transport vositangiz ma'lumotlarini tekshirib tasdiqlagach, marshrut va smenalarga kirish huquqiga ega bo'lasiz.
          </p>

          <div
            style={{
              background: 'var(--bg-subtle, #f8fafc)',
              borderRadius: '10px',
              padding: '1rem',
              textAlign: 'left',
              fontSize: '0.85rem',
              marginBottom: '1.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Telefon:</span>
              <span style={{ fontWeight: 600 }}>{user?.phone}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Holat:</span>
              <span style={{ color: '#ca8a04', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <i className="ri-loader-2-line ri-spin" /> Ko'rib chiqilmoqda
              </span>
            </div>
          </div>

          <button
            onClick={checkStatus}
            disabled={checking}
            style={{
              width: '100%',
              padding: '0.875rem',
              borderRadius: '10px',
              background: 'var(--accent-primary, #2563eb)',
              color: '#ffffff',
              border: 'none',
              fontWeight: 600,
              fontSize: '0.95rem',
              cursor: checking ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
            }}
          >
            {checking ? (
              <>
                <i className="ri-loader-4-line ri-spin" /> Tekshirilmoqda...
              </>
            ) : (
              <>
                <i className="ri-refresh-line" /> Statusni yangilash
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

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
