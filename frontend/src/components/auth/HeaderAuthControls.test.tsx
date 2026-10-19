import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import HeaderAuthControls from './HeaderAuthControls'
import { AuthProvider as ClientAuthProvider } from '@/services/auth/AuthProvider'
import { AuthProvider as SystemAuthProvider } from '@/contexts/AuthContext'
import { MemoryRouter } from 'react-router-dom'

describe('HeaderAuthControls', () => {
  it('renders sign in link when unauthenticated', () => {
    render(
      <MemoryRouter>
        <SystemAuthProvider>
          <ClientAuthProvider>
            <HeaderAuthControls />
          </ClientAuthProvider>
        </SystemAuthProvider>
      </MemoryRouter>
    )
    expect(screen.getByText(/Kirish|Sign in/i)).toBeTruthy()
  })
})
