import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/services/auth/AuthProvider'

export default function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/" replace />
  return children
}
