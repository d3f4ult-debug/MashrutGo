import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { AuthUser, AuthState, LoginCredentials, UserRole } from '../types/auth';
import { apiClient } from '../services/api/client';

interface AuthContextType extends AuthState {
  login: (creds: LoginCredentials) => Promise<void>;
  logout: () => void;
  hasRole: (role: UserRole | UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
  });

  // Restore session from localStorage on mount
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const userStr = localStorage.getItem(USER_KEY);
    if (token && userStr) {
      try {
        const user: AuthUser = JSON.parse(userStr);
        setState({ user, token, isAuthenticated: true, isLoading: false });
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setState(prev => ({ ...prev, isLoading: false }));
      }
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  const login = useCallback(async (creds: LoginCredentials) => {
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      // Dev1 backend contract: POST /auth/login
      const data = await apiClient.post<{ access_token: string; user: AuthUser }>(
        '/auth/login',
        creds
      );
      localStorage.setItem(TOKEN_KEY, data.access_token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setState({
        user: data.user,
        token: data.access_token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      setState(prev => ({ ...prev, isLoading: false }));
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setState({ user: null, token: null, isAuthenticated: false, isLoading: false });
  }, []);

  const hasRole = useCallback(
    (role: UserRole | UserRole[]) => {
      if (!state.user) return false;
      if (Array.isArray(role)) return role.includes(state.user.role);
      return state.user.role === role;
    },
    [state.user]
  );

  return (
    <AuthContext.Provider value={{ ...state, login, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
