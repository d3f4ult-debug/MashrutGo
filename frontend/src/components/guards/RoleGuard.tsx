import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { ROLE_HOME, type UserRole } from '../../types/auth'

interface RoleGuardProps {
  allowedRoles: UserRole[]
  children: React.ReactNode
}

/**
 * Route guard: unauthenticated users go to /login, users of another role go to their own home.
 * The backend enforces the same rules on every API call (this guard is UX only).
 */
export function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const { isAuthenticated, isLoading, user } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Yuklanmoqda...</p>
      </div>
    )
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={ROLE_HOME[user.role]} replace />
  }

  return <>{children}</>
}
