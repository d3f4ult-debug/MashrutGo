import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import type { UserRole } from '../../types/auth';
import './LoginPage.css';

/**
 * Unified login page for all roles.
 * Dev mode: allows selecting role and mock-login without backend.
 * Production mode: calls Dev1 /auth/login endpoint.
 */
export function LoginPage() {
  const { login, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If already authenticated, redirect to role home
  if (isAuthenticated && user) {
    const roleHome: Record<UserRole, string> = {
      driver: '/driver',
      uyushma: '/uyushma',
      admin: '/admin',
    };
    const from = (location.state as { from?: { pathname: string } })?.from?.pathname || roleHome[user.role];
    navigate(from, { replace: true });
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({ email, password });
      // After login, AuthContext updates and the redirect above handles navigation
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login xatosi');
    } finally {
      setLoading(false);
    }
  };

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

  const isDev = import.meta.env.DEV;

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

        {/* Dev mode quick access */}
        {isDev && (
          <div className="login-dev-panel">
            <span className="login-dev-panel__label">Dev tezkor kirish:</span>
            <div className="login-dev-panel__buttons">
              <button onClick={() => devLogin('driver')} className="login-dev-btn login-dev-btn--driver">
                <i className="ri-steering-2-line" /> Haydovchi
              </button>
              <button onClick={() => devLogin('uyushma')} className="login-dev-btn login-dev-btn--uyushma">
                <i className="ri-building-2-line" /> Uyushma
              </button>
              <button onClick={() => devLogin('admin')} className="login-dev-btn login-dev-btn--admin">
                <i className="ri-shield-star-line" /> Admin
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
