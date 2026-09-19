import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import HeaderAuthControls from './HeaderAuthControls'
import { AuthProvider } from '@/services/auth/AuthProvider'
import { MemoryRouter } from 'react-router-dom'

describe('HeaderAuthControls', () => {
  it('renders sign in link when unauthenticated', () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <HeaderAuthControls />
        </AuthProvider>
      </MemoryRouter>
    )
    expect(screen.getByText(/Sign in/i)).toBeTruthy()
  })
})
