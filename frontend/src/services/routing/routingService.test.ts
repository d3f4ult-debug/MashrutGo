import { describe, it, expect } from 'vitest'
import { findItineraries, getRouteByNumber, searchLandmarks } from './routingService'

describe('routingService', () => {
  it('returns valid itineraries for A to B', async () => {
    const results = await findItineraries('Eski Shahar', 'Yangi Bozor')
    expect(results.length).toBeGreaterThan(0)

    const fastest = results.find((r) => r.mode === 'fastest')
    expect(fastest).toBeTruthy()
    expect(fastest?.totalDurationMinutes).toBeGreaterThan(0)
    expect(fastest?.legs.length).toBeGreaterThan(0)
  })

  it('includes walking-only alternative', async () => {
    const results = await findItineraries('Eski Shahar', 'Yangi Bozor')
    const walking = results.find((r) => r.totalFareSoM === 0 && r.transferCount === 0)
    expect(walking).toBeTruthy()
  })

  it('aborts search if signal aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      findItineraries('Eski Shahar', 'Yangi Bozor', controller.signal)
    ).rejects.toThrow()
  })

  it('gets route catalog data by route number', () => {
    const route15 = getRouteByNumber('15')
    expect(route15).toBeTruthy()
    expect(route15?.routeNumber).toBe('15')
    expect(route15?.stops.length).toBeGreaterThan(0)

    const nonExistent = getRouteByNumber('999')
    expect(nonExistent).toBeNull()
  })

  it('searches landmarks in Andijon', () => {
    const landmarks = searchLandmarks('vokzal')
    expect(landmarks.length).toBeGreaterThan(0)
    expect(landmarks[0].name).toMatch(/Vokzal/i)
  })
})
