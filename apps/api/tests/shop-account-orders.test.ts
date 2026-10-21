import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { hashSessionId } from '#auth/session'
import { maxOrderHistoryPage } from '#engine/modules/checkout/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #813: the account's list of orders (storefront ARCHITECTURE §2.1 "The account"), the signed-in customer's own,
// newest first, a page at a time (at most 50), and never another customer's, another store's or a guest's (ACCESS §11).

let db: TestDatabase
let t: Tenants
const hostOf = { india: 'jaipur.shop.example', other: 'surat.shop.example' }
const stores = { india: '', other: '' }
const sessions = { asha: '', ravi: '', ashaSurat: '', meera: '' }
const guestCart = 'a'.repeat(64)
let ashaNumbers: string[] = []

const store = async (name: string, code: string) =>
  (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, ${name}, ${code}, 'IN', 'INR', 'active') returning id`)[0]?.id ?? ''

/** A customer of the store, signed in: the session token the Shop API would have handed back. */
const signedIn = async (storeId: string, email: string) => {
  const [c] = await db.sql<{ id: string }[]>`insert into customer (store_id, email, email_verified_at, status) values (${storeId}, ${email}, now(), 'active') returning id`
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  await db.sql`insert into customer_session (id_hash, store_id, customer_id, created_at, last_seen_at, expires_at) values (${await hashSessionId(token)}, ${storeId}, ${c?.id ?? ''}, now(), now(), now() + interval '1 day')`
  return { id: c?.id ?? '', token }
}

/** A placed order of `quantity` items, `daysAgo` days back; a guest's holds the cart token's hash instead of a customer. */
const placed = async (storeId: string, number: string, daysAgo: number, owner: { customerId: string } | { guestToken: string }, quantity = 1) => {
  const customerId = 'customerId' in owner ? owner.customerId : null
  const tokenHash = 'guestToken' in owner ? await hashSessionId(owner.guestToken) : null
  const [o] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, customer_id, access_token_hash, currency, number, placed_at, subtotal_amount, shipping_amount, tax_amount, total_amount, tax_inclusive)
    values (${storeId}, 'placed', ${customerId}, ${tokenHash}, 'INR', ${number}, now() - make_interval(days => ${daysAgo}), ${quantity * 100000}, 0, 0, ${quantity * 100000}, true)
    returning id
  `
  await db.sql`insert into order_line (order_id, store_id, version_id, product_id, name, quantity, unit_amount, line_total_amount) values (${o?.id ?? ''}, ${storeId}, ${crypto.randomUUID()}, ${crypto.randomUUID()}, 'Kurta', ${quantity}, 100000, ${quantity * 100000})`
  return o?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  stores.india = await store('Jaipur', 'jaipur')
  stores.other = await store('Surat', 'surat')
  const asha = await signedIn(stores.india, 'asha@example.com')
  const ravi = await signedIn(stores.india, 'ravi@example.com')
  // The same person signed up at another store of the same partner: a separate customer there.
  const ashaSurat = await signedIn(stores.other, 'asha@example.com')
  sessions.asha = asha.token
  sessions.ravi = ravi.token
  sessions.ashaSurat = ashaSurat.token
  // More orders than a page holds, for the cap.
  const meera = await signedIn(stores.india, 'meera@example.com')
  sessions.meera = meera.token
  for (let i = 0; i < maxOrderHistoryPage + 5; i += 1) await placed(stores.india, `JP-4${String(i).padStart(3, '0')}`, 40 + i, { customerId: meera.id })
  ashaNumbers = Array.from({ length: 23 }, (_, i) => `JP-${1100 + i}`)
  for (const [i, number] of ashaNumbers.entries()) await placed(stores.india, number, 30 - i, { customerId: asha.id }, i === 22 ? 3 : 1)
  await placed(stores.india, 'JP-2001', 1, { customerId: ravi.id })
  await placed(stores.india, 'JP-3001', 0, { guestToken: guestCart })
  await placed(stores.other, 'SU-1001', 0, { customerId: ashaSurat.id })
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string, who: { host?: string; session?: string; cart?: string } = {}) => {
  const host = who.host ?? hostOf.india
  const headers: Record<string, string> = { ...(who.session ? { 'x-shop-session': who.session } : {}), ...(who.cart ? { 'x-shop-cart': who.cart } : {}) }
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers }), host, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.9', userAgent: null }, allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

