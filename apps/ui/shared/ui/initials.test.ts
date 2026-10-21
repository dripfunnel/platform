import { describe, expect, it } from 'vitest'
import { initials } from './initials'

describe('initials', () => {
  it('takes the first letter of the first two names', () => {
    expect(initials('Arjun Menon')).toBe('AM')
    expect(initials('Maya Ortiz de la Cruz')).toBe('MO')
  })

  it('copes with one name and extra spaces', () => {
    expect(initials('  neha  ')).toBe('N')
  })
})
