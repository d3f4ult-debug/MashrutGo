// Auth types — shared across all role UIs
export type UserRole = 'driver' | 'uyushma' | 'admin' | 'super_admin' | 'uyushma_admin' | 'client';

export interface AuthUser {
  id: string | number;
  phone?: string;
  email?: string;
  full_name: string;
  role: UserRole;
  uyushma_id?: string | number;    // only for uyushma/driver
  vehicle_id?: string | number;    // only for driver
  route_id?: string | number;      // only for driver
  is_verified?: boolean;
}

export interface LoginCredentials {
  phone: string;
  password: string;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

