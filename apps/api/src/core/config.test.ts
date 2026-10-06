import { describe, expect, it } from 'vitest'
import { parseConfig } from './config'

const key43 = `${'A'.repeat(43)}=`
const hosts = { ADMIN_HOST: 'admin.dripfunnel.com', PLATFORM_HOST: 'platform.dripfunnel.com', HOOKS_HOST: 'hooks.dripfunnel.com' }

describe('parseConfig', () => {
  it('refuses the local Shopify stand-in anywhere but on localhost, so no deployed Worker skips Shopify’s signature', () => {
    expect(() => parseConfig({ ...hosts, SHOPIFY_LOCAL: '1' })).toThrow(/SHOPIFY_LOCAL is for local development only/)
    expect(parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', SHOPIFY_LOCAL: '1' }).SHOPIFY_LOCAL).toBe('1')
    expect(parseConfig(hosts).SHOPIFY_LOCAL).toBeUndefined()
  })

  it('refuses the email, SMS and DNS stand-ins anywhere but on localhost', () => {
    for (const key of ['EMAIL_LOCAL', 'SMS_LOCAL', 'DNS_LOCAL'] as const) {
      expect(() => parseConfig({ ...hosts, [key]: '1' }), key).toThrow(new RegExp(`${key} is for local development only`))
      expect(parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', EMAIL_SUPPRESSION_KEY: key43, [key]: '1' })[key], key).toBe('1')
      expect(() => parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', [key]: 'yes' }), key).toThrow()
    }
  })

  it('asks for the suppression key with the email stand-in, as SES does', () => {
    expect(() => parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', EMAIL_LOCAL: '1' })).toThrow(/EMAIL_LOCAL needs EMAIL_SUPPRESSION_KEY/)
  })
})
