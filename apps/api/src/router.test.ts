import { describe, expect, it } from 'vitest'
import { resolveArea } from './router'

const config = { ADMIN_HOST: 'admin.dripfunnel.com', PLATFORM_HOST: 'platform.dripfunnel.com', HOOKS_HOST: 'hooks.dripfunnel.com' }
const area = (href: string) => resolveArea(new URL(href), config, 'public')
const throughProxy = (href: string) => resolveArea(new URL(href), config, 'portal')

describe('resolveArea', () => {
  it('serves the Admin API only on the admin host', () => {
    expect(area('https://admin.dripfunnel.com/api')).toBe('admin')
    expect(area('https://admin.dripfunnel.com/shop-api')).toBeUndefined()
    expect(area('https://platform.dripfunnel.com/api')).not.toBe('admin')
  })

  it('serves the Platform API only on the platform host', () => {
    expect(area('https://platform.dripfunnel.com/api')).toBe('platform')
    expect(area('https://platform.dripfunnel.com/shop-api')).toBeUndefined()
  })

  it('serves the Store API on a portal host of our own zone', () => {
    expect(area('https://store.dripfunnel.com/api')).toBe('store')
    expect(area('https://store.dripfunnel.com/api/health')).toBe('store')
    expect(resolveArea(new URL('https://store.northstar.localhost/api'), { ADMIN_HOST: 'admin.localhost', PLATFORM_HOST: 'platform.localhost', HOOKS_HOST: 'hooks.localhost' }, 'public')).toBe('store')
  })

  it('serves a partner’s own host nothing on the public fetch, lookalikes of our zone included', () => {
    expect(area('https://store.partner.com/api')).toBeUndefined()
    expect(area('https://store.partner.com/api/health')).toBeUndefined()
    expect(area('https://evildripfunnel.com/api')).toBeUndefined()
    expect(area('https://store.dripfunnel.com.partner.com/api')).toBeUndefined()
  })

  it('serves the Store API through PortalProxy on a partner’s host, and nothing else', () => {
    expect(throughProxy('https://store.partner.com/api')).toBe('store')
    expect(throughProxy('https://store.partner.com/api/')).toBe('store')
    expect(throughProxy('https://store.partner.com/')).toBeUndefined()
    expect(throughProxy('https://acme.shops.partner.com/shop-api')).toBeUndefined()
  })

  it('still decides by hostname first through PortalProxy: our own hosts answer nothing there', () => {
    expect(throughProxy('https://admin.dripfunnel.com/api')).toBeUndefined()
    expect(throughProxy('https://platform.dripfunnel.com/api')).toBeUndefined()
    expect(throughProxy('https://hooks.dripfunnel.com/stripe')).toBeUndefined()
  })

  it('serves the Shop API on storefront hosts', () => {
    expect(area('https://acme.shops.partner.com/shop-api')).toBe('shop')
  })

  it('serves only the Shop API through StorefrontEdge, and never on our own hosts', () => {
    const throughEdge = (href: string) => resolveArea(new URL(href), config, 'edge')
    expect(throughEdge('https://acme.shops.partner.com/shop-api')).toBe('shop')
    expect(throughEdge('https://abcdefghij.webpreview.store/shop-api/graphql')).toBe('shop')
    expect(throughEdge('https://acme.shops.partner.com/api')).toBeUndefined()
    expect(throughEdge('https://acme.shops.partner.com/')).toBeUndefined()
    expect(throughEdge('https://admin.dripfunnel.com/shop-api')).toBeUndefined()
    expect(throughEdge('https://hooks.dripfunnel.com/stripe')).toBeUndefined()
  })

  it('serves webhooks only on the hooks host', () => {
    expect(area('https://hooks.dripfunnel.com/stripe')).toBe('hooks')
    expect(area('https://store.partner.com/stripe')).toBeUndefined()
  })

  it('answers nothing for unknown paths', () => {
    expect(area('https://store.dripfunnel.com/')).toBeUndefined()
    expect(area('https://store.dripfunnel.com/apix')).toBeUndefined()
  })
})
