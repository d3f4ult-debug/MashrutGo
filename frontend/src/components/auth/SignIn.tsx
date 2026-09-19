import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/services/auth/AuthProvider'

export default function SignIn() {
  const [name, setName] = useState('')
  const [role, setRole] = useState('client')
  const { signin } = useAuth()
  const navigate = useNavigate()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const displayName = name.trim() || (role === 'client' ? 'Yo‘lovchi' : `Test ${role}`)
    const user = { id: String(Date.now()), name: displayName, roles: [role] }
    signin(user)

    // Also sync to SystemAuth in localStorage for RoleGuard compatibility
    const mockUsers: Record<string, any> = {
      driver: { id: 'dev-driver-1', email: 'driver@test.uz', full_name: displayName, role: 'driver' },
      uyushma: { id: 'dev-uyushma-1', email: 'uyushma@test.uz', full_name: displayName, role: 'uyushma' },
      admin: { id: 'dev-admin-1', email: 'admin@test.uz', full_name: displayName, role: 'admin' },
      client: { id: 'dev-client-1', email: 'client@test.uz', full_name: displayName, role: 'client' },
    }
    try {
      localStorage.setItem('auth_token', `dev-token-${role}`)
      localStorage.setItem('auth_user', JSON.stringify(mockUsers[role] || mockUsers.client))
    } catch {}

    // Navigate to role-specific dashboard
    if (role === 'driver') {
      navigate('/driver')
    } else if (role === 'admin') {
      navigate('/admin')
    } else if (role === 'uyushma') {
      navigate('/uyushma')
    } else {
      navigate('/')
    }
  }

  return (
    <div className="max-w-md mx-auto p-4 py-8">
      <div className="bg-white rounded-2xl p-6 border border-neutral-200 shadow-sm space-y-4">
        <h2 className="text-xl font-bold text-neutral-900">Kirish / Demo rejim</h2>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <div className="text-xs font-semibold text-neutral-600 mb-1">Ismingiz</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Masalan: Alisher"
              className="w-full p-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="block">
            <div className="text-xs font-semibold text-neutral-600 mb-1">Rolni tanlang</div>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full p-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="client">Client (Yo‘lovchi PWA)</option>
              <option value="driver">Driver (Haydovchi kabineti)</option>
              <option value="uyushma">Uyushma (Tashkilot paneli)</option>
              <option value="admin">Admin (Super Admin boshqaruvi)</option>
            </select>
          </label>
          <button
            type="submit"
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition-colors shadow-sm"
          >
            Kirish va sahifani ochish
          </button>
        </form>

        <div className="pt-2 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500">
          <Link to="/" className="hover:text-blue-600">
            ← Bosh sahifaga
          </Link>
          <Link to="/login" className="text-blue-600 hover:underline">
            Xodimlar login formasi →
          </Link>
        </div>
      </div>
    </div>
  )
}
