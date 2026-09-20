import { useState } from 'react'
import { Link } from 'react-router-dom'
import AuthModal from './AuthModal'
import { useAuth } from '@/contexts/AuthContext'
import { ROLE_HOME } from '@/types/auth'

export default function HeaderAuthControls() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)

  if (!user) {
    return (
      <>
        <button onClick={() => setOpen(true)} className="text-sm font-semibold text-blue-600 hover:text-blue-800">
          Kirish
        </button>
        <AuthModal isOpen={open} onClose={() => setOpen(false)} />
      </>
    )
  }

  return (
    <div className="flex items-center gap-3">
      {user.role !== 'client' && (
        <Link to={ROLE_HOME[user.role]} className="text-xs font-semibold px-2 py-1 rounded bg-neutral-100 hover:bg-blue-50 hover:text-blue-700">
          Mening panelim
        </Link>
      )}
      <div className="text-sm font-medium text-neutral-800 max-w-[140px] truncate" title={user.full_name}>
        {user.full_name}
      </div>
      <button onClick={logout} className="text-sm text-red-600 hover:text-red-700" aria-label="Chiqish">
        <i className="ri-logout-box-r-line"></i>
      </button>
    </div>
  )
}
