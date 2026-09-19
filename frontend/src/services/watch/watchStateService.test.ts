import { describe, it, expect, beforeEach, vi } from 'vitest'
import { watchStateService } from './watchStateService'

describe('watchStateService lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    watchStateService.stopWatching()
  })

  it('starts in IDLE state', () => {
    const session = watchStateService.getSession()
    expect(session.status).toBe('IDLE')
  })

  it('transitions from IDLE to WATCHING when startWatching is called', () => {
    // Mock navigator online
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)

    const res = watchStateService.startWatching('15', 'stop-1')
    expect(res.success).toBe(true)
    const session = watchStateService.getSession()
    expect(session.status).toBe('WATCHING')
    expect(session.routeNumber).toBe('15')
  })

  it('transitions from WATCHING to ON_VEHICLE when boardVehicle is called', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    watchStateService.startWatching('15')
    watchStateService.boardVehicle()

    const session = watchStateService.getSession()
    expect(session.status).toBe('ON_VEHICLE')
  })

  it('transitions to IDLE when alightVehicle is called', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    watchStateService.startWatching('15')
    watchStateService.boardVehicle()
    watchStateService.alightVehicle()

    const session = watchStateService.getSession()
    expect(session.status).toBe('IDLE')
  })

  it('blocks startWatching when offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const res = watchStateService.startWatching('15')
    expect(res.success).toBe(false)
    expect(res.error).toBeTruthy()
    expect(watchStateService.getSession().status).toBe('IDLE')
  })
})
