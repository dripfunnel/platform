import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { shopCacheKey } from '#apis/shop/cache'
import type { Shopper } from '#auth/shopCaller'
import { portalHostKey, type PortalHostCache } from '#auth/portalHost'
import worker, { PortalProxy } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #637: the portal host → partner lookup is kept in the data centre's cache for 60 s (ARCHITECTURE.md §2).

let db: TestDatabase
let t: Tenants
const hostA = 'store.partner-a.example'
const fresh = 'store.fresh.example'
const ownHost = 'store.dripfunnel.ai'

const env = {
  ADMIN_HOST: 'admin.dripfunnel.ai',
  PLATFORM_HOST: 'platform.dripfunnel.ai',
  HOOKS_HOST: 'hooks.dripfunnel.ai',
  HEALTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  SIGN_IN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CF_VERSION_METADATA: { id: 'test', tag: '' },
}
let waits: Promise<unknown>[] = []
const ctx = { waitUntil: (promise: Promise<unknown>) => void waits.push(promise), passThroughOnException: () => undefined } as unknown as ExecutionContext

// caches.default as a data centre keeps it: each entry for its max-age, read against a clock the test moves.
let now = 0
const kept = new Map<string, { body: string; until: number }>()
const dataCentre: PortalHostCache = {
  match: async (key) => {
    const entry = kept.get(key.url)
    return entry && entry.until > now ? new Response(entry.body) : undefined
  },
  put: async (key, response) => {
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 0)
    kept.set(key.url, { body: await response.text(), until: now + maxAge * 1000 })
  },
}

const brandQuery = (host: string) =>
  new Request(`https://${host}/api/`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `https://${host}`, 'cf-connecting-ip': '203.0.113.5' }, body: JSON.stringify({ query: '{ brand { productName } }' }) })
const answer = async (response: Response) => {
  await Promise.all(waits)
  waits = []
  return { status: response.status, name: response.status === 200 ? ((await response.json()) as { data: { brand: { productName: string } | null } }).data.brand?.productName : undefined }
}
const viaProxy = async (host: string) => answer(await new PortalProxy(ctx, { ...env, HYPERDRIVE: { connectionString: db.url } } as never).fetch(brandQuery(host)))
const viaPublic = async (host: string) => answer(await worker.fetch(brandQuery(host) as Parameters<typeof worker.fetch>[0], { ...env, HYPERDRIVE: { connectionString: db.url } } as never, ctx))
const setStatus = (host: string, status: string) => db.sql`update partner_domain set status = ${status} where host = ${host}`

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  const [ours] = await db.sql<{ id: string }[]>`insert into partner (name) values ('DripFunnel') returning id`
  await db.sql`
    insert into partner_domain (partner_id, kind, host, status, record_type, expected) values
      (${t.partnerA}, 'portal', ${hostA}, 'live', 'CNAME', 'x'),
      (${t.partnerB}, 'portal', ${fresh}, 'waiting', 'CNAME', 'x'),
      (${ours?.id ?? ''}, 'portal', ${ownHost}, 'live', 'CNAME', 'x')
  `
  vi.stubGlobal('caches', { default: dataCentre })
}, 60_000)

afterEach(() => {
  kept.clear()
  now = 0
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await db?.drop()
})

describe('the portal host cache', () => {
  it('answers a second request within 60 s without the database, and asks it again after', async () => {
    expect(await viaProxy(hostA)).toEqual({ status: 200, name: 'Partner A' })
    // Were the domain table read, a domain no longer live would answer 404.
    await setStatus(hostA, 'waiting')
    try {
      now += 59_000
      expect(await viaProxy(hostA)).toEqual({ status: 200, name: 'Partner A' })
      now += 1_000
      expect((await viaProxy(hostA)).status).toBe(404)
    } finally {
      await setStatus(hostA, 'live')
    }
  })

  it('never keeps a host no partner holds: once its domain is live, the next request finds it', async () => {
    expect((await viaProxy(fresh)).status).toBe(404)
    expect(kept.size).toBe(0)
    await setStatus(fresh, 'live')
    expect(await viaProxy(fresh)).toEqual({ status: 200, name: 'Partner B' })
  })

  it('keeps a closed partner’s host for up to 60 s, as the edge lookup does (SAAS.md §8)', async () => {
    await setStatus(fresh, 'live')
    expect(await viaProxy(fresh)).toEqual({ status: 200, name: 'Partner B' })
    await db.sql`update partner set state = 'closed' where id = ${t.partnerB}`
    try {
      expect((await viaProxy(fresh)).status).toBe(200)
      now += 60_000
      expect((await viaProxy(fresh)).status).toBe(404)
    } finally {
      await db.sql`update partner set state = 'draft' where id = ${t.partnerB}`
    }
  })

  it('shares one entry between hosts that differ only in case, under a key no Shop cache key matches', async () => {
    expect(await viaProxy(hostA.toUpperCase())).toEqual({ status: 200, name: 'Partner A' })
    expect([...kept.keys()]).toEqual([portalHostKey(hostA).url])
    const shopper = { context: { storeId: t.storeA1 }, catalogVersion: '1', language: 'en-IN', currency: 'INR', marketId: null } as unknown as Shopper
    const shopKey = await shopCacheKey(new Request(`https://${hostA}/shop-api?query=${encodeURIComponent('{ store { name } }')}`), shopper, hostA)
    expect(shopKey).not.toBeNull()
    expect(new URL(shopKey?.url ?? '').hostname).not.toBe(new URL(portalHostKey(hostA).url).hostname)
  })

  it('serves our own zone’s portal host through the cache too', async () => {
    expect(await viaPublic(ownHost)).toEqual({ status: 200, name: 'DripFunnel' })
    expect([...kept.keys()]).toEqual([portalHostKey(ownHost).url])
  })
})
