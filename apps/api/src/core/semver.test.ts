import { describe, expect, it } from 'vitest'
import { isNewerVersion } from './semver'

describe('isNewerVersion', () => {
  it('compares by number', () => {
    expect(isNewerVersion('1.10.0', '1.9.9')).toBe(true)
    expect(isNewerVersion('1.9.9', '1.10.0')).toBe(false)
    expect(isNewerVersion('2.0.0', '2.0.0')).toBe(false)
  })
})
