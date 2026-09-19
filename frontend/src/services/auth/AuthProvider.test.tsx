import React, { useEffect } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { AuthProvider, useAuth } from './AuthProvider'

function TestConsumer() {
  const { user, signin, signout, hasRole } = useAuth()
  return (
    <div>
      <div data-testid="user">{user ? user.name : 'no-user'}</div>
      <div data-testid="has-admin">{String(hasRole('admin'))}</div>
      <button onClick={() => signin({ id: '1', name: 'Alice', roles: ['admin'] })}>signin</button>
      <button onClick={() => signout()}>signout</button>
    </div>
  )
}

describe('AuthProvider + useAuth', () => {
  it('starts with no user, allows signin and signout, hasRole works', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    )

    expect(screen.getByTestId('user').textContent).toBe('no-user')
    expect(screen.getByTestId('has-admin').textContent).toBe('false')

    fireEvent.click(screen.getByText('signin'))
    expect(screen.getByTestId('user').textContent).toBe('Alice')
    expect(screen.getByTestId('has-admin').textContent).toBe('true')

    fireEvent.click(screen.getByText('signout'))
    expect(screen.getByTestId('user').textContent).toBe('no-user')
  })
})
