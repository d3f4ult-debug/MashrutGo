import React from 'react'
import { Routes, Route } from 'react-router-dom'
import ClientLayout from './components/layouts/ClientLayout'
import DriverLayout from './components/layouts/DriverLayout'
import UyushmaLayout from './components/layouts/UyushmaLayout'
import AdminLayout from './components/layouts/AdminLayout'
import Home from './features/client/pages/Home'
import DriverHome from './features/driver/pages/DriverHome'
import UyushmaHome from './features/uyushma/pages/UyushmaHome'
import AdminHome from './features/admin/pages/AdminHome'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ClientLayout />}>
        <Route index element={<Home />} />
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
  )
}
