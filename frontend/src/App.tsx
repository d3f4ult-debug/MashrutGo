import React from 'react'
import { Routes, Route } from 'react-router-dom'
import ClientLayout from './components/layouts/ClientLayout'
import { AuthProvider } from '@/services/auth/AuthProvider'
import DriverLayout from './components/layouts/DriverLayout'
import UyushmaLayout from './components/layouts/UyushmaLayout'
import AdminLayout from './components/layouts/AdminLayout'
import Home from './features/client/pages/Home'
import Search from './pages/Search'
import RouteDetails from './pages/RouteDetails'
import RouteOverview from './pages/RouteOverview'
import WalletPage from './pages/WalletPage'
import PaymentPage from './pages/PaymentPage'
import DriverHome from './features/driver/pages/DriverHome'
import UyushmaHome from './features/uyushma/pages/UyushmaHome'
import AdminHome from './features/admin/pages/AdminHome'
import SignIn from './components/auth/SignIn'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/" element={<ClientLayout />}>
          <Route index element={<Home />} />
          <Route path="search" element={<Search />} />
          <Route path="route/:id" element={<RouteDetails />} />
          <Route path="route/:number" element={<RouteOverview />} />
          <Route path="wallet" element={<WalletPage />} />
          <Route path="pay" element={<PaymentPage />} />
        </Route>
        <Route path="/driver" element={<DriverLayout />}>
          <Route index element={<DriverHome />} />
        </Route>
        <Route path="/uyushma" element={<UyushmaLayout />}>
          <Route index element={<UyushmaHome />} />
        </Route>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminHome />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
