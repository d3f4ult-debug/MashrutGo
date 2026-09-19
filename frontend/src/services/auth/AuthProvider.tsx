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
  const [user, setUser] = useState<User>(null)

  function signin(u: User) {
    setUser(u)
  }
  function signout() {
    setUser(null)
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
