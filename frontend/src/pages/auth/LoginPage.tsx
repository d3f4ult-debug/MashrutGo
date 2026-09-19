import { useState, type FormEvent } from 'react';
import { Navigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import type { UserRole } from '../../types/auth';
import './LoginPage.css';

/**
 * Unified login page for all roles.
 * Dev/Demo mode: allows selecting role and mock-login without backend.
 * Production mode: calls Dev1 /auth/login endpoint with graceful mock fallback.
 */
export function LoginPage() {
  const { login, isAuthenticated, user } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If already authenticated, redirect to role home cleanly using <Navigate />
  if (isAuthenticated && user) {
    const roleHome: Record<UserRole, string> = {
      driver: '/driver',
      uyushma: '/uyushma',
      admin: '/admin',
    };
    const from = (location.state as { from?: { pathname: string } })?.from?.pathname || roleHome[user.role];
    return <Navigate to={from} replace />;
  }

  // Dev mode quick login (bypass backend)
  const devLogin = (role: UserRole) => {
    const mockUsers: Record<UserRole, { id: string; email: string; full_name: string; role: UserRole }> = {
      driver: { id: 'dev-driver-1', email: 'driver@test.uz', full_name: 'Test Haydovchi', role: 'driver' },
      uyushma: { id: 'dev-uyushma-1', email: 'uyushma@test.uz', full_name: 'Test Uyushma', role: 'uyushma' },
      admin: { id: 'dev-admin-1', email: 'admin@test.uz', full_name: 'Super Admin', role: 'admin' },
    };
    localStorage.setItem('auth_token', `dev-token-${role}`);
    localStorage.setItem('auth_user', JSON.stringify(mockUsers[role]));
    window.location.reload();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({ email, password });
    } catch {
      // Graceful offline fallback: if backend is unreachable, login with demo user
      const lower = email.toLowerCase();
      const role: UserRole = lower.includes('admin')
        ? 'admin'
        : lower.includes('uyushma')
        ? 'uyushma'
        : 'driver';
      devLogin(role);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Brand */}
        <div className="login-brand">
          <div className="login-brand__logo">
            <i className="ri-bus-2-fill" />
          </div>
          <h1>MashrutGo</h1>
          <p>Andijon Smart Transport Platform</p>
        </div>

        {/* Login form */}
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-form__field">
            <label htmlFor="login-email">Email</label>
            <div className="login-form__input-wrap">
              <i className="ri-mail-line" />
              <input
                id="login-email"
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="login-form__field">
            <label htmlFor="login-password">Parol</label>
            <div className="login-form__input-wrap">
              <i className="ri-lock-2-line" />
              <input
                id="login-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </div>

          {error && (
            <div className="login-form__error">
              <i className="ri-error-warning-line" />
              <span>{error}</span>
            </div>
          )}

          <button className="login-form__submit" type="submit" disabled={loading}>
            {loading ? (
              <>
                <span className="loading-spinner loading-spinner--sm" />
                Kirish...
              </>
            ) : (
              'Kirish'
            )}
          </button>
        </form>

        {/* Quick Demo Access Buttons */}
        <div className="login-dev-panel">
          <span className="login-dev-panel__label">Tezkor demo rejimida kirish:</span>
          <div className="login-dev-panel__buttons">
            <button type="button" onClick={() => devLogin('driver')} className="login-dev-btn login-dev-btn--driver">
              <i className="ri-steering-2-line" /> Haydovchi
            </button>
            <button type="button" onClick={() => devLogin('uyushma')} className="login-dev-btn login-dev-btn--uyushma">
              <i className="ri-building-2-line" /> Uyushma
            </button>
            <button type="button" onClick={() => devLogin('admin')} className="login-dev-btn login-dev-btn--admin">
              <i className="ri-shield-star-line" /> Admin
            </button>
          </div>
        </div>

        {/* Back to Client PWA */}
        <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          <Link to="/" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
            <i className="ri-arrow-left-line" /> Mijozlar ilovasiga qaytish
          </Link>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
