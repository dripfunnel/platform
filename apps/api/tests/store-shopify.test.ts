import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { deleteReadConnection } from '#db/scoped/externalConnections'
import { withSystemScope } from '#db/scoped/index'
import { ShopUnauthorized, ShopUnavailable, type ShopProduct } from '#engine/modules/catalog/index'
import { handleShopifyCallback } from '#hooks/shopify'
import type { ShopifyApi } from '#integrations/shopify/api'
import { catalogImportDeliverer } from '#jobs/queues/deliverers/catalogImport'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #301 (SAPI 16, part 3): Connect Shopify (CATALOG K7), against a Shopify the test answers itself.

let db: TestDatabase
let t: Tenants
let secrets: SecretBox
const now = new Date('2026-10-06T09:00:00Z')
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
type Who = 'owner' | 'manager' | 'staff' | 'supplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', manager: '', staff: '', supplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', manager: '', staff: '', supplier: '', bOwner: '' }

const product = (n: number): ShopProduct => ({
  id: `gid://shopify/Product/${n}`,
  handle: `shop-item-${n}`,
  title: `Shop item ${n}`,
  descriptionHtml: `<p>Item ${n}</p>`,
  status: 'ACTIVE',
  options: [],
  images: [],
  variants: [{ sku: `SHOP-${n}`, barcode: null, price: '100.00', compareAtPrice: null, cost: null, grams: 100, quantity: n, values: [] }],
})
const shopProducts = Array.from({ length: 30 }, (_, i) => product(30 - i))
// One more variant than a product may have: the adapter reads 101 so the check can say so.
const wide: ShopProduct = { ...product(999), options: ['Size', 'Colour'], variants: Array.from({ length: 101 }, (_, i) => ({ sku: `WIDE-${i}`, barcode: null, price: '10.00', compareAtPrice: null, cost: null, grams: null, quantity: null, values: [`S${i % 11}`, `C${Math.floor(i / 11)}`] })) }

// Shops that never run out, each passing one of an import's limits after a few pages (importLimits).
const endlessShops: Record<string, { perPage: number; make: (n: number) => ShopProduct }> = {
  shpat_heavy: { perPage: 2, make: (n) => ({ ...product(n), handle: `heavy-${n}`, descriptionHtml: 'x'.repeat(1024 * 1024) }) },
  shpat_wide: { perPage: 50, make: (n) => ({ ...product(n), handle: `wide-${n}`, options: ['Size'], variants: Array.from({ length: 100 }, (_, i) => ({ sku: `W-${n}-${i}`, barcode: null, price: '1.00', compareAtPrice: null, cost: null, grams: null, quantity: null, values: [`S${i}`] })) }) },
  shpat_many: { perPage: 1000, make: (n) => ({ ...product(n), handle: `many-${n}` }) },
}

// What Shopify would do, per token: `shpat_good` reads the shop, `shpat_revoked` is refused, `down` doesn't answer.
let tokenToIssue = 'shpat_good'
const tokensSeen: string[] = []
const shopify: ShopifyApi = {
  authorizeUrl: (shop, state, redirectUri) => `https://${shop}/admin/oauth/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
  verifyCallback: async (query) => query.get('hmac') === 'signed',
  exchange: async () => {
    if (tokenToIssue === 'no-exchange') throw new ShopUnavailable('exchange')
    return tokenToIssue
  },
  products: async (_shop, token, page) => {
    tokensSeen.push(token)
    if (token === 'shpat_revoked') throw new ShopUnauthorized('revoked')
    if (token === 'down') throw new ShopUnavailable('down')
    if (page.ids) return { products: [...shopProducts, wide].filter((p) => page.ids?.includes(p.id)), next: null }
    const endless = endlessShops[token]
    if (endless) {
      const at = Number(page.after ?? 0)
      return { products: Array.from({ length: endless.perPage }, (_, i) => endless.make(at + i)), next: String(at + endless.perPage) }
    }
    const start = page.after ? Number(page.after) : 0
    const end = start + page.first
    return { products: shopProducts.slice(start, end), next: end < shopProducts.length ? String(end) : null }
  },
}
const shop = { gateway: shopify, redirectUri: 'https://hooks.example/shopify/callback' }

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

const subscribe = async (storeId: string, partnerId: string) => {
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Plan ${storeId.slice(0, 6)}`}, 'live') returning id`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, 'products', 100)`
  await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR' where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
}

