import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ItineraryLegs from './ItineraryLegs'
import { Itinerary } from '@/types/client'

describe('ItineraryLegs component', () => {
  it('renders step-by-step legs with walking, boarding and alighting stops', () => {
    const mockItinerary: Itinerary = {
      id: 'itn-test',
      title: 'Marshrut 15 test',
      mode: 'fastest',
      totalDurationMinutes: 20,
      totalFareSoM: 2000,
      totalWalkingMeters: 300,
      transferCount: 0,
      routeNumbers: ['15'],
      liveVehiclesCount: 3,
      departureTime: '12:00',
      arrivalTime: '12:20',
      legs: [
        {
          id: 'l1',
          type: 'walking',
          instruction: 'Bekatgacha piyoda boring',
          distanceMeters: 200,
          durationMinutes: 3
        },
        {
          id: 'l2',
          type: 'transit',
          routeNumber: '15',
          instruction: '15-sonli marshrutga chiqing',
          distanceMeters: 2500,
          durationMinutes: 15,
          intermediateStopsCount: 3,
          fareSoM: 2000,
          fromStop: { id: 's1', name: 'Registon bekati', coordinates: [72.34, 40.78] },
          toStop: { id: 's2', name: 'Bozor bekati', coordinates: [72.36, 40.77] }
        }
      ]
    }

    render(<ItineraryLegs itinerary={mockItinerary} />)
    expect(screen.getByText('Marshrut 15 test')).toBeTruthy()
    expect(screen.getByText('Bekatgacha piyoda boring')).toBeTruthy()
    expect(screen.getByText('15-sonli marshrutga chiqing')).toBeTruthy()
    expect(screen.getByText(/Registon bekati/i)).toBeTruthy()
    expect(screen.getByText(/Bozor bekati/i)).toBeTruthy()
  })
})
