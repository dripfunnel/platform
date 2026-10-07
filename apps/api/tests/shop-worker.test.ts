import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// The Shop API through the Worker itself (#306): a host no store holds, a key for another store, and the
// files a storefront shows, each answered by the route, against a real database.

let db: TestDatabase
let t: Tenants
const files = { photo: '', hidden: '', theirs: '' }
const objects = new Map<string, string>()

const env = () => ({
  ADMIN_HOST: 'admin.dripfunnel.com',
  PLATFORM_HOST: 'platform.dripfunnel.com',
  HOOKS_HOST: 'hooks.dripfunnel.com',
  HYPERDRIVE: { connectionString: db.url },
  HEALTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  SHOP_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CF_VERSION_METADATA: { id: 'test', tag: '' },
  ASSETS: { get: async (key: string) => (objects.has(key) ? { body: new Response(objects.get(key)).body } : null), put: async () => undefined },
})
const ctx = { waitUntil: (promise: Promise<unknown>) => promise, passThroughOnException: () => undefined } as unknown as ExecutionContext
const call = (href: string, init: RequestInit = {}) =>
  worker.fetch(new Request(href, { ...init, headers: { 'cf-connecting-ip': '203.0.113.9', ...init.headers } }) as Parameters<typeof worker.fetch>[0], env() as never, ctx)

const photo = async (storeId: string, visibility: 'visible' | 'hidden') => {
  const slug = `p-${crypto.randomUUID().slice(0, 8)}`
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, ${slug}, ${slug}, ${visibility}) returning id`
  const key = `stores/${storeId}/assets/${crypto.randomUUID()}.png`
  const [a] = await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${storeId}, ${key}, 'image', 'image/png', 5, ${'0'.repeat(64)}) returning id`
  await db.sql`insert into product_photo (product_id, store_id, asset_id, position) values (${p?.id ?? ''}, ${storeId}, ${a?.id ?? ''}, 0)`
  objects.set(key, 'bytes')
  return a?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set pricing_currency = 'INR', status = 'active' where id in (${t.storeA1}, ${t.storeA2})`
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  files.photo = await photo(t.storeA1, 'visible')
  files.hidden = await photo(t.storeA1, 'hidden')
  files.theirs = await photo(t.storeA2, 'visible')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const query = (host: string, headers: Record<string, string> = {}) =>
  call(`https://${host}/shop-api`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ query: '{ store { name } }' }) })

describe('the Shop API through the Worker', () => {
  it('answers a store’s own host, 404 on a host no store holds, and refuses another store’s key', async () => {
    expect(await (await query('store-a1.shops.acme.example')).json()).toEqual({ data: { store: { name: 'Store A1' } } })
    expect((await query('nobody.shops.acme.example')).status).toBe(404)
    const key = (await db.sql<{ k: string }[]>`select public_store_key as k from storefront where store_id = ${t.storeA1}`)[0]?.k ?? ''
    const wrong = await query('store-a2.shops.acme.example', { 'x-shop-key': key })
    expect([wrong.status, ((await wrong.json()) as { errors: { extensions: { code: string } }[] }).errors[0]?.extensions.code]).toEqual([403, 'WRONG_STORE_KEY'])
  })

  it('serves a visible product’s file with its type and safe headers, and nothing else as anything but 404', async () => {
    const served = await call(`https://store-a1.shops.acme.example/shop-api/assets/${files.photo}`)
    expect([served.status, served.headers.get('content-type'), served.headers.get('x-content-type-options'), served.headers.get('content-security-policy'), await served.text()]).toEqual([
      200, 'image/png', 'nosniff', "default-src 'none'", 'bytes',
    ])
    for (const id of [files.hidden, files.theirs, '00000000-0000-4000-8000-000000000000', 'not-an-id']) {
      expect((await call(`https://store-a1.shops.acme.example/shop-api/assets/${id}`)).status).toBe(404)
    }
    expect((await call(`https://store-a1.shops.acme.example/shop-api/assets/${files.photo}`, { method: 'POST' })).status).toBe(405)
  })

  it('serves no file of a suspended store', async () => {
    await db.sql`update store set status = 'suspended', suspended_at = now(), suspended_reason = 'unpaid', suspended_previous_status = 'active' where id = ${t.storeA1}`
    expect((await call(`https://store-a1.shops.acme.example/shop-api/assets/${files.photo}`)).status).toBe(404)
    await db.sql`update store set status = 'active', suspended_at = null, suspended_reason = null, suspended_previous_status = null where id = ${t.storeA1}`
  })
})

describe('the edge cache through the Worker (#442’s review)', () => {
  const kept = new Map<string, Response>()
  const memory = { match: async (key: Request) => kept.get(key.url)?.clone(), put: async (key: Request, response: Response) => void kept.set(key.url, response) }

  it('serves a store its own answer from the cache, never another store’s, by POST and by GET', async () => {
    const globals = globalThis as { caches?: unknown }
    globals.caches = { default: memory }
    try {
      const ask = async (host: string, method: 'POST' | 'GET' = 'POST') => {
        const response = method === 'GET' ? await call(`https://${host}/shop-api?query=${encodeURIComponent('{ menu { label } }')}`) : await query(host)
        return { cache: response.headers.get('x-shop-cache'), control: response.headers.get('cache-control'), body: (await response.json()) as unknown }
      }
      expect(await ask('store-a1.shops.acme.example')).toEqual({ cache: 'miss', control: 'private, no-store', body: { data: { store: { name: 'Store A1' } } } })
      expect(await ask('store-a1.shops.acme.example')).toEqual({ cache: 'hit', control: 'private, no-store', body: { data: { store: { name: 'Store A1' } } } })
      expect(await ask('store-a2.shops.acme.example')).toMatchObject({ cache: 'miss', body: { data: { store: { name: 'Store A2' } } } })
      expect((await ask('store-a2.shops.acme.example', 'GET')).cache).toBe('miss')
      expect((await ask('store-a2.shops.acme.example', 'GET')).cache).toBe('hit')
      // Suspending moves the catalogue version and makes the store unavailable: nothing is served from the cache or kept.
      await db.sql`update store set status = 'suspended', suspended_at = now(), suspended_reason = 'unpaid', suspended_previous_status = 'active' where id = ${t.storeA1}`
      const suspended = await ask('store-a1.shops.acme.example')
      expect([suspended.cache, (suspended.body as { errors: { extensions: { code: string } }[] }).errors[0]?.extensions.code]).toEqual([null, 'STORE_UNAVAILABLE'])
      await db.sql`update store set status = 'active', suspended_at = null, suspended_reason = null, suspended_previous_status = null where id = ${t.storeA1}`
      expect((await ask('store-a1.shops.acme.example')).cache).toBe('miss')
    } finally {
      delete globals.caches
    }
  })
})
