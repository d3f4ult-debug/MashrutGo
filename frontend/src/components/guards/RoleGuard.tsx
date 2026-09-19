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

  if (!allowedRoles.includes(user.role)) {
    // Redirect to the user's own home based on role
    const roleHome: Record<UserRole, string> = {
      driver: '/driver',
      uyushma: '/uyushma',
      admin: '/admin',
    };
    return <Navigate to={roleHome[user.role]} replace />;
  }

  return <>{children}</>;
}
