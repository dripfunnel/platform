import { readFileSync } from 'node:fs'
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

  it('refuses the email, SMS, push and DNS stand-ins anywhere but on localhost', () => {
    for (const key of ['EMAIL_LOCAL', 'SMS_LOCAL', 'PUSH_LOCAL', 'DNS_LOCAL', 'COURIERS_LOCAL', 'GITHUB_LOCAL'] as const) {
      expect(() => parseConfig({ ...hosts, [key]: '1' }), key).toThrow(new RegExp(`${key} is for local development only`))
      expect(parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', EMAIL_SUPPRESSION_KEY: key43, [key]: '1' })[key], key).toBe('1')
      expect(() => parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', [key]: 'yes' }), key).toThrow()
    }
  })

  it('takes the GitHub App’s three values together, its key as PEM with escaped or real newlines', () => {
    const app = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '456', GITHUB_APP_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\\nMIIE\\n-----END RSA PRIVATE KEY-----' }
    expect(parseConfig({ ...hosts, ...app }).GITHUB_APP_PRIVATE_KEY).toBe('-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----')
    expect(parseConfig({ ...hosts, ...app }).GITHUB_STORE_ORG).toBe('dripfunnel')
    expect(() => parseConfig({ ...hosts, GITHUB_APP_ID: '123' })).toThrow(/go together/)
    expect(() => parseConfig({ ...hosts, ...app, GITHUB_APP_PRIVATE_KEY: 'not a key' })).toThrow(/PEM private key/)
    expect(() => parseConfig({ ...hosts, ...app, GITHUB_APP_ID: 'my-app' })).toThrow(/numeric id/)
  })

  it('takes CODE_CHECK=0 on any host', () => {
    expect(parseConfig({ ...hosts, CODE_CHECK: '0' }).CODE_CHECK).toBe('0')
    expect(parseConfig({ ...hosts, HOOKS_HOST: 'dev-hooks.dripfunnel.ai', CODE_CHECK: '0' }).CODE_CHECK).toBe('0')
    expect(parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', CODE_CHECK: '0' }).CODE_CHECK).toBe('0')
    expect(parseConfig({ ...hosts, CODE_CHECK: '1' }).CODE_CHECK).toBe('1')
  })

  it('takes SHOP_DOMAIN as a domain apart from the consoles, and my-store.localhost on localhost only', () => {
    expect(parseConfig({ ...hosts, SHOP_DOMAIN: 'my-store.one' }).SHOP_DOMAIN).toBe('my-store.one')
    expect(parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', SHOP_DOMAIN: 'my-store.localhost' }).SHOP_DOMAIN).toBe('my-store.localhost')
    expect(() => parseConfig({ ...hosts, SHOP_DOMAIN: 'my-store.localhost' })).toThrow(/local development only/)
    expect(() => parseConfig({ ...hosts, SHOP_DOMAIN: 'https://my-store.one' })).toThrow(/must be a domain/)
    expect(() => parseConfig({ ...hosts, SHOP_DOMAIN: 'shop.dripfunnel.com' })).toThrow(/apart from the consoles/)
    expect(() => parseConfig({ ...hosts, SHOP_DOMAIN: 'dripfunnel.com' })).toThrow(/apart from the consoles/)
    expect(parseConfig(hosts).SHOP_DOMAIN).toBeUndefined()
  })

  it('asks for the suppression key with the email stand-in, as SES does', () => {
    expect(() => parseConfig({ ...hosts, HOOKS_HOST: 'hooks.localhost', EMAIL_LOCAL: '1' })).toThrow(/EMAIL_LOCAL needs EMAIL_SUPPRESSION_KEY/)
  })

  it('takes an Expo access token, and refuses anything else at boot (THIRD-PARTY-ACCESS §2.13)', () => {
    expect(parseConfig({ ...hosts, EXPO_PUSH_TOKEN: 'aB3_dE5-fG7hI9jK1lM3nO5pQ7rS9tU1' }).EXPO_PUSH_TOKEN).toBe('aB3_dE5-fG7hI9jK1lM3nO5pQ7rS9tU1')
    expect(parseConfig(hosts).EXPO_PUSH_TOKEN).toBeUndefined()
    expect(() => parseConfig({ ...hosts, EXPO_PUSH_TOKEN: 'short' })).toThrow(/EXPO_PUSH_TOKEN must be an Expo access token/)
    expect(() => parseConfig({ ...hosts, EXPO_PUSH_TOKEN: 'Bearer aB3dE5fG7hI9jK1lM3nO5pQ7' })).toThrow(/EXPO_PUSH_TOKEN must be an Expo access token/)
  })

  it('takes Stripe’s publishable key only in its secret key’s mode, and the test-mode pair only together', () => {
    expect(parseConfig({ ...hosts, STRIPE_SECRET_KEY: 'rk_test_a', STRIPE_PUBLISHABLE_KEY: 'pk_test_b' }).STRIPE_PUBLISHABLE_KEY).toBe('pk_test_b')
    expect(() => parseConfig({ ...hosts, STRIPE_SECRET_KEY: 'rk_live_a', STRIPE_PUBLISHABLE_KEY: 'pk_test_b' })).toThrow(/STRIPE_PUBLISHABLE_KEY must be in STRIPE_SECRET_KEY’s mode/)
    expect(() => parseConfig({ ...hosts, STRIPE_PUBLISHABLE_KEY: 'pk_test_b' })).toThrow(/mode/)
    expect(() => parseConfig({ ...hosts, STRIPE_TEST_SECRET_KEY: 'sk_test_a' })).toThrow(/go together/)
    expect(() => parseConfig({ ...hosts, STRIPE_TEST_SECRET_KEY: 'sk_live_a', STRIPE_TEST_PUBLISHABLE_KEY: 'pk_test_b' })).toThrow()
    expect(() => parseConfig({ ...hosts, STRIPE_CONNECT_CLIENT_ID: 'acct_1' })).toThrow(/Connect client id/)
  })

  it('reads past every Durable Object binding wrangler.jsonc declares, so no binding shares a setting’s name (#638)', () => {
    const wrangler = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8')
    const bindings = [...wrangler.matchAll(/\{\s*"name":\s*"([A-Z_]+)",\s*"class_name"/g)].map(([, name]) => name)
    expect(bindings.length).toBeGreaterThan(0)
    expect(() => parseConfig({ ...hosts, ...Object.fromEntries(bindings.map((name) => [name, {}])) })).not.toThrow()
  })
})
