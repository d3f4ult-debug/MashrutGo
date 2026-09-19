import { describe, it, expect, beforeEach, vi } from 'vitest'
import { walletService, REGISTERED_VEHICLES } from './walletService'

describe('walletService', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })

  it('has initial balance', () => {
    const bal = walletService.getBalance()
    expect(bal).toBeGreaterThanOrEqual(0)
  })

  it('resolves vehicle by plate or route number', () => {
    const v1 = walletService.resolveVehicle('60 A 105 AA')
    expect(v1).toBeTruthy()
    expect(v1?.routeNumber).toBe('15')

    const v2 = walletService.resolveVehicle('15')
    expect(v2).toBeTruthy()
    expect(v2?.fareSoM).toBe(2000)
  })

  it('successfully tops up with Click', async () => {
    const initialBal = walletService.getBalance()
    const res = await walletService.topUpWithClick(10000)
    expect(res.success).toBe(true)
    expect(walletService.getBalance()).toBe(initialBal + 10000)
  })

  it('successfully pays transport fare from wallet', async () => {
    const vehicle = REGISTERED_VEHICLES[0]
    const initialBal = walletService.getBalance()

    const res = await walletService.payTransportFare(vehicle, 'wallet', 'test-key-1')
    expect(res.success).toBe(true)
    expect(res.receipt).toBeTruthy()
    expect(walletService.getBalance()).toBe(initialBal - vehicle.fareSoM)
  })

  it('blocks payment when offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const vehicle = REGISTERED_VEHICLES[0]
    const res = await walletService.payTransportFare(vehicle, 'wallet', 'test-key-offline')
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/internet/i)
  })
})
