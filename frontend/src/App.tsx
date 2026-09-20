import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { UyushmaScopeProvider } from './contexts/UyushmaScopeContext'
import { RoleGuard } from './components/guards/RoleGuard'
import { AppErrorBoundary } from './components/AppErrorBoundary'

// Client PWA (loaded eagerly: this is what most visitors open)
import ClientLayout from './components/layouts/ClientLayout'
import Home from './features/client/pages/Home'
import Search from './pages/Search'
import RouteDetails from './pages/RouteDetails'
import RouteOverview from './pages/RouteOverview'
import WalletPage from './pages/WalletPage'
import PaymentPage from './pages/PaymentPage'
import { LoginPage } from './pages/auth/LoginPage'

// Staff portals are code-split: a passenger's phone never downloads the operations UI
const DriverLayout = lazy(() => import('./components/layouts/DriverLayout').then((m) => ({ default: m.DriverLayout })))
const DriverDashboard = lazy(() => import('./pages/driver/DriverDashboard').then((m) => ({ default: m.DriverDashboard })))
const DriverMap = lazy(() => import('./pages/driver/DriverMap').then((m) => ({ default: m.DriverMap })))
const DriverPayments = lazy(() => import('./pages/driver/DriverPayments').then((m) => ({ default: m.DriverPayments })))
const DriverProfile = lazy(() => import('./pages/driver/DriverProfile').then((m) => ({ default: m.DriverProfile })))

const UyushmaLayout = lazy(() => import('./components/layouts/UyushmaLayout').then((m) => ({ default: m.UyushmaLayout })))
const UyushmaDashboard = lazy(() => import('./pages/uyushma/UyushmaDashboard').then((m) => ({ default: m.UyushmaDashboard })))
const UyushmaRoutes = lazy(() => import('./pages/uyushma/UyushmaRoutes').then((m) => ({ default: m.UyushmaRoutes })))
const UyushmaDrivers = lazy(() => import('./pages/uyushma/UyushmaDrivers').then((m) => ({ default: m.UyushmaDrivers })))
const UyushmaVehicles = lazy(() => import('./pages/uyushma/UyushmaVehicles').then((m) => ({ default: m.UyushmaVehicles })))
const UyushmaParkings = lazy(() => import('./pages/uyushma/UyushmaParkings').then((m) => ({ default: m.UyushmaParkings })))
const UyushmaFares = lazy(() => import('./pages/uyushma/UyushmaFares').then((m) => ({ default: m.UyushmaFares })))
const UyushmaPayments = lazy(() => import('./pages/uyushma/UyushmaPayments').then((m) => ({ default: m.UyushmaPayments })))
const RouteEditor = lazy(() => import('./pages/uyushma/RouteEditor').then((m) => ({ default: m.RouteEditor })))
const OperationsLiveMap = lazy(() => import('./pages/operations/OperationsLiveMap').then((m) => ({ default: m.OperationsLiveMap })))

const AdminLayout = lazy(() => import('./components/layouts/AdminLayout').then((m) => ({ default: m.AdminLayout })))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })))
const AdminUyushmalar = lazy(() => import('./pages/admin/AdminUyushmalar').then((m) => ({ default: m.AdminUyushmalar })))
const AdminClients = lazy(() => import('./pages/admin/AdminClients').then((m) => ({ default: m.AdminClients })))
const AdminShifts = lazy(() => import('./pages/admin/AdminShifts').then((m) => ({ default: m.AdminShifts })))
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings').then((m) => ({ default: m.AdminSettings })))
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit').then((m) => ({ default: m.AdminAudit })))

function PortalLoading() {
  return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <p>Yuklanmoqda...</p>
    </div>
  )
}

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
      <AuthProvider>
        <AppErrorBoundary>
          <Suspense fallback={<PortalLoading />}>
            <Routes>
              {/* ── Client PWA Routes (Mobile-first passenger app) ── */}
              <Route path="/" element={<ClientLayout />}>
                <Route index element={<Home />} />
                <Route path="search" element={<Search />} />
                <Route path="route/:id" element={<RouteDetails />} />
                <Route path="overview/:number" element={<RouteOverview />} />
                <Route path="wallet" element={<WalletPage />} />
                <Route path="pay" element={<PaymentPage />} />
              </Route>
              <Route path="/signin" element={<Navigate to="/login" replace />} />

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
                    <UyushmaScopeProvider>
                      <UyushmaLayout />
                    </UyushmaScopeProvider>
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
                    <UyushmaScopeProvider>
                      <AdminLayout />
                    </UyushmaScopeProvider>
                  </RoleGuard>
                }
              >
                <Route index element={<AdminDashboard />} />
                <Route path="uyushmalar" element={<AdminUyushmalar />} />
                <Route path="routes" element={<UyushmaRoutes />} />
                <Route path="routes/editor" element={<RouteEditor />} />
                <Route path="routes/editor/:id" element={<RouteEditor />} />
                <Route path="drivers" element={<UyushmaDrivers />} />
                <Route path="vehicles" element={<UyushmaVehicles />} />
                <Route path="fares" element={<UyushmaFares />} />
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
          </Suspense>
        </AppErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  )
}
