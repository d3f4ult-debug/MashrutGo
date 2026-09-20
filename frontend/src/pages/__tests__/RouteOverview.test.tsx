import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RouteOverview from '../RouteOverview'
import { clientApi } from '@/services/api/clientApi'

vi.mock('@/services/api/clientApi', () => ({
  clientApi: { listRoutes: vi.fn() },
}))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/overview/:number" element={<RouteOverview />} />
        <Route path="/route/:id" element={<div>route page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RouteOverview (route number → route id)', () => {
  it('redirects when exactly one published route has the number', async () => {
    vi.mocked(clientApi.listRoutes).mockResolvedValue([
      { id: 7, routeNumber: '15', name: 'Eski shahar — Yangi bozor', originName: 'Eski shahar', destinationName: 'Yangi bozor' },
      { id: 8, routeNumber: '15A', name: 'Boshqa', originName: 'X', destinationName: 'Y' },
    ])
    renderAt('/overview/15')
    expect(await screen.findByText('route page')).toBeInTheDocument()
  })

  it('explains when no published route has the number', async () => {
    vi.mocked(clientApi.listRoutes).mockResolvedValue([])
    renderAt('/overview/99')
    expect(await screen.findByText(/topilmadi/)).toBeInTheDocument()
  })
})
