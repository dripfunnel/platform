import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext } from '#core/tenancy'
import { withScope } from '#db/scoped/index'
import { StorefrontEdge } from '../src/index'
import { cachePurgeDeliverer } from '#jobs/queues/deliverers/cachePurge'
import { GiveUp, type Effect } from '#jobs/queues/outbox-relay'
import { CloudflareRefused, CloudflareUnavailable } from '#integrations/cloudflare/api'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #317 part 1: the edge Worker's host lookup and its /shop-api door (storefront LIVE-SHOP.md §5), and the best-effort
// purge of its cached lookups.

let db: TestDatabase
let t: Tenants
const shopsA1 = 'store-a1.shops.acme.example'
const shopsA2 = 'store-a2.shops.acme.example'
const customA2 = 'www.a2-shop.example'

const env = () => ({
  ADMIN_HOST: 'admin.dripfunnel.com',
  PLATFORM_HOST: 'platform.dripfunnel.com',
  HOOKS_HOST: 'hooks.dripfunnel.com',
  HYPERDRIVE: { connectionString: db.url },
  HEALTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  SHOP_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CART_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CF_VERSION_METADATA: { id: 'test', tag: '' },
})
const ctx = { waitUntil: (promise: Promise<unknown>) => promise, passThroughOnException: () => undefined } as unknown as ExecutionContext
const edge = () => new StorefrontEdge(ctx, env() as never)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set pricing_currency = 'INR', status = 'active' where id in (${t.storeA1}, ${t.storeA2}, ${t.storeB1})`
  await db.sql`update partner set state = 'live' where id in (${t.partnerA}, ${t.partnerB})`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  await db.sql`insert into custom_domain (store_id, host, status, expected_cname, ownership_token) values (${t.storeA2}, ${customA2}, 'live', 'x', 'y')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const build = async (storeId: string) => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into publish_run (store_id, kind, state, commit, template, core_version, started_by_kind)
    values (${storeId}, 'design', 'live', ${'a'.repeat(40)}, 'linen', '1.0.0', 'system') returning id`
  await db.sql`update storefront set live_build_id = ${run?.id ?? null} where store_id = ${storeId}`
  return run?.id ?? ''
}

describe('the edge Worker’s host lookup', () => {
  it('finds the store, its live build and its state from the shops host or the merchant’s own domain', async () => {
    const buildA1 = await build(t.storeA1)
    expect(await edge().liveHost(shopsA1)).toEqual({ kind: 'store', storeId: t.storeA1, partnerId: t.partnerA, buildId: buildA1, state: 'open', name: 'Store A1', language: expect.any(String), indexNowKey: expect.stringMatching(/^[a-f0-9]{32}$/) })
    expect(await edge().liveHost(shopsA1.toUpperCase())).toMatchObject({ storeId: t.storeA1, buildId: buildA1 })
    // Before its first publish a store has no build to serve.
    expect(await edge().liveHost(customA2)).toMatchObject({ kind: 'store', storeId: t.storeA2, buildId: null })
    expect(await edge().liveHost(shopsA2)).toMatchObject({ kind: 'store', storeId: t.storeA2 })
  })

  it('never answers one store for another’s host, and knows nothing of a host nobody holds', async () => {
    const buildA2 = await build(t.storeA2)
    const a1 = await edge().liveHost(shopsA1)
    const a2 = await edge().liveHost(customA2)
    expect(a1).toMatchObject({ storeId: t.storeA1 })
    expect(a2).toMatchObject({ storeId: t.storeA2, buildId: buildA2 })
    expect(a1).not.toMatchObject({ buildId: buildA2 })
    // Store B1 is the other partner's: it has no address under partner A's wildcard.
    expect(await edge().liveHost('store-b1.shops.acme.example')).toEqual({ kind: 'none' })
    for (const host of ['unknown.example', '*.shops.acme.example', 'shops.acme.example', '127.0.0.1', '', 'store-a1.shops.acme.example.evil.example'])
      expect(await edge().liveHost(host), host).toEqual({ kind: 'none' })
  })

  it('serves past due as usual, the degraded page while suspended, and nothing once offline (SAAS §4.2)', async () => {
    await db.sql`update store set status = 'past_due', past_due_since = now() where id = ${t.storeA1}`
    expect(await edge().liveHost(shopsA1)).toMatchObject({ state: 'open' })
    await db.sql`update store set status = 'suspended', suspended_at = now(), suspended_reason = 'test', suspended_previous_status = 'past_due' where id = ${t.storeA1}`
    expect(await edge().liveHost(shopsA1)).toMatchObject({ state: 'suspended' })
    await db.sql`update store set status = 'cancelled', cancelled_at = now(), suspended_at = null, suspended_reason = null, suspended_previous_status = null where id = ${t.storeA1}`
    expect(await edge().liveHost(shopsA1)).toMatchObject({ state: 'offline' })
    await db.sql`update store set status = 'closed', closed_at = now() where id = ${t.storeA1}`
    expect(await edge().liveHost(shopsA1)).toMatchObject({ state: 'offline' })
    await db.sql`update store set status = 'active', cancelled_at = null, closed_at = null, past_due_since = null where id = ${t.storeA1}`
  })

  it('refuses to answer without a database, so the edge caches nothing', async () => {
    const bare = new StorefrontEdge(ctx, { ...env(), HYPERDRIVE: undefined } as never)
    await expect(bare.liveHost(shopsA1)).rejects.toThrow()
  })
})

describe('who reads the publishing rows', () => {
  it('shows a store’s runs and versions to its own merchant only: never another store, a supplier or a partner', async () => {
    for (const storeId of [t.storeA1, t.storeA2]) {
      const [run] = await db.sql<{ id: string }[]>`select live_build_id as id from storefront where store_id = ${storeId}`
      await db.sql`insert into design_version (store_id, number, commit, template, core_version, build_id, published_at, state)
        values (${storeId}, 1, ${'b'.repeat(40)}, 'linen', '1.0.0', ${run?.id ?? ''}, now(), 'live')`
    }
    const person = { kind: 'person' as const, userId: '00000000-0000-4000-8000-0000000000aa', sessionId: 's' }
    const merchant = (storeId: string): CallerContext => ({ caller: person, partnerId: t.partnerA, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })
    const read = (context: CallerContext) =>
      withScope(db.sql, context, async (tx) => ({
        runs: (await tx<{ store_id: string }[]>`select distinct store_id from publish_run`).map((r) => r.store_id),
        versions: (await tx<{ store_id: string }[]>`select store_id from design_version`).map((r) => r.store_id),
      }))
    expect(await read(merchant(t.storeA1))).toEqual({ runs: [t.storeA1], versions: [t.storeA1] })
    expect(await read(merchant(t.storeA2))).toEqual({ runs: [t.storeA2], versions: [t.storeA2] })
    await expect(read({ ...merchant(t.storeA1), sellerScope: { kind: 'seller', sellerId: t.sellerA1First } })).rejects.toThrow(/permission denied/i)
    await expect(read({ caller: { kind: 'partner-user', partnerUserId: '00000000-0000-4000-8000-0000000000bb' }, partnerId: t.partnerA })).rejects.toThrow(/permission denied/i)
    // The merchant side only reads them: jobs write (DATA-MODEL §7.8).
    await expect(withScope(db.sql, merchant(t.storeA1), (tx) => tx`update publish_run set error = 'x' where store_id = ${t.storeA1}`)).rejects.toThrow(/permission denied/i)
    await expect(withScope(db.sql, merchant(t.storeA1), (tx) => tx`delete from design_version where store_id = ${t.storeA1}`)).rejects.toThrow(/permission denied/i)
  })
})

describe('the edge’s door to the API', () => {
  const graphql = (host: string, path = '/shop-api') =>
    new Request(`https://${host}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
      body: JSON.stringify({ query: '{ __typename }' }),
    })

  it('passes /shop-api/* on a storefront host to the Shop API', async () => {
    const response = await edge().fetch(graphql(shopsA1))
    expect(response.status).toBe(200)
  })

  it('answers nothing else, and nothing on our own hosts', async () => {
    expect((await edge().fetch(graphql(shopsA1, '/api'))).status).toBe(404)
    expect((await edge().fetch(graphql(shopsA1, '/'))).status).toBe(404)
    expect((await edge().fetch(graphql('admin.dripfunnel.com'))).status).toBe(404)
    expect((await edge().fetch(graphql('unknown.example'))).status).toBe(404)
  })
})

