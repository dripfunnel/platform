import { describe, expect, it } from 'vitest'
import { environmentFor } from './environment'

describe('environmentFor', () => {
  it.each(['admin.dripfunnel.com', 'platform.dripfunnel.com'])('is prod on %s and nowhere else', (host) => {
    expect(environmentFor(host)).toBe('prod')
  })

  it.each(['dev-admin.dripfunnel.ai', 'dev-platform.dripfunnel.ai'])('is dev on %s', (host) => {
    expect(environmentFor(host)).toBe('dev')
  })

  it.each(['17-admin-shell-admin.dripfunnel.ai', '12-offers-platform.dripfunnel.ai'])('is feature on %s', (host) => {
    expect(environmentFor(host)).toBe('feature')
  })

  it.each(['localhost', '127.0.0.1', 'admin.localhost', 'platform.localhost'])('is local on %s', (host) => {
    expect(environmentFor(host)).toBe('local')
  })

  it('never mistakes a look-alike or an unknown host for production', () => {
    for (const host of ['admin.dripfunnel.com.example.net', 'evil-admin.dripfunnel.com', 'platform.dripfunnel.com.evil.net', 'ADMIN.DRIPFUNNEL.COM.attacker.io', 'something.else']) {
      expect(environmentFor(host)).not.toBe('prod')
    }
  })

  it('ignores case on the real hosts', () => {
    expect(environmentFor('Platform.DripFunnel.com')).toBe('prod')
  })
})
