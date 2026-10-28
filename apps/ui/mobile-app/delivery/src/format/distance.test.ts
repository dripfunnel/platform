import { formatDistance } from './distance'

describe('formatDistance', () => {
  it('shows kilometres to one decimal from 1 km', () => {
    expect(formatDistance(2_400, 'en')).toBe('2.4 km')
    expect(formatDistance(1_000, 'en')).toBe('1 km')
  })

  it('shows whole metres below 1 km', () => {
    expect(formatDistance(800, 'en')).toBe('800 m')
    expect(formatDistance(-5, 'en')).toBe('0 m')
  })
})
