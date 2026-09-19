// Auth types — shared across all role UIs
export type UserRole = 'driver' | 'uyushma' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  uyushma_id?: string;    // only for uyushma/driver
  vehicle_id?: string;    // only for driver
  route_id?: string;      // only for driver
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
