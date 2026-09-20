import { render, screen } from '@testing-library/react'
import RouteCard from '../RouteCard'
import { makeItinerary, makeLeg } from '@/tests/fixtures'

describe('RouteCard', () => {
  it('shows duration, fare, walking distance and the leg chain', () => {
    render(
      <RouteCard
        itinerary={makeItinerary({
          title: 'Hamyonbop variant',
          totalDurationMinutes: 25,
          totalFareSoM: 2500,
          totalWalkingMeters: 400,
          legs: [makeLeg(), makeLeg({ id: 'leg-1', type: 'transit', routeNumber: '22', instruction: '22 ga chiqing' })],
        })}
      />,
    )
    expect(screen.getByText('Hamyonbop variant')).toBeInTheDocument()
    expect(screen.getByText('25 daqiqa')).toBeInTheDocument()
    expect(screen.getByText(/2.?500 so‘m/)).toBeInTheDocument()
    expect(screen.getByText(/400 m/)).toBeInTheDocument()
    expect(screen.getByText('22')).toBeInTheDocument()
  })

  it('says "no online vehicle visible" instead of hiding a route without live vehicles', () => {
    render(<RouteCard itinerary={makeItinerary({ liveVehiclesCount: 0 })} />)
    expect(screen.getByText(/Hozir online transport ko‘rinmayapti/i)).toBeInTheDocument()
  })

  it('shows the live vehicle badge when vehicles are online', () => {
    render(<RouteCard itinerary={makeItinerary({ liveVehiclesCount: 4 })} />)
    expect(screen.getByText(/4 ta mashina/i)).toBeInTheDocument()
  })

  it('never shows a price for walking-only trips and flags unknown tariffs', () => {
    const { rerender } = render(<RouteCard itinerary={makeItinerary({ isWalkingOnly: true, routeNumbers: [], routeIds: [] })} />)
    expect(screen.getByText('0 so‘m')).toBeInTheDocument()
    rerender(<RouteCard itinerary={makeItinerary({ fareKnown: false })} />)
    expect(screen.getByText('Tarif belgilanmagan')).toBeInTheDocument()
  })
})
