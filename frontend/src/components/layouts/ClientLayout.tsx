import { useState, useEffect } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import HeaderAuthControls from '@/components/auth/HeaderAuthControls'
import OfflineIndicator from '@/components/ui/OfflineIndicator'
import PaymentModal from '@/components/client/PaymentModal'
import { watchStateService } from '@/services/watch/watchStateService'
import { ClientWatchSession } from '@/types/client'
import { uz } from '@/locales/uz'

export default function ClientLayout() {
  const location = useLocation()
  const [watchSession, setWatchSession] = useState<ClientWatchSession>(watchStateService.getSession())
  const [isPayModalOpen, setIsPayModalOpen] = useState(false)

  useEffect(() => {
    const unsub = watchStateService.subscribe((s) => {
      setWatchSession(s)
    })
    return unsub
  }, [])

  const navItems = [
    { to: '/', label: uz.nav.home, icon: 'ri-home-5-line', activeIcon: 'ri-home-5-fill' },
    { to: '/search', label: uz.nav.search, icon: 'ri-route-line', activeIcon: 'ri-route-fill' },
    { to: '/pay', label: uz.nav.pay, icon: 'ri-qr-scan-2-line', activeIcon: 'ri-qr-scan-2-fill', isAction: true },
    { to: '/wallet', label: uz.nav.wallet, icon: 'ri-wallet-3-line', activeIcon: 'ri-wallet-3-fill' }
  ]

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 text-neutral-900 selection:bg-blue-100">
      {/* Offline Banner */}
      <OfflineIndicator />

      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-neutral-200 px-4 py-3 shadow-xs">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold shadow-sm group-hover:scale-105 transition-transform">
              <i className="ri-bus-fill text-lg"></i>
            </div>
            <div>
              <div className="font-bold text-base tracking-tight flex items-center gap-1.5">
                <span>{uz.app.name}</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  {uz.app.city}
                </span>
              </div>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-neutral-600">
            <Link to="/" className={`hover:text-blue-600 transition-colors ${location.pathname === '/' ? 'text-blue-600 font-bold' : ''}`}>
              {uz.nav.home}
            </Link>
            <Link to="/search" className={`hover:text-blue-600 transition-colors ${location.pathname.startsWith('/search') ? 'text-blue-600 font-bold' : ''}`}>
              {uz.nav.search}
            </Link>
            <Link to="/wallet" className={`hover:text-blue-600 transition-colors ${location.pathname === '/wallet' ? 'text-blue-600 font-bold' : ''}`}>
              {uz.nav.wallet}
            </Link>
            <button
              onClick={() => setIsPayModalOpen(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-xs transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <i className="ri-qr-scan-2-line"></i>
              <span>{uz.nav.pay}</span>
            </button>
          </nav>

          <div className="flex items-center gap-3">
            <HeaderAuthControls />
          </div>
        </div>
      </header>

      {/* Active Watch/Ride Status Notification Banner */}
      {watchSession.status !== 'IDLE' && (
        <div className="bg-emerald-600 text-white px-4 py-2 text-xs shadow-inner">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
              </span>
              <span className="font-semibold">
                {watchSession.status === 'WATCHING'
                  ? `${watchSession.routeNumber}-marshrutni kutmoqdasiz`
                  : `${watchSession.routeNumber}-marshrutdasiz (Safardasiz)`}
              </span>
            </div>
            <Link
              to={`/route/${watchSession.routeNumber || '15'}`}
              className="underline font-bold hover:text-emerald-100 ml-3"
            >
              Xaritani ochish →
            </Link>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 pb-24 md:pb-8">
        <Outlet />
      </main>

      {/* Mobile Bottom Navigation Bar (touch target >= 44px) */}
      <nav
        aria-label="Pastki navigatsiya"
        className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-neutral-200 px-2 py-1.5 flex justify-around items-center md:hidden shadow-lg safe-bottom"
      >
        {navItems.map((item) => {
          const isActive = location.pathname === item.to

          if (item.isAction) {
            return (
              <button
                key={item.to}
                onClick={() => setIsPayModalOpen(true)}
                aria-label={item.label}
                className="flex flex-col items-center justify-center min-w-[64px] min-h-[48px] text-blue-600 active:scale-95 transition-transform"
              >
                <div className="w-10 h-10 -mt-4 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md">
                  <i className={`${item.icon} text-xl`}></i>
                </div>
                <span className="text-[10px] font-bold mt-0.5">{item.label}</span>
              </button>
            )
          }

          return (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className={`flex flex-col items-center justify-center min-w-[64px] min-h-[48px] transition-colors ${
                isActive ? 'text-blue-600 font-bold' : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              <i className={`${isActive ? item.activeIcon : item.icon} text-xl`}></i>
              <span className="text-[10px] mt-0.5">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Global Quick Payment Modal */}
      <PaymentModal
        isOpen={isPayModalOpen}
        onClose={() => setIsPayModalOpen(false)}
      />
    </div>
  )
}
