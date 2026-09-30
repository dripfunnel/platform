import { describe, expect, it } from 'vitest'
import { plural } from '.'

describe('plural', () => {
  const forms = { one: '{n} day', other: '{n} days' }

  it('uses the locale’s own plural rules', () => {
    expect(plural(forms, 1)).toBe('{n} day')
    expect(plural(forms, 0)).toBe('{n} days')
    expect(plural(forms, 9)).toBe('{n} days')
  })

  it('falls back to other when the locale’s form is missing', () => {
    expect(plural({ other: 'x' }, 1)).toBe('x')
  })
})
