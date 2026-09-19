import React from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/services/auth/AuthProvider'

export default function HeaderAuthControls() {
  const { user, signout } = useAuth()
  if (!user)
    return (
      <div>
        <Link to="/signin" className="text-blue-600">
          Sign in
        </Link>
      </div>
    )
  return (
    <div className="flex items-center gap-3">
      <div className="text-sm">{user.name}</div>
      <button onClick={signout} className="text-sm text-red-600">
        Sign out
      </button>
    </div>
  )
}
