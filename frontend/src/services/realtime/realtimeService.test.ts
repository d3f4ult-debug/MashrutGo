import { describe, it, expect, vi, beforeEach } from 'vitest'
import { realtimeService } from './realtimeService'
import { LiveVehicle } from '@/types/client'

describe('realtimeService', () => {
  it('subscribes to live route vehicles stream', async () => {
    let received: LiveVehicle[] = []

    const sub = realtimeService.subscribeToRoute('15', (vehicles) => {
      received = vehicles
    })

    expect(sub).toBeTruthy()
    expect(typeof sub.unsubscribe).toBe('function')

    // Wait for simulation or initial cached vehicles
    await new Promise((resolve) => setTimeout(resolve, 300))

    sub.unsubscribe()
  })

  it('marks vehicles older than 30s as stale', () => {
    const oldVehicle: LiveVehicle = {
      id: 'v-stale',
      routeNumber: '15',
      licensePlate: '60 A 999 AA',
      coordinates: [72.34, 40.78],
      speedKmh: 0,
      headingDeg: 0,
      lastUpdatedEpochMs: Date.now() - 35000 // 35s ago
    }

    const checkFn = (realtimeService as any).checkStale.bind(realtimeService)
    const result = checkFn([oldVehicle])

    expect(result[0].isStale).toBe(true)
  })

  it('marks fresh vehicles as not stale', () => {
    const freshVehicle: LiveVehicle = {
      id: 'v-fresh',
      routeNumber: '15',
      licensePlate: '60 A 111 AA',
      coordinates: [72.34, 40.78],
      speedKmh: 30,
      headingDeg: 90,
      lastUpdatedEpochMs: Date.now() - 5000 // 5s ago
    }

    const checkFn = (realtimeService as any).checkStale.bind(realtimeService)
    const result = checkFn([freshVehicle])

    expect(result[0].isStale).toBe(false)
  })
})