type OrderPage = { nodes: { number: string; state: string; placedAt: string; total: { amount: string; currency: string }; itemCount: number }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
const list = async (args: string, who: Parameters<typeof gql>[1]) => {
  const answer = await gql(`{ orderHistory${args} { nodes { number state placedAt total { amount currency } itemCount } pageInfo { hasNextPage endCursor } } }`, who)
  return { page: answer.data?.['orderHistory'] as OrderPage | null | undefined, code: answer.code }
}

describe('the account’s orders', () => {
  it('refuses a signed-out shopper as the account’s changes do, guest cart or not', async () => {
    expect((await list('', {})).code).toBe('SIGNED_OUT')
    expect((await list('', { cart: guestCart })).code).toBe('SIGNED_OUT')
  })

  it('lists the customer’s own orders newest first, a page at a time, and the next page brings the rest in order', async () => {
    const first = (await list('(first: 20)', { session: sessions.asha })).page
    expect(first?.nodes.map((o) => o.number)).toEqual([...ashaNumbers].reverse().slice(0, 20))
    expect(first?.pageInfo.hasNextPage).toBe(true)
    expect(first?.nodes[0]).toMatchObject({ number: 'JP-1122', state: 'placed', total: { amount: '300000', currency: 'INR' }, itemCount: 3 })
    const placedAt = first?.nodes.map((o) => Date.parse(o.placedAt)) ?? []
    expect(placedAt).toEqual([...placedAt].sort((a, b) => b - a))
    const next = (await list(`(first: 20, after: "${first?.pageInfo.endCursor ?? ''}")`, { session: sessions.asha })).page
    expect(next?.nodes.map((o) => o.number)).toEqual([...ashaNumbers].reverse().slice(20))
    expect(next?.pageInfo.hasNextPage).toBe(false)
  })

  it('caps a page at 50 and refuses a cursor it didn’t hand out', async () => {
    expect((await list('(first: 500)', { session: sessions.meera })).page?.nodes).toHaveLength(maxOrderHistoryPage)
    expect((await list('', { session: sessions.meera })).page?.nodes).toHaveLength(maxOrderHistoryPage)
    expect((await list('(first: 5)', { session: sessions.asha })).page?.nodes).toHaveLength(5)
    expect((await list('(after: "not-a-cursor")', { session: sessions.asha })).code).toBe('INVALID_CURSOR')
  })

  it('never shows another customer’s orders, another store’s, or a guest’s order the request holds the cart of', async () => {
    const all = async (who: Parameters<typeof gql>[1]) => {
      const first = (await list('', who)).page
      const rest = first?.pageInfo.hasNextPage ? (await list(`(after: "${first.pageInfo.endCursor ?? ''}")`, who)).page : null
      return [...(first?.nodes ?? []), ...(rest?.nodes ?? [])].map((o) => o.number)
    }
    const asha = await all({ session: sessions.asha, cart: guestCart })
    expect(asha).toHaveLength(23)
    expect(asha).not.toContain('JP-2001')
    expect(asha).not.toContain('JP-3001')
    expect(asha).not.toContain('SU-1001')
    expect(await all({ session: sessions.ravi })).toEqual(['JP-2001'])
    expect(await all({ host: hostOf.other, session: sessions.ashaSurat })).toEqual(['SU-1001'])
    // A session is its own store's: Jaipur's on Surat's shop is no session at all.
    expect((await list('', { host: hostOf.other, session: sessions.asha })).code).toBe('SIGNED_OUT')
  })
})
