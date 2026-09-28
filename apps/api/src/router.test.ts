import { describe, expect, it } from 'vitest'
import { resolveArea } from './router'

const config = { ADMIN_HOST: 'admin.dripfunnel.com', PLATFORM_HOST: 'platform.dripfunnel.com', HOOKS_HOST: 'hooks.dripfunnel.com' }
const area = (href: string) => resolveArea(new URL(href), config)

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

  it('serves the Store API on portal hosts', () => {
    expect(area('https://store.partner.com/api')).toBe('store')
    expect(area('https://store.partner.com/api/health')).toBe('store')
  })

  it('serves the Shop API on storefront hosts', () => {
    expect(area('https://acme.shops.partner.com/shop-api')).toBe('shop')
  })

  it('serves webhooks only on the hooks host', () => {
    expect(area('https://hooks.dripfunnel.com/stripe')).toBe('hooks')
    expect(area('https://store.partner.com/stripe')).toBeUndefined()
  })

  it('answers nothing for unknown paths', () => {
    expect(area('https://store.partner.com/')).toBeUndefined()
    expect(area('https://store.partner.com/apix')).toBeUndefined()
  })
})
