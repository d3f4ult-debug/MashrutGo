import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PaymentModal from './PaymentModal'
import { REGISTERED_VEHICLES } from '@/services/wallet/walletService'

describe('PaymentModal component', () => {
  beforeEach(() => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })

  it('renders closed when isOpen is false', () => {
    const { container } = render(<PaymentModal isOpen={false} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders modal with tabs when isOpen is true', () => {
    render(<PaymentModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByText(/Yo‘l haqini to‘lash/i)).toBeTruthy()
    expect(screen.getByText(/QR Skan/i)).toBeTruthy()
    expect(screen.getByText(/Qo‘lda kiritish/i)).toBeTruthy()
  })

  it('shows vehicle confirmation when initialVehicle is provided', () => {
    const vehicle = REGISTERED_VEHICLES[0]
    render(
      <PaymentModal
        isOpen={true}
        onClose={() => {}}
        initialVehicle={vehicle}
      />
    )
    expect(screen.getByText(/To‘lovni tasdiqlash/i)).toBeTruthy()
    expect(screen.getByText(new RegExp(vehicle.licensePlate, 'i'))).toBeTruthy()
    expect(screen.getByText(/Hamyondan to‘lash/i)).toBeTruthy()
  })
})
