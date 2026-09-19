import React from 'react'
import { render, screen } from '@testing-library/react'
import OfflineIndicator from '../OfflineIndicator'

describe('OfflineIndicator', () => {
  it('renders offline message when offline', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    render(<OfflineIndicator />)
    expect(screen.getByText(/You are offline/)).toBeInTheDocument()
  })
})
