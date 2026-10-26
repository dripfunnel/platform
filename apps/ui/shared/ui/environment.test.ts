import { describe, expect, it } from 'vitest'
import { environmentFor } from './environment'

describe('environmentFor', () => {
  it.each(['admin.dripfunnel.ai', 'platform.dripfunnel.ai'])('is prod on %s and nowhere else', (host) => {
    expect(environmentFor(host)).toBe('prod')
  })

  it.each(['dev-admin.actuateminds.com', 'dev-platform.actuateminds.com'])('is dev on %s', (host) => {
    expect(environmentFor(host)).toBe('dev')
  })

  it.each(['17-admin-shell-admin.actuateminds.com', '12-offers-platform.actuateminds.com'])('is feature on %s', (host) => {
    expect(environmentFor(host)).toBe('feature')
  })

  it.each(['localhost', '127.0.0.1', 'admin.localhost', 'platform.localhost'])('is local on %s', (host) => {
    expect(environmentFor(host)).toBe('local')
  })

  it('never mistakes a look-alike or an unknown host for production', () => {
    for (const host of ['admin.dripfunnel.ai.example.net', 'evil-admin.dripfunnel.ai', 'platform.dripfunnel.ai.evil.net', 'ADMIN.DRIPFUNNEL.AI.attacker.io', 'something.else']) {
      expect(environmentFor(host)).not.toBe('prod')
    }
  })

  it('ignores case on the real hosts', () => {
    expect(environmentFor('Platform.DripFunnel.ai')).toBe('prod')
  })
})
