import { render, screen } from '@testing-library/react'
import ItineraryLegs from './ItineraryLegs'
import { makeItinerary, makeLeg } from '@/tests/fixtures'

describe('ItineraryLegs', () => {
  it('renders walking and transit steps with boarding and alighting stops', () => {
    const itinerary = makeItinerary({
      title: 'Marshrut 15',
      legs: [
        makeLeg({ instruction: 'Bekatgacha piyoda boring' }),
        makeLeg({
          id: 'leg-1',
          type: 'transit',
          routeNumber: '15',
          instruction: '15-yo‘nalishga chiqing',
          distanceMeters: 2500,
          durationMinutes: 15,
          intermediateStopsCount: 3,
          fareSoM: 2500,
          fareKnown: true,
          fromStop: { id: 's1', name: 'Bobur maydoni', coordinates: [72.34, 40.78] },
          toStop: { id: 's2', name: 'Yangi bozor', coordinates: [72.36, 40.77] },
        }),
      ],
    })

    render(<ItineraryLegs itinerary={itinerary} />)
    expect(screen.getByText('Marshrut 15')).toBeInTheDocument()
    expect(screen.getByText('Bekatgacha piyoda boring')).toBeInTheDocument()
    expect(screen.getByText('15-yo‘nalishga chiqing')).toBeInTheDocument()
    expect(screen.getByText('Bobur maydoni')).toBeInTheDocument()
    expect(screen.getByText('Yangi bozor')).toBeInTheDocument()
  })

  it('marks a transit leg without visible vehicles neutrally', () => {
    const itinerary = makeItinerary({
      legs: [makeLeg({ id: 'leg-t', type: 'transit', routeNumber: '7', instruction: '7 ga chiqing', liveStatus: 'no_online_vehicle_visible' })],
    })
    render(<ItineraryLegs itinerary={itinerary} />)
    expect(screen.getByText(/Hozir online transport ko‘rinmayapti/i)).toBeInTheDocument()
  })
})
