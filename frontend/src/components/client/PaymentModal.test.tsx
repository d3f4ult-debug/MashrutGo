import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PaymentModal from './PaymentModal'
import { AuthProvider } from '@/contexts/AuthContext'
import { clientApi } from '@/services/api/clientApi'
import type { ResolvedVehicle } from '@/types/client'

vi.mock('@/services/api/clientApi', () => ({
  clientApi: {
    resolveVehicle: vi.fn(),
    walletBalance: vi.fn(),
    payFare: vi.fn(),
  },
}))

const vehicle: ResolvedVehicle = {
  vehicleId: 'AND01-V0001',
  licensePlate: '60 A 101 AA',
  model: 'Damas',
  routeId: 1,
  routeNumber: '15',
  routeName: 'Eski shahar — Yangi bozor',
  uyushmaName: 'Andijon Uyushmasi',
  fareSoM: 2500,
  fareRuleName: 'Standart',
  driverName: 'Otabek',
  isOnShift: true,
}

function renderModal(props: Partial<Parameters<typeof PaymentModal>[0]> = {}) {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <PaymentModal isOpen onClose={() => undefined} {...props} />
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('PaymentModal', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(clientApi.resolveVehicle).mockReset()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <MemoryRouter>
        <AuthProvider>
          <PaymentModal isOpen={false} onClose={() => undefined} />
        </AuthProvider>
      </MemoryRouter>,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('offers QR, manual and NFC identification', () => {
    renderModal()
    expect(screen.getByText('Yo‘l haqini to‘lash')).toBeInTheDocument()
    expect(screen.getByText('QR skan')).toBeInTheDocument()
    expect(screen.getByText('Qo‘lda kiritish')).toBeInTheDocument()
    expect(screen.getByText('NFC')).toBeInTheDocument()
  })

  it('resolves a scanned vehicle through the backend before paying', async () => {
    vi.mocked(clientApi.resolveVehicle).mockResolvedValue(vehicle)
    renderModal({ initialIdentifier: 'AND01-V0001' })
    await waitFor(() => expect(clientApi.resolveVehicle).toHaveBeenCalledWith('AND01-V0001', 'qr'))
    expect(await screen.findByText(/60 A 101 AA/)).toBeInTheDocument()
    expect(screen.getByText('To‘lovni tasdiqlash')).toBeInTheDocument()
  })

  it('shows the backend error when the vehicle is unknown', async () => {
    vi.mocked(clientApi.resolveVehicle).mockRejectedValue(new Error('Transport topilmadi yoki faol emas'))
    renderModal({ initialIdentifier: 'BAD-ID' })
    expect(await screen.findByText('Transport topilmadi yoki faol emas')).toBeInTheDocument()
  })
})
