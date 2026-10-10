import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { mintApiKey } from '#auth/apiKeys'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #330 (SAPI 20), part 1: an API key through the Worker itself, with its two limits (ACCESS §5.6, §9 check 13).

let db: TestDatabase
let t: Tenants
let secret = ''
let addressAllowed = true
const host = 'store.partner-a.example'
const hostB = 'store.partner-b.example'

const env = (overrides: Record<string, unknown> = {}) => ({
  ADMIN_HOST: 'admin.dripfunnel.com',
  PLATFORM_HOST: 'platform.dripfunnel.com',
  HOOKS_HOST: 'hooks.dripfunnel.com',
  HYPERDRIVE: { connectionString: db.url },
  HEALTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  SIGN_IN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  API_RATE_LIMITER: { limit: async () => ({ success: addressAllowed }) },
  CF_VERSION_METADATA: { id: 'test', tag: '' },
  ...overrides,
})
const ctx = { waitUntil: (promise: Promise<unknown>) => promise, passThroughOnException: () => undefined } as unknown as ExecutionContext
const ask = (key: string, h = host, e = env()) =>
  worker.fetch(
    new Request(`https://${h}/api/`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', authorization: `Bearer ${key}` }, body: JSON.stringify({ query: '{ productCounts { all } }' }) }) as Parameters<typeof worker.fetch>[0],
    e as never,
    ctx,
  )

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'portal', ${host}, 'live', 'CNAME', 'x'), (${t.partnerB}, 'portal', ${hostB}, 'live', 'CNAME', 'x')`
  const [owner] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'owner@a.example', 'Olivia', 'active') returning id`
  const minted = await mintApiKey()
  secret = minted.secret
  await db.sql`insert into api_key (store_id, name, prefix, secret_hash, scopes, created_by_user_id) values (${t.storeA1}, 'Worker', ${minted.prefix}, ${minted.hash}, '{catalog.read}', ${owner?.id ?? ''})`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('an API key through the Worker', () => {
  it('calls the Store API with no Origin and no cookie', async () => {
    const response = await ask(secret)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { productCounts: { all: 0 } } })
  })

  it('is answered 404 on a host no partner holds and refused on another partner’s', async () => {
    expect((await ask(secret, 'nobody.example')).status).toBe(404)
    const other = (await (await ask(secret, hostB)).json()) as { errors: { extensions: { code: string } }[] }
    expect(other.errors[0]?.extensions.code).toBe('UNAUTHENTICATED')
  })

  it('answers 429 with Retry-After once the address sends too many, before the key is looked up', async () => {
    addressAllowed = false
    try {
      const response = await ask(secret)
      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('60')
    } finally {
      addressAllowed = true
    }
  })

  it('answers 429 past the store’s calls this minute', async () => {
    await db.sql`update api_usage set minute_used = 1000, minute_start = date_trunc('minute', now()) where store_id = ${t.storeA1}`
    const response = await ask(secret)
    expect(response.status).toBe(429)
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
    await db.sql`update api_usage set minute_used = 0 where store_id = ${t.storeA1}`
  })

  it('refuses every key as misconfigured where the address limiter isn’t bound, rather than skipping it', async () => {
    expect((await ask(secret, host, env({ API_RATE_LIMITER: undefined }))).status).toBe(500)
  })
})
