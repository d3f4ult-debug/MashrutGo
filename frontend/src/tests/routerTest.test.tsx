import React from 'react'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import App from '../App'

describe('All routes integration test', () => {
  const routes = ['/', '/search', '/wallet', '/pay', '/route/15', '/login', '/driver', '/admin', '/uyushma']

  for (const r of routes) {
    it(`navigates to ${r} without throwing`, () => {
      window.history.pushState({}, '', r)
      const { container } = render(<App />)
      expect(container).toBeTruthy()
    })
  }
})
