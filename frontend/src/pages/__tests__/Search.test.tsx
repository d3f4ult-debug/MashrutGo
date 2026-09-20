import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forwardRef } from 'react'
import { MemoryRouter } from 'react-router-dom'
import Search from '../Search'
import { clientApi } from '@/services/api/clientApi'
import { makeItinerary } from '@/tests/fixtures'

vi.mock('@/components/map/AppMap', () => ({
  default: forwardRef(function MapStub() {
    return <div data-testid="app-map-mock" />
  }),
}))

vi.mock('@/services/api/clientApi', () => ({
  clientApi: { searchItineraries: vi.fn() },
}))

const URL_WITH_POINTS = '/search?from=Eski+shahar&fromLat=40.7836&fromLng=72.3337&to=Yangi+bozor&toLat=40.776&toLng=72.364'

describe('Search page', () => {
  beforeEach(() => {
    vi.mocked(clientApi.searchItineraries).mockReset()
  })

  it('asks for points when A/B are missing', () => {
    render(
      <MemoryRouter initialEntries={['/search']}>
        <Search />
      </MemoryRouter>,
    )
    expect(screen.getByText('A va B nuqtalar tanlanmagan')).toBeInTheDocument()
    expect(clientApi.searchItineraries).not.toHaveBeenCalled()
  })

  it('searches the backend with the coordinates from the URL and re-sorts by mode', async () => {
    vi.mocked(clientApi.searchItineraries).mockResolvedValue([
      makeItinerary({ id: 'fast', title: 'Tezkor', totalDurationMinutes: 15, totalFareSoM: 5000 }),
      makeItinerary({ id: 'cheap', title: 'Arzon', totalDurationMinutes: 30, totalFareSoM: 2500 }),
    ])

    render(
      <MemoryRouter initialEntries={[URL_WITH_POINTS]}>
        <Search />
      </MemoryRouter>,
    )

    const list = await screen.findByTestId('itineraries-list')
    const [origin, destination] = vi.mocked(clientApi.searchItineraries).mock.calls[0]
    expect(origin).toEqual({ name: 'Eski shahar', coordinates: [72.3337, 40.7836] })
    expect(destination).toEqual({ name: 'Yangi bozor', coordinates: [72.364, 40.776] })
    expect(within(list).getAllByRole('heading')[0]).toHaveTextContent('Tezkor')

    fireEvent.click(screen.getByTestId('tab-cheapest'))
    await waitFor(() => expect(within(screen.getByTestId('itineraries-list')).getAllByRole('heading')[0]).toHaveTextContent('Arzon'))
  })

  it('shows a retryable error when routing fails', async () => {
    vi.mocked(clientApi.searchItineraries).mockRejectedValue(new Error('Serverga ulanib bo‘lmadi'))
    render(
      <MemoryRouter initialEntries={[URL_WITH_POINTS]}>
        <Search />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Serverga ulanib bo‘lmadi')).toBeInTheDocument()
    expect(screen.getByText('Qayta urinish')).toBeInTheDocument()
  })
})
