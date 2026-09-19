import React from 'react'
import { render, screen } from '@testing-library/react'
import RouteOverview from '../RouteOverview'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

test('renders route overview for route 15', () => {
  render(
    <MemoryRouter initialEntries={["/route/15"]}>
      <Routes>
        <Route path="/route/:number" element={<RouteOverview />} />
      </Routes>
    </MemoryRouter>
  )

  expect(screen.getByText(/15-sonli Marshrut/i)).toBeTruthy()
  expect(screen.getByText(/Active vehicles/i)).toBeTruthy()
})
