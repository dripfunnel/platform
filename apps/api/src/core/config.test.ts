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
    for (const key of ['EMAIL_LOCAL', 'SMS_LOCAL', 'DNS_LOCAL', 'COURIERS_LOCAL'] as const) {
      expect(() => parseConfig({ ...hosts, [key]: '1' }), key).toThrow(new RegExp(`${key} is for local development only`))
      expect(parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', EMAIL_SUPPRESSION_KEY: key43, [key]: '1' })[key], key).toBe('1')
      expect(() => parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', [key]: 'yes' }), key).toThrow()
    }
  })

  it('takes CODE_CHECK=0 on dev and localhost only', () => {
    expect(() => parseConfig({ ...hosts, CODE_CHECK: '0' })).toThrow(/CODE_CHECK=0 is for dev and local development only/)
    expect(parseConfig({ ...hosts, HOOKS_HOST: 'dev-hooks.dripfunnel.ai', CODE_CHECK: '0' }).CODE_CHECK).toBe('0')
    expect(parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', CODE_CHECK: '0' }).CODE_CHECK).toBe('0')
    expect(parseConfig({ ...hosts, CODE_CHECK: '1' }).CODE_CHECK).toBe('1')
  })

  it('asks for the suppression key with the email stand-in, as SES does', () => {
    expect(() => parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', EMAIL_LOCAL: '1' })).toThrow(/EMAIL_LOCAL needs EMAIL_SUPPRESSION_KEY/)
  })

  it('takes Stripe’s publishable key only in its secret key’s mode, and the test-mode pair only together', () => {
    expect(parseConfig({ ...hosts, STRIPE_SECRET_KEY: 'rk_test_a', STRIPE_PUBLISHABLE_KEY: 'pk_test_b' }).STRIPE_PUBLISHABLE_KEY).toBe('pk_test_b')
    expect(() => parseConfig({ ...hosts, STRIPE_SECRET_KEY: 'rk_live_a', STRIPE_PUBLISHABLE_KEY: 'pk_test_b' })).toThrow(/STRIPE_PUBLISHABLE_KEY must be in STRIPE_SECRET_KEY’s mode/)
    expect(() => parseConfig({ ...hosts, STRIPE_PUBLISHABLE_KEY: 'pk_test_b' })).toThrow(/mode/)
    expect(() => parseConfig({ ...hosts, STRIPE_TEST_SECRET_KEY: 'sk_test_a' })).toThrow(/go together/)
    expect(() => parseConfig({ ...hosts, STRIPE_TEST_SECRET_KEY: 'sk_live_a', STRIPE_TEST_PUBLISHABLE_KEY: 'pk_test_b' })).toThrow()
    expect(() => parseConfig({ ...hosts, STRIPE_CONNECT_CLIENT_ID: 'acct_1' })).toThrow(/Connect client id/)
  })
})
