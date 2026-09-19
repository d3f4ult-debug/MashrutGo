import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import RouteCard from '../RouteCard'
import { Itinerary } from '@/types/client'

describe('RouteCard component', () => {
  it('renders simple props correctly', () => {
    render(
      <RouteCard
        title="Fastest"
        eta="20 daqiqa"
        price="2 000 so‘m"
        walking="350 m"
        transfers={0}
        routeNumbers="15"
      />
    )
    expect(screen.getByText('Fastest')).toBeTruthy()
    expect(screen.getByText('20 daqiqa')).toBeTruthy()
    expect(screen.getByText('2 000 so‘m')).toBeTruthy()
    expect(screen.getByText(/350 m/i)).toBeTruthy()
  })

  it('renders rich itinerary with neutral online vehicle status when count is 0', () => {
    const mockItinerary: Itinerary = {
      id: 'itn-1',
      title: 'Hamyonbop variant',
      mode: 'cheapest',
      totalDurationMinutes: 25,
      totalFareSoM: 2000,
      totalWalkingMeters: 400,
      transferCount: 1,
      routeNumbers: ['7', '22'],
      liveVehiclesCount: 0,
      departureTime: '10:00',
      arrivalTime: '10:25',
      legs: []
    }

    render(<RouteCard itinerary={mockItinerary} />)
    expect(screen.getByText('Hamyonbop variant')).toBeTruthy()
    expect(screen.getByText(/Hozir online transport ko‘rinmayapti/i)).toBeTruthy()
    expect(screen.getByText('25 daqiqa')).toBeTruthy()
  })

  it('renders live online vehicle badge when count > 0', () => {
    const mockItinerary: Itinerary = {
      id: 'itn-2',
      title: 'Tezkor',
      mode: 'fastest',
      totalDurationMinutes: 18,
      totalFareSoM: 2000,
      totalWalkingMeters: 200,
      transferCount: 0,
      routeNumbers: ['15'],
      liveVehiclesCount: 4,
      departureTime: '10:00',
      arrivalTime: '10:18',
      legs: []
    }

    render(<RouteCard itinerary={mockItinerary} />)
    expect(screen.getByText(/4 ta mashina liniyada/i)).toBeTruthy()
  })
})