const gql = async (source: string, who: Who, variables: Record<string, unknown> = {}, o: { shopify?: typeof shop | null; storeId?: string; support?: boolean } = {}) => {
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: o.storeId ?? (who === 'bOwner' ? t.storeB1 : t.storeA1), ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const acting = o.support && standing.kind === 'acting' ? { ...standing, caller: { ...standing.caller, context: { ...standing.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: 'write' as const } } } } : standing
  const contextValue: StoreContext = { standing: acting, partnerId, sql: db.sql, activity: activityLog, facts, secrets, host: 'kesari.portal.example', shopify: o.shopify === undefined ? shop : o.shopify, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}

const relay = async () => {
  for (let round = 0; round < 12; round++) {
    const counts = await relayDue(db.sql, { 'import.catalog': catalogImportDeliverer(db.sql, shop, secrets, () => now) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
    if (Object.values(counts).every((n) => n === 0)) return
  }
}

const connection = async (who: Who) => (await gql('{ shopifyConnection { available status shop } }', who)).data?.['shopifyConnection'] as { available: boolean; status: string; shop: string | null }
/** Connect as `who`, then come back from Shopify through the hooks host as Shopify would. */
const connect = async (who: Who, shopName: string, back: Record<string, string> = {}) => {
  const asked = await gql('mutation C($s: String!) { connectShopify(shop: $s) }', who, { s: shopName })
  const url = new URL((asked.data?.['connectShopify'] as string | undefined) ?? 'https://x.example')
  const query = new URLSearchParams({ code: 'c1', shop: url.hostname, state: url.searchParams.get('state') ?? '', hmac: 'signed', timestamp: '0', ...back })
  const response = await handleShopifyCallback(new Request(`https://hooks.example/shopify/callback?${query}`), { sql: db.sql, api: shopify, secrets, activity: activityLog, now: () => now })
  // Back on the portal, the person who started it finishes with the callback's one-time key.
  const key = new URL(response.headers.get('location') ?? 'https://x.example').searchParams.get('key')
  const finished = key ? await gql('mutation F($k: String!) { finishShopifyConnect(key: $k) }', who, { k: key }) : null
  return { asked, url, response, key, finished }
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(key)
  await db.sql`update seller set access_level = 'vendor-catalogue' where id = ${t.sellerA1First}`
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia')
  people.staff = await user(t.partnerA, 'staff@a.example', 'Sam')
  people.manager = await user(t.partnerA, 'manager@a.example', 'Mo')
  people.supplier = await user(t.partnerA, 'anand@a.example', 'Anand')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.staff}, ${t.storeA1}, 'staff', 'active'), (${people.manager}, ${t.storeA1}, 'manager', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active')`
  await subscribe(t.storeA1, t.partnerA)
  await subscribe(t.storeB1, t.partnerB)
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('Connect Shopify', () => {
  it('says where it isn’t set up, and never half-connects', async () => {
    expect((await gql('{ shopifyConnection { available status } }', 'owner', {}, { shopify: null })).data?.['shopifyConnection']).toEqual({ available: false, status: 'none' })
    expect((await gql('mutation { connectShopify(shop: "kesari") }', 'owner', {}, { shopify: null })).code).toBe('NOT_AVAILABLE')
    expect((await gql('mutation { connectShopify(shop: "evil.example.com") }', 'owner')).code).toBe('INVALID_SHOP')
    expect((await gql('mutation { connectShopify(shop: "https://169.254.169.254") }', 'owner')).code).toBe('INVALID_SHOP')
  })

  it('sends the owner to approve on their shop, comes back through the hooks host, and keeps the token sealed', async () => {
    const { asked, url, response, finished } = await connect('owner', 'Kesari')
    expect(url.hostname).toBe('kesari.myshopify.com')
    expect(asked.errors).toBeUndefined()
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toMatch(/^https:\/\/kesari\.portal\.example\/products\/import\?shopify=finish&key=[0-9a-f]{64}$/)
    expect(finished?.data?.['finishShopifyConnect']).toBe('kesari.myshopify.com')
    expect(await connection('owner')).toEqual({ available: true, status: 'connected', shop: 'kesari.myshopify.com' })
    const [row] = await db.sql<{ token_sealed: string; state_hash: string | null }[]>`select token_sealed, state_hash from external_connection where store_id = ${t.storeA1} and seller_id is null`
    expect(row?.token_sealed).not.toContain('shpat_good')
    expect(row?.state_hash).toBeNull()
    // The state is used once: the same link again finds nothing to finish.
    const again = await handleShopifyCallback(new Request(`https://hooks.example/shopify/callback?state=${url.searchParams.get('state') ?? ''}&hmac=signed`), { sql: db.sql, api: shopify, secrets, activity: activityLog, now: () => now })
    expect(again.status).toBe(400)
    const logged = await db.sql<{ action: string }[]>`select action from activity_log where action like 'shopify.%' and store_id = ${t.storeA1} order by occurred_at`
    expect(logged.map((l) => l.action)).toEqual(['shopify.connect_started', 'shopify.approved', 'shopify.connected'])
  })

  it('pages the shop’s products for the picker and imports the picked ones through the check', async () => {
    const first = (await gql('{ shopifyProducts { nodes { id title versions } next } }', 'owner')).data?.['shopifyProducts'] as { nodes: { id: string }[]; next: string }
    expect(first.nodes).toHaveLength(25)
    expect(first.next).toBe('25')
    const picked = first.nodes.slice(0, 2).map((n) => n.id)
    const started = await gql('mutation S($ids: [ID!]) { startShopifyImport(productIds: $ids) }', 'owner', { ids: picked })
    await relay()
    const id = started.data?.['startShopifyImport'] as string
    const checked = (await gql('query J($id: ID!) { catalogImport(id: $id) { state source ready } }', 'owner', { id })).data?.['catalogImport']
    expect(checked).toEqual({ state: 'ready', source: 'shopify', ready: 2 })
    await gql('mutation C($id: ID!) { confirmCatalogImport(id: $id, matching: update) }', 'owner', { id })
    await relay()
    expect(await db.sql`select name from product where store_id = ${t.storeA1} and name like 'Shop item%' order by name`).toEqual([{ name: 'Shop item 29' }, { name: 'Shop item 30' }])
    // Once the shop is read the token goes; the next import connects again.
    expect((await connection('owner')).status).toBe('none')
    expect(await db.sql`select reason from activity_log where action = 'shopify.disconnected' and store_id = ${t.storeA1}`).toEqual([{ reason: 'import_read' }])
    expect((await gql('mutation { startShopifyImport(all: true, productIds: ["gid://shopify/Product/1"]) }', 'owner')).code).toBe('INVALID_INPUT')
    expect((await gql('mutation { startShopifyImport(all: true) }', 'owner')).code).toBe('NOT_CONNECTED')
  })

  it('reads every page for “all”', async () => {
    await connect('owner', 'kesari')
    const started = await gql('mutation { startShopifyImport(all: true) }', 'owner')
    await relay()
    const id = started.data?.['startShopifyImport'] as string
    expect((await gql('query J($id: ID!) { catalogImport(id: $id) { ready matched } }', 'owner', { id })).data?.['catalogImport']).toEqual({ ready: 30, matched: 2 })
  })

  it('keeps the connection while another import still reads through it, the last one to finish removing it', async () => {
    await connect('owner', 'kesari')
    const picked = (await gql('mutation S($ids: [ID!]) { startShopifyImport(productIds: $ids) }', 'owner', { ids: ['gid://shopify/Product/1'] })).data?.['startShopifyImport'] as string
    const all = (await gql('mutation { startShopifyImport(all: true) }', 'owner')).data?.['startShopifyImport'] as string
    await relay()
    const read = async (id: string) => (await gql('query J($id: ID!) { catalogImport(id: $id) { state ready problems { code } } }', 'owner', { id })).data?.['catalogImport']
    // The picked one finishes reading first; the other carries on through the same token, never told it expired.
    expect(await read(picked)).toEqual({ state: 'ready', ready: 1, problems: [] })
    expect(await read(all)).toMatchObject({ state: 'ready', ready: 30, problems: [] })
    expect((await connection('owner')).status).toBe('none')
  })

  it('removes the connection when both imports have read their shop, even before either is checked', async () => {
    await connect('owner', 'kesari')
    const ids = [
      (await gql('mutation S($ids: [ID!]) { startShopifyImport(productIds: $ids) }', 'owner', { ids: ['gid://shopify/Product/1'] })).data?.['startShopifyImport'] as string,
      (await gql('mutation { startShopifyImport(all: true) }', 'owner')).data?.['startShopifyImport'] as string,
    ]
    // Only the page reads are delivered; both checks wait, so both imports are still 'checking' with nothing left to read.
    const deliver = catalogImportDeliverer(db.sql, shop, secrets, () => now)
    for (let round = 0; round < 10; round++) {
      const fetches = await db.sql<{ id: string; payload: unknown }[]>`
        update outbox set delivered_at = now() where kind = 'import.catalog' and delivered_at is null and payload->>'phase' = 'fetch' and payload->>'jobId' in ${db.sql(ids)} returning id, payload`
      if (fetches.length === 0) break
      for (const f of fetches) await deliver.deliver({ id: f.id, kind: 'import.catalog', idempotencyKey: f.id, payload: f.payload, partnerId: t.partnerA, storeId: t.storeA1, attempt: 1 }, AbortSignal.timeout(5000))
    }
    expect(await db.sql`select state, cursor from catalog_import where id in ${db.sql(ids)} order by cursor`).toEqual([{ state: 'checking', cursor: 'done' }, { state: 'checking', cursor: 'done' }])
    expect((await connection('owner')).status).toBe('none')
    await relay()
    for (const id of ids) expect((await gql('query J($id: ID!) { catalogImport(id: $id) { state } }', 'owner', { id })).data?.['catalogImport']).toEqual({ state: 'ready' })
  })

  it('removes the token when two imports read their last page at the same moment', async () => {
    await connect('owner', 'kesari')
    const start = async () => (await gql('mutation S($ids: [ID!]) { startShopifyImport(productIds: $ids) }', 'owner', { ids: ['gid://shopify/Product/1'] })).data?.['startShopifyImport'] as string
    const [a, b] = [await start(), await start()]
    const connectionId = (await db.sql<{ id: string }[]>`select id from external_connection where store_id = ${t.storeA1} and seller_id is null`)[0]?.id ?? ''
    // Each marks its own import read, then decides; A holds its transaction open while B decides, as two last pages would.
    const last = (id: string, hold: number) =>
      withSystemScope(db.sql, async (tx) => {
        await tx`update catalog_import set cursor = 'done' where id = ${id}`
        const removed = await deleteReadConnection(tx, connectionId, id)
        await new Promise((resolve) => setTimeout(resolve, hold))
        return removed
      })
    const first = last(a, 300)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const outcomes = await Promise.all([first, last(b, 0)])
    // B waits for A's lock, then sees A's 'done' committed and removes the token: one of the two always does.
    expect(outcomes).toEqual([false, true])
    expect(await db.sql`select 1 from external_connection where id = ${connectionId}`).toEqual([])
  })

  it('stops reading “all” once the shop passes an uploaded file’s limits, and says which', async () => {
    const cases = [['shpat_heavy', 'FILE_TOO_LARGE', 3], ['shpat_wide', 'TOO_MANY_ROWS', 5], ['shpat_many', 'TOO_MANY_PRODUCTS', 6]] as const
    try {
      for (const [token, code, pages] of cases) {
        tokenToIssue = token
        await connect('owner', 'kesari')
        const before = tokensSeen.length
        const id = (await gql('mutation { startShopifyImport(all: true) }', 'owner')).data?.['startShopifyImport'] as string
        await relay()
        const job = (await gql('query J($id: ID!) { catalogImport(id: $id) { state problems { code message } } }', 'owner', { id })).data?.['catalogImport'] as { state: string; problems: { code: string; message: string }[] }
        expect(job.state, token).toBe('unreadable')
        expect(job.problems.map((p) => p.code)).toEqual([code])
        expect(job.problems[0]?.message).toContain('Pick the products')
        // The page that passed the limit is the last one read, and none of it was kept.
        expect(tokensSeen.slice(before).filter((t) => t === token)).toHaveLength(pages)
        const kept = (await db.sql<{ n: number }[]>`select octet_length(file)::int as n from catalog_import where id = ${id}`)[0]?.n ?? 0
        expect(kept).toBeLessThanOrEqual(5 * 1024 * 1024)
      }
    } finally {
      tokenToIssue = 'shpat_good'
    }
  })

  it('refuses a product with more variants than an import takes, naming it, rather than bringing part of it', async () => {
    await connect('owner', 'kesari')
    const started = await gql('mutation S($ids: [ID!]) { startShopifyImport(productIds: $ids) }', 'owner', { ids: ['gid://shopify/Product/999', 'gid://shopify/Product/1'] })
    await relay()
    const job = (await gql('query J($id: ID!) { catalogImport(id: $id) { ready problems { code } } }', 'owner', { id: started.data?.['startShopifyImport'] })).data?.['catalogImport'] as { ready: number; problems: { code: string }[] }
    expect(job.ready).toBe(1)
    expect(job.problems.map((p) => p.code)).toEqual(['TOO_MANY_VERSIONS'])
  })

  it('adds a page delivered twice to the import once', async () => {
    await connect('owner', 'kesari')
    const started = await gql('mutation { startShopifyImport(all: true) }', 'owner')
    const id = started.data?.['startShopifyImport'] as string
    const deliver = catalogImportDeliverer(db.sql, shop, secrets, () => now)
    // The first page's job, delivered, then delivered again as a relay retry after a lost acknowledgement would.
    const [first] = await db.sql<{ id: string; payload: unknown }[]>`
      update outbox set delivered_at = now() where kind = 'import.catalog' and payload->>'jobId' = ${id} and delivered_at is null returning id, payload`
    const effect = { id: first?.id ?? '', kind: 'import.catalog', idempotencyKey: 'k', payload: first?.payload, partnerId: t.partnerA, storeId: t.storeA1, attempt: 1 }
    await deliver.deliver(effect, AbortSignal.timeout(5000))
    await deliver.deliver(effect, AbortSignal.timeout(5000))
    await relay()
    expect((await gql('query J($id: ID!) { catalogImport(id: $id) { ready problemCount } }', 'owner', { id })).data?.['catalogImport']).toMatchObject({ ready: 30, problemCount: 0 })
    const file = (await db.sql<{ n: number }[]>`select count(*)::int as n from catalog_import i, regexp_matches(i.plan::text, '"handle": "shop-item-30"', 'g') where i.id = ${id}`)[0]?.n
    expect(file).toBe(1)
  })

  it('says the connection expired when Shopify refuses its token, and that Shopify is away when it doesn’t answer', async () => {
    tokenToIssue = 'down'
    await connect('owner', 'kesari')
    expect((await gql('{ shopifyProducts { next } }', 'owner')).code).toBe('SHOPIFY_UNAVAILABLE')
    tokenToIssue = 'shpat_revoked'
    await connect('owner', 'kesari')
    expect((await gql('{ shopifyProducts { next } }', 'owner')).code).toBe('EXPIRED')
    expect((await connection('owner')).status).toBe('expired')
    expect((await gql('mutation { startShopifyImport(all: true) }', 'owner')).code).toBe('EXPIRED')
    tokenToIssue = 'shpat_good'
  })

  it('connects only for the person who started it, so a link can’t attach someone else’s shop (login CSRF)', async () => {
    await gql('mutation { disconnectShopify }', 'owner')
    const asked = await gql('mutation C($s: String!) { connectShopify(shop: $s) }', 'owner', { s: 'kesari' })
    const url = new URL(asked.data?.['connectShopify'] as string)
    const query = new URLSearchParams({ code: 'c1', shop: url.hostname, state: url.searchParams.get('state') ?? '', hmac: 'signed', timestamp: '0' })
    const response = await handleShopifyCallback(new Request(`https://hooks.example/shopify/callback?${query}`), { sql: db.sql, api: shopify, secrets, activity: activityLog, now: () => now })
    const key = new URL(response.headers.get('location') ?? '').searchParams.get('key') ?? ''
    // Approved on Shopify but not yet connected: nothing reads the shop until the starter finishes.
    expect((await connection('owner')).status).toBe('pending')
    expect((await gql('{ shopifyProducts { next } }', 'owner')).code).toBe('NOT_CONNECTED')
    for (const who of ['manager', 'supplier', 'bOwner'] as const) {
      expect((await gql('mutation F($k: String!) { finishShopifyConnect(key: $k) }', who, { k: key })).code, who).toBe('NOT_CONNECTED')
    }
    expect((await gql('mutation F($k: String!) { finishShopifyConnect(key: $k) }', 'owner', { k: 'f'.repeat(64) })).code).toBe('NOT_CONNECTED')
    expect((await gql('mutation F($k: String!) { finishShopifyConnect(key: $k) }', 'owner', { k: key })).data?.['finishShopifyConnect']).toBe('kesari.myshopify.com')
    expect((await gql('mutation F($k: String!) { finishShopifyConnect(key: $k) }', 'owner', { k: key })).code).toBe('NOT_CONNECTED')
    expect((await connection('owner')).status).toBe('connected')
  })

  it('refuses a callback whose signature or shop doesn’t match, and forgets the attempt', async () => {
    const forged = await connect('owner', 'kesari', { hmac: 'forged' })
    expect(forged.response.headers.get('location')).toBe('https://kesari.portal.example/products/import?shopify=failed')
    expect((await connection('owner')).status).toBe('none')
    const otherShop = await connect('owner', 'kesari', { shop: 'other.myshopify.com' })
    expect(otherShop.response.headers.get('location')).toContain('shopify=failed')
    tokenToIssue = 'no-exchange'
    try {
      expect((await connect('owner', 'kesari')).response.headers.get('location')).toContain('shopify=failed')
    } finally {
      tokenToIssue = 'shpat_good'
    }
    // Each rejection is on the store's activity as Shopify's, with why, never silently.
    const rejected = await db.sql`select actor_kind, actor_id, result, reason from activity_log where action = 'shopify.callback_rejected' and store_id = ${t.storeA1} order by occurred_at desc limit 3`
    expect(rejected).toEqual([
      { actor_kind: 'provider', actor_id: 'shopify', result: 'failed', reason: 'exchange_failed' },
      { actor_kind: 'provider', actor_id: 'shopify', result: 'failed', reason: 'signature' },
      { actor_kind: 'provider', actor_id: 'shopify', result: 'failed', reason: 'signature' },
    ])
  })

  it('never lets a support session connect, read or import from a shop with the merchant’s token', async () => {
    await connect('owner', 'kesari')
    for (const op of ['{ shopifyConnection { status } }', '{ shopifyProducts { next } }', 'mutation { connectShopify(shop: "kesari") }', 'mutation { finishShopifyConnect(key: "k") }', 'mutation { disconnectShopify }', 'mutation { startShopifyImport(all: true) }'])
      expect((await gql(op, 'owner', {}, { support: true })).code, op).toBe('FORBIDDEN')
    expect((await connection('owner')).status).toBe('connected')
  })

  it('refuses a picker cursor longer than any Shopify gives', async () => {
    await connect('owner', 'kesari')
    expect((await gql('query P($a: String) { shopifyProducts(after: $a) { next } }', 'owner', { a: 'x'.repeat(2001) })).code).toBe('INVALID_INPUT')
  })

  it('forgets a connection left unused for a day', async () => {
    await connect('owner', 'kesari')
    const { deleteAbandonedConnections } = await import('#db/scoped/externalConnections')
    expect(await withSystemScope(db.sql, (tx) => deleteAbandonedConnections(tx, new Date(Date.now() + 2 * 86_400_000)))).toBeGreaterThan(0)
    expect((await connection('owner')).status).toBe('none')
  })

  it('keeps each owner’s connection its own: a supplier’s, the store’s, another store’s', async () => {
    tokensSeen.length = 0
    await connect('owner', 'kesari')
    await connect('supplier', 'anand-crafts')
    expect(await connection('supplier')).toMatchObject({ status: 'connected', shop: 'anand-crafts.myshopify.com' })
    expect(await connection('owner')).toMatchObject({ status: 'connected', shop: 'kesari.myshopify.com' })
    expect((await connection('bOwner')).status).toBe('none')
    expect((await gql('{ shopifyConnection { status } }', 'staff')).code).toBe('FORBIDDEN')
    expect((await gql('{ shopifyConnection { status } }', 'bOwner', {}, { storeId: t.storeA1 })).code).toBe('FORBIDDEN')
    expect((await gql('mutation { disconnectShopify }', 'supplier')).data?.['disconnectShopify']).toBe(true)
    expect((await connection('supplier')).status).toBe('none')
    expect((await connection('owner')).status).toBe('connected')
  })
})
