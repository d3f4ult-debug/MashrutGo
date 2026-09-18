import React from 'react'
import { Outlet, Link } from 'react-router-dom'

export default function ClientLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-4 border-b">MashrutGo</header>
      <main className="flex-1 p-4">
        <Outlet />
      </main>
      <nav className="border-t p-2 flex justify-around md:hidden">
        <Link to="/">Home</Link>
        <Link to="/search">Routes</Link>
        <Link to="/wallet">Wallet</Link>
        <Link to="/profile">Profile</Link>
      </nav>
    </div>
  )
}
