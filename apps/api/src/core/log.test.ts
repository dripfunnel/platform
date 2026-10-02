import { describe, expect, it } from 'vitest'
import { failureCode, technicalLine, technicalLogKeys } from './log'

describe('technical logs (LOGGING.md §9)', () => {
  it('carry ids, codes and timings and drop everything else', () => {
    const line = technicalLine({
      event: 'request',
      requestId: 'ray-1',
      api: 'admin',
      host: 'admin.dripfunnel.com',
      status: 200,
      durationMs: 12,
      // Not a key the type allows; a caller that smuggles one in still loses it.
      ...({ email: 'priya@softobotics.com', body: { password: 'x' } } as object),
    })
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(Object.keys(parsed).every((key) => (technicalLogKeys as readonly string[]).includes(key))).toBe(true)
    expect(line).not.toContain('priya')
    expect(line).not.toContain('password')
    expect(parsed).toEqual({ event: 'request', requestId: 'ray-1', api: 'admin', host: 'admin.dripfunnel.com', status: 200, durationMs: 12 })
  })

  it('names no key that could hold personal data', () => {
    for (const key of technicalLogKeys) expect(key).not.toMatch(/email|name|address|phone|ip|agent|body|payload/i)
  })
})

describe('failureCode', () => {
  it('names the class and the code, never the message', () => {
    expect(failureCode(Object.assign(new Error('password authentication failed for user "x"'), { name: 'PostgresError', code: '28P01' }))).toBe('PostgresError:28P01')
    expect(failureCode(Object.assign(new Error('connect ECONNREFUSED 10.0.0.9'), { code: 'ECONNREFUSED' }))).toBe('Error:ECONNREFUSED')
    expect(failureCode(new TypeError('x is not a function'))).toBe('TypeError')
    expect(failureCode(Object.assign(new Error('odd'), { code: 'has spaces and secrets' }))).toBe('Error')
    expect(failureCode('a string')).toBe('string')
  })
})
