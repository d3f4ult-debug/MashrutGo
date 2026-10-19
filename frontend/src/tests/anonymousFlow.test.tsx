import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider as ClientAuthProvider } from '@/services/auth/AuthProvider'
import { AuthProvider as SystemAuthProvider } from '@/contexts/AuthContext'
import Home from '@/features/client/pages/Home'
import RouteDetails from '@/pages/RouteDetails'
import WalletPage from '@/pages/WalletPage'

// Mock AppMap to avoid WebGL context requirements in jsdom
vi.mock('@/components/map/AppMap', () => {
  return {
    default: () => <div data-testid="app-map-mock">Map</div>
  }
})

describe('Anonymous User Flow', () => {
  it('allows anonymous browsing of Home page without authentication', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SystemAuthProvider>
          <ClientAuthProvider>
            <Home />
          </ClientAuthProvider>
        </SystemAuthProvider>
      </MemoryRouter>
    )

    expect(screen.getByText(/Qayerga bormoqchisiz/i)).toBeTruthy()
    expect(screen.getByText(/Tavsiya etilgan marshrutlar/i)).toBeTruthy()
  })

  it('allows anonymous viewing of RouteDetails page with live fleet and stops', () => {
    render(
      <MemoryRouter initialEntries={['/route/15']}>
        <SystemAuthProvider>
          <ClientAuthProvider>
            <Routes>
              <Route path="/route/:id" element={<RouteDetails />} />
            </Routes>
          </ClientAuthProvider>
        </SystemAuthProvider>
      </MemoryRouter>
    )

    expect(screen.getByText(/15-sonli Marshrut/i)).toBeTruthy()
    expect(screen.getByText(/Kutayapman \/ Kuzatish/i)).toBeTruthy()
  })

  it('prompts authentication when entering WalletPage without an active session', () => {
    render(
      <MemoryRouter initialEntries={['/wallet']}>
        <SystemAuthProvider>
          <ClientAuthProvider>
            <WalletPage />
          </ClientAuthProvider>
        </SystemAuthProvider>
      </MemoryRouter>
    )

    // Auth modal should open automatically for anonymous user
    expect(screen.getByText(/Tizimga kirish/i)).toBeTruthy()
    expect(screen.getByText(/Hamyon va to‘lovlardan foydalanish uchun kiring/i)).toBeTruthy()
  })
})
