import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { AuthProvider as SystemAuthProvider } from './contexts/AuthContext'
import { AuthProvider as ClientAuthProvider } from './services/auth/AuthProvider'
import { RoleGuard } from './components/guards/RoleGuard'

// Layouts
import ClientLayout from './components/layouts/ClientLayout'
import { DriverLayout } from './components/layouts/DriverLayout'
import { UyushmaLayout } from './components/layouts/UyushmaLayout'
import { AdminLayout } from './components/layouts/AdminLayout'

// Client Pages (Dev 2)
import Home from './features/client/pages/Home'
import Search from './pages/Search'
import RouteDetails from './pages/RouteDetails'
import RouteOverview from './pages/RouteOverview'
import WalletPage from './pages/WalletPage'
import PaymentPage from './pages/PaymentPage'
import SignIn from './components/auth/SignIn'

// Auth (Dev 3)
import { LoginPage } from './pages/auth/LoginPage'

// Driver pages (Dev 3)
import { DriverDashboard } from './pages/driver/DriverDashboard'
import { DriverMap } from './pages/driver/DriverMap'
import { DriverPayments } from './pages/driver/DriverPayments'
import { DriverProfile } from './pages/driver/DriverProfile'

// Uyushma pages (Dev 3)
import { UyushmaDashboard } from './pages/uyushma/UyushmaDashboard'
import { UyushmaRoutes } from './pages/uyushma/UyushmaRoutes'
import { UyushmaDrivers } from './pages/uyushma/UyushmaDrivers'
import { UyushmaVehicles } from './pages/uyushma/UyushmaVehicles'
import { UyushmaParkings } from './pages/uyushma/UyushmaParkings'
import { UyushmaFares } from './pages/uyushma/UyushmaFares'
import { UyushmaPayments } from './pages/uyushma/UyushmaPayments'
import { RouteEditor } from './pages/uyushma/RouteEditor'

// Realtime Operations (Dev 3)
import { OperationsLiveMap } from './pages/operations/OperationsLiveMap'

// Admin pages (Dev 3)
import { AdminDashboard } from './pages/admin/AdminDashboard'
import { AdminUyushmalar } from './pages/admin/AdminUyushmalar'
import { AdminClients } from './pages/admin/AdminClients'
import { AdminShifts } from './pages/admin/AdminShifts'
import { AdminSettings } from './pages/admin/AdminSettings'
import { AdminAudit } from './pages/admin/AdminAudit'

function NotFound() {
  return (
    <div className="not-found-page">
      <h1>404</h1>
      <p>Sahifa topilmadi</p>
      <Link to="/"><i className="ri-arrow-left-line" /> Bosh sahifaga qaytish</Link>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <SystemAuthProvider>
        <ClientAuthProvider>
          <Routes>
            {/* ── Client PWA Routes (Mobile-first passenger app) ── */}
            <Route path="/" element={<ClientLayout />}>
              <Route index element={<Home />} />
              <Route path="search" element={<Search />} />
              <Route path="route/:id" element={<RouteDetails />} />
              <Route path="route/:number" element={<RouteOverview />} />
              <Route path="wallet" element={<WalletPage />} />
              <Route path="pay" element={<PaymentPage />} />
            </Route>
            <Route path="/signin" element={<SignIn />} />

            {/* ── Driver / Uyushma / Admin Auth ── */}
            <Route path="/login" element={<LoginPage />} />

            {/* ── Driver routes (mobile-first) ── */}
            <Route
              path="/driver"
              element={
                <RoleGuard allowedRoles={['driver']}>
                  <DriverLayout />
                </RoleGuard>
              }
            >
              <Route index element={<DriverDashboard />} />
              <Route path="map" element={<DriverMap />} />
              <Route path="payments" element={<DriverPayments />} />
              <Route path="profile" element={<DriverProfile />} />
            </Route>

            {/* ── Uyushma routes (desktop-first) ── */}
            <Route
              path="/uyushma"
              element={
                <RoleGuard allowedRoles={['uyushma']}>
                  <UyushmaLayout />
                </RoleGuard>
              }
            >
              <Route index element={<UyushmaDashboard />} />
              <Route path="routes" element={<UyushmaRoutes />} />
              <Route path="routes/editor" element={<RouteEditor />} />
              <Route path="routes/editor/:id" element={<RouteEditor />} />
              <Route path="drivers" element={<UyushmaDrivers />} />
              <Route path="vehicles" element={<UyushmaVehicles />} />
              <Route path="parkings" element={<UyushmaParkings />} />
              <Route path="fares" element={<UyushmaFares />} />
              <Route path="payments" element={<UyushmaPayments />} />
              <Route path="map" element={<OperationsLiveMap />} />
            </Route>

            {/* ── Admin routes (desktop-first) ── */}
            <Route
              path="/admin"
              element={
                <RoleGuard allowedRoles={['admin']}>
                  <AdminLayout />
                </RoleGuard>
              }
            >
              <Route index element={<AdminDashboard />} />
              <Route path="uyushmalar" element={<AdminUyushmalar />} />
              <Route path="routes" element={<UyushmaRoutes />} />
              <Route path="drivers" element={<UyushmaDrivers />} />
              <Route path="vehicles" element={<UyushmaVehicles />} />
              <Route path="clients" element={<AdminClients />} />
              <Route path="parkings" element={<UyushmaParkings />} />
              <Route path="payments" element={<UyushmaPayments />} />
              <Route path="shifts" element={<AdminShifts />} />
              <Route path="map" element={<OperationsLiveMap />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="audit" element={<AdminAudit />} />
            </Route>

            {/* ── Fallback 404 ── */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ClientAuthProvider>
      </SystemAuthProvider>
    </BrowserRouter>
  )
}
