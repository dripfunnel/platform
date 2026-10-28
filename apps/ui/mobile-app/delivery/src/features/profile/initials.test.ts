import { initials } from './initials'

describe('the avatar’s initials', () => {
  it('are the first letters of up to two words', () => {
    expect(initials('Asha Rao')).toBe('AR')
    expect(initials('  asha  kumari rao ')).toBe('AK')
    expect(initials('Asha')).toBe('A')
  })

  it('are a question mark for no name', () => {
    expect(initials('')).toBe('?')
    expect(initials('   ')).toBe('?')
  })
})
