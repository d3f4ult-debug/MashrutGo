import { formatSom, normalizeUzPhone, parseUtc, timeAgo } from '../format'

describe('format helpers', () => {
  it('treats naive backend timestamps as UTC, never as browser-local time', () => {
    expect(parseUtc('2026-09-19T05:00:00')).toBe(Date.parse('2026-09-19T05:00:00Z'))
    expect(parseUtc('2026-09-19T10:00:00+05:00')).toBe(Date.parse('2026-09-19T05:00:00Z'))
  })

  it('normalizes Uzbek phone numbers typed in any common form', () => {
    expect(normalizeUzPhone('+998 90 123-45-67')).toBe('+998901234567')
    expect(normalizeUzPhone('901234567')).toBe('+998901234567')
    expect(normalizeUzPhone('+998 +998901234567')).toBe('+998901234567')
  })

  it('formats money and relative ages', () => {
    expect(formatSom(2500)).toMatch(/^2\s500 so‘m$/)
    expect(timeAgo(Date.now() - 30_000)).toBe('30 soniya oldin')
    expect(timeAgo(Date.now() - 5 * 60_000)).toBe('5 daqiqa oldin')
  })
})
