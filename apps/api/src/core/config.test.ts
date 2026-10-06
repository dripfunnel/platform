import { describe, expect, it } from 'vitest'
import { parseConfig } from './config'

const hosts = { ADMIN_HOST: 'admin.dripfunnel.com', PLATFORM_HOST: 'platform.dripfunnel.com', HOOKS_HOST: 'hooks.dripfunnel.com' }

describe('parseConfig', () => {
  it('refuses the local Shopify stand-in anywhere but on localhost, so no deployed Worker skips Shopify’s signature', () => {
    expect(() => parseConfig({ ...hosts, SHOPIFY_LOCAL: '1' })).toThrow(/SHOPIFY_LOCAL is for local development only/)
    expect(parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', SHOPIFY_LOCAL: '1' }).SHOPIFY_LOCAL).toBe('1')
    expect(parseConfig(hosts).SHOPIFY_LOCAL).toBeUndefined()
  })
})
