import React from 'react'
import { useAuth } from '@/services/auth/AuthProvider'

export default function RoleGuard({ role, children }: { role: string; children: JSX.Element }) {
  const { hasRole } = useAuth()
  if (!hasRole(role)) return <div className="p-3 bg-yellow-50">Access denied</div>
  return children
}
