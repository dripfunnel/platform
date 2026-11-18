import { describe, expect, it } from 'vitest'
import { entryOf, resolveArea } from './router'

const config = { ADMIN_HOST: 'admin.dripfunnel.ai', PLATFORM_HOST: 'platform.dripfunnel.ai', HOOKS_HOST: 'hooks.dripfunnel.ai' }
const area = (href: string) => resolveArea(new URL(href), config, 'public')
const throughProxy = (href: string) => resolveArea(new URL(href), config, 'portal')

describe('resolveArea', () => {
  it('serves the Admin API only on the admin host', () => {
    expect(area('https://admin.dripfunnel.ai/api')).toBe('admin')
    expect(area('https://admin.dripfunnel.ai/shop-api')).toBeUndefined()
    expect(area('https://platform.dripfunnel.ai/api')).not.toBe('admin')
  })

  it('serves the Platform API only on the platform host', () => {
    expect(area('https://platform.dripfunnel.ai/api')).toBe('platform')
    expect(area('https://platform.dripfunnel.ai/shop-api')).toBeUndefined()
  })

  it('serves the Store API on a portal host of our own zone', () => {
    expect(area('https://store.dripfunnel.ai/api')).toBe('store')
    expect(area('https://store.dripfunnel.ai/api/health')).toBe('store')
    expect(resolveArea(new URL('https://store.northstar.localhost/api'), { ADMIN_HOST: 'admin.localhost', PLATFORM_HOST: 'platform.localhost', HOOKS_HOST: 'hooks.localhost' }, 'public')).toBe('store')
  })

  it('serves a partner’s own host nothing on the public fetch, lookalikes of our zone included', () => {
    expect(area('https://store.partner.com/api')).toBeUndefined()
    expect(area('https://store.partner.com/api/health')).toBeUndefined()
    expect(area('https://evildripfunnel.com/api')).toBeUndefined()
    expect(area('https://store.dripfunnel.ai.partner.com/api')).toBeUndefined()
  })

  it('serves the Store API through PortalProxy on a partner’s host, and nothing else', () => {
    expect(throughProxy('https://store.partner.com/api')).toBe('store')
    expect(throughProxy('https://store.partner.com/api/')).toBe('store')
    expect(throughProxy('https://store.partner.com/')).toBeUndefined()
    expect(throughProxy('https://acme.shops.partner.com/shop-api')).toBeUndefined()
  })

  it('still decides by hostname first through PortalProxy: our own hosts answer nothing there', () => {
    expect(throughProxy('https://admin.dripfunnel.ai/api')).toBeUndefined()
    expect(throughProxy('https://platform.dripfunnel.ai/api')).toBeUndefined()
    expect(throughProxy('https://hooks.dripfunnel.ai/stripe')).toBeUndefined()
  })

  it('reads a partner’s host on /api at the default fetch as store-proxy’s portal binding, and nothing else', () => {
    const entry = (href: string) => entryOf(new URL(href), config, 'public')
    expect(entry('https://store.partner.com/api')).toBe('portal')
    expect(entry('https://store.dripfunnel.ai.partner.com/api/')).toBe('portal')
    expect(entry('https://evildripfunnel.com/api')).toBe('portal')
    expect(entry('https://admin.dripfunnel.ai/api')).toBe('public')
    expect(entry('https://store.dripfunnel.ai/api')).toBe('public')
    expect(entry('https://dripfunnel.ai/api')).toBe('public')
    expect(entry('https://store.partner.com/')).toBe('public')
    expect(entryOf(new URL('https://store.partner.com/api'), config, 'edge')).toBe('edge')
  })

  it('reads a store host’s /shop-api, Delivery API and download at the default fetch as store-proxy’s placed call, and nothing else (#1292)', () => {
    const shops = { ...config, SHOP_DOMAIN: 'my-store.one' }
    const entry = (href: string, c = shops) => entryOf(new URL(href), c, 'public')
    for (const host of ['acme.my-store.one', 'acme-preview.my-store.one', 'www.acme.com', 'store.dripfunnel.ai.partner.com']) {
      expect(entry(`https://${host}/shop-api/graphql`)).toBe('edge')
      expect(entry(`https://${host}/delivery-api/`)).toBe('edge')
      expect(entry(`https://${host}/app/delivery.apk`)).toBe('edge')
      expect(entry(`https://${host}/`)).toBe('public')
      expect(entry(`https://${host}/__studio/Ab3_9-xYz0Ab3_9-xYz0Ab/`)).toBe('public')
    }
    // Our own hosts keep the entry they came by, so none of them gains the storefront entry.
    for (const host of ['admin.dripfunnel.ai', 'platform.dripfunnel.ai', 'hooks.dripfunnel.ai', 'store.dripfunnel.ai', 'dripfunnel.ai']) {
      expect(entry(`https://${host}/shop-api/graphql`)).toBe('public')
      expect(entry(`https://${host}/delivery-api/`)).toBe('public')
    }
    // The other entries are never changed.
    expect(entryOf(new URL('https://acme.my-store.one/shop-api'), shops, 'portal')).toBe('portal')
    expect(entryOf(new URL('https://acme.my-store.one/shop-api'), shops, 'edge')).toBe('edge')
    // Locally the shop domain sits inside our zone, so it is named: its hosts are store hosts, the portal and consoles are not.
    const local = { ADMIN_HOST: 'admin.localhost', PLATFORM_HOST: 'platform.localhost', HOOKS_HOST: 'hooks.localhost', SHOP_DOMAIN: 'my-store.localhost' }
    expect(entry('https://acme.my-store.localhost/shop-api/graphql', local)).toBe('edge')
    expect(entry('https://store.northstar.localhost/shop-api/graphql', local)).toBe('public')
    expect(entry('https://admin.localhost/shop-api/graphql', local)).toBe('public')
  })

  it('judges the storefront entry by the same rules as StorefrontEdge: the Delivery API only on a free address, never a preview host (#1292)', () => {
    const shops = { ...config, SHOP_DOMAIN: 'my-store.one' }
    const placed = (href: string) => {
      const url = new URL(href)
      return resolveArea(url, shops, entryOf(url, shops, 'public'))
    }
    expect(placed('https://kesari.my-store.one/shop-api/graphql')).toBe('shop')
    expect(placed('https://kesari-preview.my-store.one/shop-api/graphql')).toBe('shop')
    expect(placed('https://www.kesari.com/shop-api/graphql')).toBe('shop')
    expect(placed('https://kesari.my-store.one/delivery-api/')).toBe('delivery')
    expect(placed('https://kesari.my-store.one/app/delivery.apk')).toBe('delivery')
    expect(placed('https://kesari-preview.my-store.one/delivery-api/')).toBeUndefined()
    expect(placed('https://www.kesari.com/delivery-api/')).toBeUndefined()
    expect(placed('https://kesari.my-store.one/')).toBeUndefined()
    expect(placed('https://admin.dripfunnel.ai/shop-api')).not.toBe('shop')
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
    expect(throughEdge('https://admin.dripfunnel.ai/shop-api')).toBeUndefined()
    expect(throughEdge('https://hooks.dripfunnel.ai/stripe')).toBeUndefined()
  })

  it('serves the studio frame only through StorefrontEdge, never on a portal host or the public entry (AI-STUDIO §8)', () => {
    const frame = '/__studio/Ab3_9-xYz0Ab3_9-xYz0Ab/'
    expect(resolveArea(new URL(`https://abcdefghij.webpreview.store${frame}`), config, 'edge')).toBe('studio')
    expect(resolveArea(new URL(`https://abcdefghij.webpreview.store${frame}shop-api`), config, 'edge')).toBe('studio')
    expect(area(`https://store.partner.com${frame}`)).toBeUndefined()
    expect(resolveArea(new URL(`https://store.partner.com${frame}`), config, 'portal')).toBeUndefined()
    expect(resolveArea(new URL(`https://admin.dripfunnel.ai${frame}`), config, 'edge')).toBeUndefined()
  })

  it('serves the Delivery API only through StorefrontEdge on a store’s free address (DELIVERY §4)', () => {
    const shops = { ...config, SHOP_DOMAIN: 'my-store.one' }
    const throughEdge = (href: string) => resolveArea(new URL(href), shops, 'edge')
    expect(throughEdge('https://kesari.my-store.one/delivery-api')).toBe('delivery')
    expect(throughEdge('https://kesari.my-store.one/delivery-api/')).toBe('delivery')
    expect(throughEdge('https://kesari.my-store.one/delivery-apix')).toBeUndefined()
    expect(throughEdge('https://kesari.my-store.one/app/delivery.apk')).toBe('delivery')
    expect(throughEdge('https://kesari.my-store.one/app/delivery.apk/x')).toBeUndefined()
    expect(throughEdge('https://kesari-preview.my-store.one/app/delivery.apk')).toBeUndefined()
    // Never a preview host, a merchant's own domain, a deeper name, our hosts or the other entries.
    expect(throughEdge('https://kesari-preview.my-store.one/delivery-api/')).toBeUndefined()
    expect(throughEdge('https://www.kesari.com/delivery-api/')).toBeUndefined()
    expect(throughEdge('https://a.kesari.my-store.one/delivery-api/')).toBeUndefined()
    expect(throughEdge('https://admin.dripfunnel.ai/delivery-api/')).toBeUndefined()
    expect(resolveArea(new URL('https://kesari.my-store.one/delivery-api/'), config, 'edge')).toBeUndefined()
    expect(resolveArea(new URL('https://kesari.my-store.one/delivery-api/'), shops, 'public')).toBeUndefined()
    expect(resolveArea(new URL('https://kesari.my-store.one/delivery-api/'), shops, 'portal')).toBeUndefined()
    expect(resolveArea(new URL('https://store.dripfunnel.ai/delivery-api/'), shops, 'public')).toBeUndefined()
  })

  it('serves no other API on /delivery-api, and the Delivery API nowhere else on a store’s address', () => {
    const shops = { ...config, SHOP_DOMAIN: 'my-store.one' }
    expect(resolveArea(new URL('https://kesari.my-store.one/shop-api'), shops, 'edge')).toBe('shop')
    expect(resolveArea(new URL('https://kesari.my-store.one/api'), shops, 'edge')).toBeUndefined()
    for (const host of ['admin.dripfunnel.ai', 'platform.dripfunnel.ai', 'hooks.dripfunnel.ai', 'store.partner.com']) {
      for (const entry of ['public', 'portal', 'edge'] as const) {
        expect(resolveArea(new URL(`https://${host}/delivery-api/`), shops, entry)).not.toBe('delivery')
      }
    }
  })

  it('serves webhooks only on the hooks host', () => {
    expect(area('https://hooks.dripfunnel.ai/stripe')).toBe('hooks')
    expect(area('https://store.partner.com/stripe')).toBeUndefined()
  })

  it('answers nothing for unknown paths', () => {
    expect(area('https://store.dripfunnel.ai/')).toBeUndefined()
    expect(area('https://store.dripfunnel.ai/apix')).toBeUndefined()
  })
})
