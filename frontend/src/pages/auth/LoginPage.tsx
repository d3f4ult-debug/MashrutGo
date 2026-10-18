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

  const [identifier, setIdentifier] = useState('Admin');
  const [password, setPassword] = useState('Adminkeldi1');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If already authenticated, redirect to role home cleanly using <Navigate />
  if (isAuthenticated && user) {
    const roleHome: Record<string, string> = {
      driver: '/driver',
      uyushma: '/uyushma',
      uyushma_admin: '/uyushma',
      admin: '/admin',
      super_admin: '/admin',
      client: '/',
    };
    const from = (location.state as { from?: { pathname: string } })?.from?.pathname || roleHome[user.role] || '/';
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const val = identifier.trim();
    const formattedLogin = val.toLowerCase() === 'admin' ? 'Admin' : (val.startsWith('+') ? val : `+${val}`);

    try {
      await login({ phone: formattedLogin, password });
    } catch (err: any) {
      const msg = err?.message || 'Login yoki parol noto‘g‘ri kiritildi';
      setError(msg);
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
            <i className="ri-shield-keyhole-fill" />
          </div>
          <h1>MashrutGo</h1>
          <p>Super Admin boshqaruv tizimi</p>
        </div>

        {/* Login form */}
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-form__field">
            <label htmlFor="login-identifier">Foydalanuvchi nomi / Login</label>
            <div className="login-form__input-wrap">
              <i className="ri-user-star-line" />
              <input
                id="login-identifier"
                type="text"
                placeholder="Admin"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
          </div>

          <div className="login-form__field">
            <label htmlFor="login-password">Admin Paroli</label>
            <div className="login-form__input-wrap">
              <i className="ri-lock-2-line" />
              <input
                id="login-password"
                type="password"
                placeholder="Adminkeldi1"
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
              'Tizimga kirish'
            )}
          </button>
        </form>

        {/* Back to Client PWA & Role Selector */}
        <div style={{ textAlign: 'center', marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Link to="/" style={{ fontSize: '0.85rem', color: 'var(--accent-primary, #2563eb)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem' }}>
            <i className="ri-user-shared-line" /> Yo‘lovchi yoki Haydovchi sifatida kirish
          </Link>
          <Link to="/" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem' }}>
            <i className="ri-arrow-left-line" /> Bosh sahifaga qaytish
          </Link>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;

