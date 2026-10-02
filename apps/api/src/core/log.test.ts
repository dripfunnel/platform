import { describe, expect, it } from 'vitest'
import { technicalLine, technicalLogKeys } from './log'

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
