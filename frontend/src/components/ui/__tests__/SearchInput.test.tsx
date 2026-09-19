import React from 'react'
import { render, screen } from '@testing-library/react'
import SearchInput from '../SearchInput'

describe('SearchInput', () => {
  it('renders placeholder', () => {
    render(<SearchInput placeholder="Find" />)
    expect(screen.getByPlaceholderText('Find')).toBeInTheDocument()
  })
})
