import { render, screen } from '@testing-library/react'
import App from '../App'

vi.mock('@/components/map/AppMap', async () => {
  const { forwardRef } = await import('react')
  return { default: forwardRef(function MapStub() { return null }) }
})

describe('App routing and role guards', () => {
  beforeEach(() => {
    localStorage.clear()
    // No backend in unit tests: every request fails fast like an offline network
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['/driver', '/uyushma', '/admin'])('redirects anonymous visitors from %s to the login page', async (path) => {
    window.history.pushState({}, '', path)
    render(<App />)
    expect(await screen.findByRole('button', { name: /kirish/i })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
  })

  it('renders a 404 page for unknown paths', () => {
    window.history.pushState({}, '', '/no-such-page')
    render(<App />)
    expect(screen.getByText('Sahifa topilmadi')).toBeInTheDocument()
  })
})
