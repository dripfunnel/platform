import { describe, expect, it } from 'vitest'
import { isNewerVersion } from './semver'

describe('isNewerVersion', () => {
  it('compares by number', () => {
    expect(isNewerVersion('1.10.0', '1.9.9')).toBe(true)
    expect(isNewerVersion('1.9.9', '1.10.0')).toBe(false)
    expect(isNewerVersion('2.0.0', '2.0.0')).toBe(false)
  })
  it('orders dev builds by run, and a release above its dev builds', () => {
    expect(isNewerVersion('0.0.0-dev.9', '0.0.0-dev.7')).toBe(true)
    expect(isNewerVersion('0.0.0-dev.7', '0.0.0-dev.10')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.0-dev.3')).toBe(true)
    expect(isNewerVersion('1.0.0-dev.3', '1.0.0')).toBe(false)
  })
})
