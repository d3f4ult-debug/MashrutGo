import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { RoleGuard } from './components/guards/RoleGuard';

// Layouts
import { DriverLayout } from './components/layouts/DriverLayout';
import { UyushmaLayout } from './components/layouts/UyushmaLayout';
import { AdminLayout } from './components/layouts/AdminLayout';

// Auth
import { LoginPage } from './pages/auth/LoginPage';

// Driver pages
import { DriverDashboard } from './pages/driver/DriverDashboard';
import { DriverMap } from './pages/driver/DriverMap';
import { DriverPayments } from './pages/driver/DriverPayments';
import { DriverProfile } from './pages/driver/DriverProfile';

// Uyushma pages
import { UyushmaDashboard } from './pages/uyushma/UyushmaDashboard';
import { UyushmaRoutes } from './pages/uyushma/UyushmaRoutes';
import { UyushmaDrivers } from './pages/uyushma/UyushmaDrivers';
import { UyushmaVehicles } from './pages/uyushma/UyushmaVehicles';
import { UyushmaParkings } from './pages/uyushma/UyushmaParkings';
import { UyushmaFares } from './pages/uyushma/UyushmaFares';
import { UyushmaPayments } from './pages/uyushma/UyushmaPayments';
import { RouteEditor } from './pages/uyushma/RouteEditor';

// Realtime Operations
import { OperationsLiveMap } from './pages/operations/OperationsLiveMap';

// Admin pages
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminUyushmalar } from './pages/admin/AdminUyushmalar';
import { AdminClients } from './pages/admin/AdminClients';
import { AdminShifts } from './pages/admin/AdminShifts';
import { AdminSettings } from './pages/admin/AdminSettings';
import { AdminAudit } from './pages/admin/AdminAudit';

function NotFound() {
  return (
    <div className="not-found-page">
      <h1>404</h1>
      <p>Sahifa topilmadi</p>
      <Link to="/login"><i className="ri-arrow-left-line" /> Bosh sahifaga</Link>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* ── Public ── */}
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

          {/* ── Redirects ── */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