describe('cache.purge', () => {
  const effect = (payload: unknown): Effect => ({ id: 'e', kind: 'cache.purge', idempotencyKey: 'k', payload, partnerId: null, storeId: null, attempt: 1 })

  it('purges the tags of every payload the producers queue', async () => {
    const purged: string[][] = []
    const deliverer = cachePurgeDeliverer({ purgeTags: async (tags) => void purged.push([...tags]) })
    await deliverer.deliver(effect({ storeId: t.storeA1, host: 'WWW.Shop.example', reason: 'domain-live' }), new AbortController().signal)
    await deliverer.deliver(effect({ storeId: t.storeA1, rule: 'suspended' }), new AbortController().signal)
    await deliverer.deliver(effect({ partnerId: t.partnerA, reason: 'branding' }), new AbortController().signal)
    expect(purged).toEqual([[`df-store-${t.storeA1}`, 'df-host-www.shop.example'], [`df-store-${t.storeA1}`], [`df-partner-${t.partnerA}`]])
  })

  it('gives up on a payload it can’t read or Cloudflare refuses, and lets the outbox retry an outage', async () => {
    const ok = cachePurgeDeliverer({ purgeTags: async () => undefined })
    await expect(ok.deliver(effect({ reason: 'x' }), new AbortController().signal)).rejects.toBeInstanceOf(GiveUp)
    await expect(ok.deliver(effect({ storeId: 'not-a-uuid' }), new AbortController().signal)).rejects.toBeInstanceOf(GiveUp)
    const refused = cachePurgeDeliverer({ purgeTags: () => Promise.reject(new CloudflareRefused('400')) })
    await expect(refused.deliver(effect({ storeId: t.storeA1 }), new AbortController().signal)).rejects.toBeInstanceOf(GiveUp)
    const down = cachePurgeDeliverer({ purgeTags: () => Promise.reject(new CloudflareUnavailable('503')) })
    await expect(down.deliver(effect({ storeId: t.storeA1 }), new AbortController().signal)).rejects.toBeInstanceOf(CloudflareUnavailable)
  })
})
