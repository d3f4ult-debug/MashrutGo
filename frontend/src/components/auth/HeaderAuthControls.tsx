import { useState } from 'react'
import { useAuth } from '@/services/auth/AuthProvider'
import { WelcomeRoleModal } from './WelcomeRoleModal'

export default function HeaderAuthControls() {
  const { user, signout } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)

  const handleSignOut = () => {
    signout()
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
    window.location.reload()
  }

  if (!user) {
    return (
      <>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors shadow-xs"
        >
          <i className="ri-user-line" />
          Kirish
        </button>
        <WelcomeRoleModal isOpen={modalOpen} onClose={() => setModalOpen(false)} defaultRole="client" />
      </>
    )
  }

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-100 px-2.5 py-1 rounded-full">
        <i className="ri-user-smile-fill text-blue-600" />
        <span className="max-w-[120px] truncate">{user.name}</span>
      </div>
      <button
        onClick={handleSignOut}
        className="text-xs text-red-600 hover:text-red-700 font-semibold px-2 py-1 rounded-md hover:bg-red-50 transition-colors"
        title="Chiqish"
      >
        <i className="ri-logout-box-r-line mr-1" />
        Chiqish
      </button>
    </div>
  )
}
