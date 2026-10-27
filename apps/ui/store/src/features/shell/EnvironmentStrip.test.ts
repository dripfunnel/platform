import { describe, expect, it } from 'vitest'
import { isNonProdHost } from './EnvironmentStrip'

describe('isNonProdHost', () => {
  it.each(['localhost', '127.0.0.1', 'store.localhost', 'dev-store.actuateminds.com', '12-offers-store.actuateminds.com'])(
    'shows the strip on %s',
    (host) => expect(isNonProdHost(host)).toBe(true),
  )
  it.each(['mystore.dripfunnel.com', 'store.dripfunnel.ai', 'shop.kesarithreads.in', 'evilactuateminds.com', 'actuateminds.com.evil.net'])(
    'hides the strip on %s',
    (host) => expect(isNonProdHost(host)).toBe(false),
  )
})
