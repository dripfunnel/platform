import { describe, expect, it } from 'vitest'
import { parseRetryAfter } from './retryAfter'

const now = new Date('2026-10-29T12:00:00Z')

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('3', now)).toBe(3)
    expect(parseRetryAfter(' 0 ', now)).toBe(0)
  })
  it('reads an HTTP-date as seconds from now', () => {
    expect(parseRetryAfter('Thu, 29 Oct 2026 12:00:30 GMT', now)).toBe(30)
  })
  it('rounds a partial second up and never goes negative', () => {
    expect(parseRetryAfter('Thu, 29 Oct 2026 12:00:00 GMT', new Date(now.getTime() - 500))).toBe(1)
    expect(parseRetryAfter('Thu, 29 Oct 2026 11:00:00 GMT', now)).toBe(0)
  })
  it('gives null for nothing or nonsense', () => {
    for (const value of [null, undefined, '', '  ', 'soon', '-5', '1.5']) expect(parseRetryAfter(value, now)).toBeNull()
  })
})
