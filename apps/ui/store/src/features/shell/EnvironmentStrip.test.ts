import { describe, expect, it } from 'vitest'
import { isNonProdHost } from './EnvironmentStrip'

describe('isNonProdHost', () => {
  it.each(['localhost', '127.0.0.1', 'store.localhost', 'dev-store.dripfunnel.dev', '12-offers-store.dripfunnel.dev'])(
    'shows the strip on %s',
    (host) => expect(isNonProdHost(host)).toBe(true),
  )
  it.each(['mystore.dripfunnel.com', 'store.dripfunnel.ai', 'shop.kesarithreads.in', 'evildripfunnel.dev', 'dripfunnel.dev.evil.net'])(
    'hides the strip on %s',
    (host) => expect(isNonProdHost(host)).toBe(false),
  )
})
