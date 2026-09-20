import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HeaderAuthControls from './HeaderAuthControls'
import { AuthProvider } from '@/contexts/AuthContext'

describe('HeaderAuthControls', () => {
  beforeEach(() => localStorage.clear())

  it('offers sign-in when there is no session (anonymous use is allowed)', () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <HeaderAuthControls />
        </AuthProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'Kirish' })).toBeInTheDocument()
  })
})
