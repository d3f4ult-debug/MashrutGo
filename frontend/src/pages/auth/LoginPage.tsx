import { useState, type FormEvent } from 'react'
import { Navigate, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { errorMessage } from '../../services/api/client'
import { ROLE_HOME } from '../../types/auth'
import './LoginPage.css'

/**
 * Staff login (driver, Uyushma, Super Admin) with phone + password against /auth/login.
 * There is no offline/demo bypass: a failed login never grants access.
 */
export function LoginPage() {
  const { login, isAuthenticated, user } = useAuth()
  const location = useLocation()

  const [phone, setPhone] = useState('+998 ')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (isAuthenticated && user) {
    // Return to the page that required login only if it belongs to this role's area
    const from = (location.state as { from?: { pathname: string } })?.from?.pathname
    const home = ROLE_HOME[user.role]
    const target = from && home !== '/' && from.startsWith(home) ? from : home
    return <Navigate to={target} replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login({ phone, password })
    } catch (err) {
      setError(errorMessage(err, 'Kirishda xatolik'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-brand">
          <div className="login-brand__logo">
            <i className="ri-bus-2-fill" />
          </div>
          <h1>MashrutGo</h1>
          <p>Haydovchi, Uyushma va Admin paneli</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-form__field">
            <label htmlFor="login-phone">Telefon raqami</label>
            <div className="login-form__input-wrap">
              <i className="ri-phone-line" />
              <input
                id="login-phone"
                type="tel"
                placeholder="+998 90 123 45 67"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoComplete="username"
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
            <div className="login-form__error" role="alert">
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

        <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
          Haydovchi akkauntlarini Uyushma yaratadi. Parolni unutgan bo‘lsangiz, dispetcherga murojaat qiling.
        </p>

        <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          <Link to="/" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
            <i className="ri-arrow-left-line" /> Yo‘lovchilar ilovasiga qaytish
          </Link>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
