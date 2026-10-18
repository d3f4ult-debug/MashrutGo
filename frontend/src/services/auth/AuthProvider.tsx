import React, { createContext, useContext, useState, ReactNode } from 'react'

type User = { id: string; name: string; roles?: string[] } | null

type AuthContextValue = {
  user: User
  signin: (user: User) => void
  signout: () => void
  hasRole: (role: string) => boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User>(() => {
    try {
      const stored = localStorage.getItem('auth_user')
      if (stored) {
        const parsed = JSON.parse(stored)
        return {
          id: String(parsed.id),
          name: parsed.full_name || parsed.name || 'Yo‘lovchi',
          roles: [parsed.role || 'client'],
        }
      }
    } catch {}
    return null
  })

  function signin(u: User) {
    setUser(u)
  }
  function signout() {
    setUser(null)
    localStorage.removeItem('auth_user')
    localStorage.removeItem('auth_token')
  }
  function hasRole(role: string) {
    if (!user) return false
    return !!user.roles?.includes(role)
  }

  return (
    <AuthContext.Provider value={{ user, signin, signout, hasRole }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
