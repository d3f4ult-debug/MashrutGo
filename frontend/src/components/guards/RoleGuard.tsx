import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import type { UserRole } from '../../types/auth';

interface RoleGuardProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

/**
 * Route guard that checks authentication and role authorization.
 * Redirects to /login if not authenticated.
 * Redirects to the user's home if role is not allowed.
 */
export function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Yuklanmoqda...</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const isSuperOrAdmin = user.role === 'super_admin' || user.role === 'admin';
  const hasAllowedRole = isSuperOrAdmin || allowedRoles.includes(user.role);

  if (!hasAllowedRole) {
    // Redirect to the user's own home based on role
    const roleHome: Record<string, string> = {
      driver: '/driver',
      uyushma: '/uyushma',
      uyushma_admin: '/uyushma',
      admin: '/admin',
      super_admin: '/admin',
      client: '/',
    };
    return <Navigate to={roleHome[user.role] || '/'} replace />;
  }

  return <>{children}</>;

}
