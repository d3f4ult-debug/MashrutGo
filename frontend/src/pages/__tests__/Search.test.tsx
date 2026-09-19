import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Search from '../Search'

// Mock AppMap to avoid WebGL context requirements in jsdom
vi.mock('@/components/map/AppMap', () => {
  return {
    default: React.forwardRef((props: any, ref: any) => (
      <div data-testid="app-map-mock">Map</div>
    ))
  }
})

describe('Search Page', () => {
  it('renders search results and filter tabs', async () => {
    render(
      <MemoryRouter initialEntries={['/search?from=Eski+Shahar&to=Yangi+Bozor']}>
        <Search />
      </MemoryRouter>
    )

    // Check header summary
    expect(screen.getByText('Eski Shahar')).toBeTruthy()
    expect(screen.getByText('Yangi Bozor')).toBeTruthy()

    // Check filter tabs
    expect(screen.getByTestId('tab-fastest')).toBeTruthy()
    expect(screen.getByTestId('tab-cheapest')).toBeTruthy()

    // Wait for itineraries to load
    await waitFor(() => {
      expect(screen.getByText(/Mavjud variantlar/i)).toBeTruthy()
      expect(screen.getAllByText('Tezkor yo‘nalish').length).toBeGreaterThan(0)
    })
  })

  it('allows switching filter mode tabs', async () => {
    render(
      <MemoryRouter initialEntries={['/search?from=Eski+Shahar&to=Yangi+Bozor']}>
        <Search />
      </MemoryRouter>
    )

    await waitFor(() => {
      const list = screen.getByTestId('itineraries-list')
      expect(list).toBeTruthy()
      expect(list.querySelectorAll('h3').length).toBeGreaterThan(0)
      expect(list.querySelectorAll("h3")[0].textContent).toMatch(/Tezkor yo‘nalish/)
    })

    const cheapestTab = screen.getByTestId('tab-cheapest')
    fireEvent.click(cheapestTab)

    await waitFor(() => {
      const list = screen.getByTestId('itineraries-list')
      const matches = Array.from(list.querySelectorAll('h3')).filter((el) => /Hamyonbop variant/.test(el.textContent || ''))
      expect(matches.length).toBeGreaterThan(0)
    })
  })
})
