import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/services/auth/AuthProvider'

export default function SignIn() {
  const [name, setName] = useState('')
  const [role, setRole] = useState('client')
  const { signin } = useAuth()
  const navigate = useNavigate()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const user = { id: String(Date.now()), name, roles: [role] }
    signin(user)
    navigate('/')
  }

  return (
    <div className="max-w-md mx-auto p-4">
      <h2 className="text-xl mb-4">Sign in (demo)</h2>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <div className="text-sm mb-1">Name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full p-2 border rounded" />
        </label>
        <label className="block">
          <div className="text-sm mb-1">Role</div>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full p-2 border rounded">
            <option value="client">Client</option>
            <option value="driver">Driver</option>
            <option value="admin">Admin</option>
            <option value="uyushma">Uyushma</option>
          </select>
        </label>
        <div>
          <button className="px-4 py-2 bg-blue-600 text-white rounded">Sign in</button>
        </div>
      </form>
    </div>
  )
}
