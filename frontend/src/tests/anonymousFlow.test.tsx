import { render, screen } from '@testing-library/react'
import { forwardRef } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import Home from '@/features/client/pages/Home'
import WalletPage from '@/pages/WalletPage'
import { clientApi } from '@/services/api/clientApi'

vi.mock('@/components/map/AppMap', () => ({
  default: forwardRef(function MapStub() {
    return <div data-testid="app-map-mock" />
  }),
}))

vi.mock('@/services/api/clientApi', () => ({
  clientApi: {
    listRoutes: vi.fn(),
    searchPlaces: vi.fn().mockResolvedValue([]),
    walletBalance: vi.fn(),
    walletTransactions: vi.fn(),
    paymentConfig: vi.fn().mockResolvedValue({ clickConfigured: false, sandboxEnabled: true, minTopupSoM: 1000, maxTopupSoM: 2000000, maintenanceMode: false }),
  },
}))

describe('Anonymous client flow (no login required for routing)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(clientApi.listRoutes).mockResolvedValue([
      { id: 1, routeNumber: '15', name: 'Eski shahar — Yangi bozor', originName: 'Eski shahar', destinationName: 'Yangi bozor' },
    ])
  })

  it('lets an anonymous user search and browse published routes', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <Home />
        </AuthProvider>
      </MemoryRouter>,
    )
    expect(screen.getByText(/Qayerga bormoqchisiz/i)).toBeInTheDocument()
    expect(await screen.findByText('Eski shahar — Yangi bozor')).toBeInTheDocument()
    expect(clientApi.listRoutes).toHaveBeenCalled()
  })

  it('asks for login only for personal features such as the wallet', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <WalletPage />
        </AuthProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Hamyondan foydalanish uchun hisobingizga kiring.')).toBeInTheDocument()
    expect(clientApi.walletBalance).not.toHaveBeenCalled()
  })
})
