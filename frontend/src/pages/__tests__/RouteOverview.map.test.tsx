import React from 'react'
import { render } from '@testing-library/react'
import RouteOverview from '../RouteOverview'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// hoist-safe mocks
globalThis.__drawPolyline = globalThis.__drawPolyline || vi.fn()
globalThis.__addMarker = globalThis.__addMarker || vi.fn()
globalThis.__fitBounds = globalThis.__fitBounds || vi.fn()

vi.mock('@/services/map/maptiler', () => ({
  drawPolyline: (...args: any[]) => globalThis.__drawPolyline(...args),
  addMarker: (...args: any[]) => globalThis.__addMarker(...args),
  fitBoundsToCoordinates: (...args: any[]) => globalThis.__fitBounds(...args)
}))

vi.mock('@/components/map/AppMap', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: React.forwardRef((props: any, ref: any) => {
      React.useEffect(() => {
        props.onMapReady && props.onMapReady({ dummy: true })
      }, [])
      return React.createElement('div', { 'data-testid': 'appmap' })
    })
  }
})

test('draws route geometry and stops on map ready', async () => {
  render(
    <MemoryRouter initialEntries={["/route/15"]}>
      <Routes>
        <Route path="/route/:number" element={<RouteOverview />} />
      </Routes>
    </MemoryRouter>
  )

  expect(globalThis.__drawPolyline).toHaveBeenCalled()
  expect(globalThis.__addMarker).toHaveBeenCalled()
  expect(globalThis.__fitBounds).toHaveBeenCalled()
})
