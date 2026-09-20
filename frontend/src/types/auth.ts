// Auth types — shared across all role UIs.
// Frontend role names map 1:1 to backend roles (see mapBackendRole).
export type UserRole = 'client' | 'driver' | 'uyushma' | 'admin'
export type BackendRole = 'client' | 'driver' | 'uyushma_admin' | 'super_admin'

export interface AuthUser {
  id: number
  phone: string
  full_name: string
  email?: string | null
  role: UserRole
  backend_role: BackendRole
  uyushma_id?: number | null
  uyushma_name?: string | null
  driver_id?: number | null
  vehicle_id?: number | null
  vehicle_internal_id?: string | null
  route_id?: number | null
}

export interface LoginCredentials {
  phone: string
  password: string
}

export interface RegisterPayload {
  phone: string
  password: string
  full_name: string
}

export interface AuthState {
  user: AuthUser | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
}

export const ROLE_HOME: Record<UserRole, string> = {
  client: '/',
  driver: '/driver',
  uyushma: '/uyushma',
  admin: '/admin',
}

export function mapBackendRole(role: string): UserRole {
  switch (role) {
    case 'super_admin':
      return 'admin'
    case 'uyushma_admin':
      return 'uyushma'
    case 'driver':
      return 'driver'
    default:
      return 'client'
  }
}
