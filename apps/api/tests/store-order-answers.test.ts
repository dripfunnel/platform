import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { hiddenFromSupport } from '#apis/store/shopperDetails'
import { handleShopperUpload } from '#apis/store/shopperUploads'
import { linkSigner } from '#auth/signedLink'
import { handleSupportSession, supportSessionPaths } from '#apis/store/supportSession'
import { hashSessionId } from '#auth/session'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { storeActivityFor, supportCookieName } from '#auth/storeSupport'
import { withScope, withSystemScope } from '#db/scoped/index'
import { selectMerchantExportLines } from '#db/scoped/storeOrders'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1368: an order line's answers through the Store API (DATA-MODEL §7.6, §7.11; ACCESS §7, §8): the merchant side reads
// every line's, a supplier only its own lines' (through order_line_for_supplier), a partner support session sees a shopper's
// own words hidden, and another store sees nothing.

let db: TestDatabase
let t: Tenants
const clock = new Date('2026-11-09T09:00:00Z')
const host = 'store.partner-a.example'
const people = { owner: '', supplier: '', other: '', bOwner: '' }
const seats = { owner: '', supplier: '', other: '', bOwner: '' }
const cookies = { owner: '', supplier: '', other: '', bOwner: '' }
type Who = keyof typeof people
let orderId = ''
let supportCookie = ''
let fileId = ''
const signer = linkSigner(btoa(String.fromCharCode(...new Uint8Array(32).fill(7))), 'shopper-uploads')
const objects = new Map<string, Uint8Array<ArrayBuffer>>()
const bucket = { get: async (key: string) => (objects.has(key) ? { body: new Blob([objects.get(key) ?? new Uint8Array()]).stream() } : null) } as never

const answers = (who: string, text: string, amount: number) => [
  { question: '00000000-0000-4000-8000-000000000001', label: 'Topping', main_label: null, kind: 'choice', choices: [{ choice: '00000000-0000-4000-8000-000000000002', label: 'Cheese', main_label: null, quantity: 1, free: 0, unit: String(amount), amount: String(amount), per: 'item' }], unit: null, amount: String(amount), per: null },
  { question: '00000000-0000-4000-8000-000000000003', label: 'Message', main_label: who, kind: 'text', text, unit: '100', amount: '100', per: 'line' },
]

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set shipping_mode = 'to-shopper', access_level = 'vendor-orders-fulfil' where id in (${t.sellerA1First}, ${t.sellerA1Second})`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'portal', ${host}, 'live', 'CNAME', 'x')`
  const user = async (partnerId: string, email: string) => (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${email}, 'active') returning id`)[0]?.id ?? ''
  const seat = async (userId: string, storeId: string, role: string, sellerId: string | null = null) =>
    (await db.sql<{ id: string }[]>`insert into membership (user_id, store_id, seller_id, role_key, status) values (${userId}, ${storeId}, ${sellerId}, ${role}, 'active') returning id`)[0]?.id ?? ''
  people.owner = await user(t.partnerA, 'owner@a.example')
  people.supplier = await user(t.partnerA, 'anand@a.example')
  people.other = await user(t.partnerA, 'bhatia@a.example')
  people.bOwner = await user(t.partnerB, 'owner@b.example')
  seats.owner = await seat(people.owner, t.storeA1, 'owner')
  seats.supplier = await seat(people.supplier, t.storeA1, 'supplier-admin', t.sellerA1First)
  seats.other = await seat(people.other, t.storeA1, 'supplier-admin', t.sellerA1Second)
  seats.bOwner = await seat(people.bOwner, t.storeB1, 'owner')
  for (const who of Object.keys(people) as Who[]) cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, clock))

  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${t.storeA1}, 'Cake', 'cake', 'visible') returning id`
  const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position) values (${t.storeA1}, ${p?.id ?? ''}, 'C1', 0) returning id`
  const address = { name: 'Asha Rao', line1: '12 MG Road', city: 'Pune', region: null, postalCode: '411001', country: 'IN', phone: null }
  orderId = (await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, payment_state, fulfilment_state, currency, email, shipping_address, billing_address, number, placed_at, subtotal_amount, shipping_amount, tax_amount, total_amount, payment_method)
    values (${t.storeA1}, 'placed', 'pending', 'unfulfilled', 'INR', 'asha@example.com', ${db.sql.json(address)}, ${db.sql.json(address)}, '1001', ${clock}, 100000, 0, 0, 100000, 'cod') returning id`)[0]?.id ?? ''
  const line = async (seller: string | null, position: number, text: string) =>
    db.sql`insert into order_line (order_id, store_id, seller_id, version_id, product_id, name, quantity, unit_amount, discount_amount, tax_amount, line_total_amount, position, answers, unit_extras_amount, line_extras_amount)
      values (${orderId}, ${t.storeA1}, ${seller}, ${v?.id ?? ''}, ${p?.id ?? ''}, 'Cake', 2, 33000, 0, 0, 66100, ${position}, ${db.sql.json(answers('Message', text, 3000))}, 3000, 100)`
  await line(null, 0, 'For the store')
  // The merchant's line also answers an upload question with one file (#1369).
  fileId = crypto.randomUUID()
  const key = `stores/${t.storeA1}/shopper-uploads/${orderId}/${fileId}`
  await db.sql`insert into shopper_upload (id, store_id, order_id, r2_key, mime, bytes, checksum) values (${fileId}, ${t.storeA1}, ${orderId}, ${key}, 'image/png', 4, ${'e'.repeat(64)})`
  objects.set(key, new Uint8Array([1, 2, 3, 4]))
  await db.sql`update order_line set answers = answers || ${db.sql.json([{ question: '00000000-0000-4000-8000-000000000004', label: 'Photo', main_label: null, kind: 'upload', uploads: [fileId], unit: '200', amount: '200', per: 'line' }])} where order_id = ${orderId} and seller_id is null`
  await line(t.sellerA1First, 1, 'For Anand')
  await line(t.sellerA1Second, 2, 'For Bhatia')
  for (const seller of [null, t.sellerA1First, t.sellerA1Second]) {
    await db.sql`insert into order_part (order_id, store_id, seller_id, shipping_mode) values (${orderId}, ${t.storeA1}, ${seller}, ${seller ? 'to-shopper' : 'store'})`
  }
  await db.sql`insert into payment (order_id, store_id, provider, kind, state, amount, currency, mode) values (${orderId}, ${t.storeA1}, 'cod', 'cod', 'pending', 100000, 'INR', 'live')`

  // A partner support session acting in the Owner's seat, entered through the handoff as #202 leaves it.
  const [agent] = await db.sql<{ id: string }[]>`insert into partner_user (partner_id, email, name, role_key, status) values (${t.partnerA}, 'priya@partner-a.example', 'Priya', 'partner-support', 'active') returning id`
  const token = 'support-handoff-token-for-answers'
  await db.sql`insert into support_session (partner_id, store_id, membership_id, partner_user_id, reason, ticket, started_at, expires_at, handoff_hash, handoff_expires_at)
    values (${t.partnerA}, ${t.storeA1}, ${seats.owner}, ${agent?.id ?? ''}, 'Order question', 'ZD-1', ${clock}, ${new Date(clock.getTime() + 3_600_000)}, ${await hashSessionId(token)}, ${new Date(clock.getTime() + 300_000)})`
  const response = await handleSupportSession(
    new Request(`https://${host}${supportSessionPaths.handoff}`, { method: 'POST', body: JSON.stringify({ token }), headers: { origin: `https://${host}`, 'cf-connecting-ip': '203.0.113.7' } }),
    new URL(`https://${host}${supportSessionPaths.handoff}`),
    { sql: db.sql, partnerId: t.partnerA, activity: activityLog, now: () => clock, allowExchange: async () => true, allowRead: async () => true },
  )
  supportCookie = /__Host-portal_support=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? ''
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string, caller: Who | 'support') => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const partnerId = caller === 'bOwner' ? t.partnerB : t.partnerA
  const seller = caller === 'supplier' ? t.sellerA1First : caller === 'other' ? t.sellerA1Second : null
  const headers: Record<string, string> =
    caller === 'support'
      ? { cookie: `${supportCookieName}=${supportCookie}` }
      : { cookie: `${storeCookieName}=${cookies[caller]}`, [storeHeader]: caller === 'bOwner' ? t.storeB1 : t.storeA1, ...(seller ? { [supplierHeader]: seller } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, clock, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: storeActivityFor(standing, activityLog), facts, uploadLinks: await signer, now: () => clock }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, errors: result.errors }
}

type Answer = { question: string; kind: string; text: string | null; amount: { amount: string }; per: string | null; choices: { label: string; quantity: number }[] }
type Part = { lines: { amount: { amount: string }; answers: Answer[] }[] }
const linesOf = async (caller: Who | 'support') => {
  const result = await gql(`{ order(id: "${orderId}") { parts { lines { amount { amount } answers { question kind text amount { amount } per choices { label quantity } } } } } }`, caller)
  expect(result.errors).toBeUndefined()
  const order = result.data?.['order'] as { parts: Part[] } | null
  return order ? order.parts.flatMap((p) => p.lines) : null
}
const texts = (lines: Awaited<ReturnType<typeof linesOf>>) => (lines ?? []).map((l) => l.answers.find((a) => a.kind === 'TEXT')?.text)

describe('an order line’s answers (#1368)', () => {
  it('shows the merchant side every line’s answers, in the store’s main language, with each extra', async () => {
    const lines = await linesOf('owner')
    expect(texts(lines)).toEqual(['For the store', 'For Anand', 'For Bhatia'])
    expect(lines?.[0]?.answers[0]).toMatchObject({ question: 'Topping', kind: 'CHOICE', amount: { amount: '3000' }, choices: [{ label: 'Cheese', quantity: 1 }] })
    // The once-per-line extra is in the line's amount: 33000 × 2 + 100.
    expect(lines?.[0]?.amount).toEqual({ amount: '66100' })
  })

  it('shows a supplier only its own lines’ answers, through its view', async () => {
    expect(texts(await linesOf('supplier'))).toEqual(['For Anand'])
    expect(texts(await linesOf('other'))).toEqual(['For Bhatia'])
    expect((await linesOf('supplier'))?.[0]?.amount).toEqual({ amount: '66100' })
  })

  it('hides a shopper’s own words from a partner support session, never the merchant’s choice names', async () => {
    expect(supportCookie).not.toBe('')
    const lines = await linesOf('support')
    expect(texts(lines)).toEqual([hiddenFromSupport, hiddenFromSupport, hiddenFromSupport])
    expect(lines?.[0]?.answers[0]?.choices[0]?.label).toBe('Cheese')
  })

  it('puts the once-per-line extras in the merchant’s order export, as on the order page', async () => {
    const context = { caller: { kind: 'person' as const, userId: people.owner, sessionId: 's' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' as const }, subscription: 'active' as const }
    const rows = await withScope(db.sql, context, (tx) => selectMerchantExportLines(tx, t.storeA1, 'all', null, 10))
    expect(rows.map((r) => r.line_amount)).toEqual(['66100', '66100', '66100'])
  })

  it('gives the merchant side a 10-minute link to a shopper’s file, and a partner support session none', async () => {
    const filesOf = async (caller: Who | 'support') => {
      const result = await gql(`{ order(id: "${orderId}") { parts { lines { answers { kind files { id mime bytes url } } } } } }`, caller)
      const order = result.data?.['order'] as { parts: { lines: { answers: { kind: string; files: { id: string; mime: string; bytes: number; url: string | null }[] }[] }[] }[] }
      return order.parts.flatMap((p) => p.lines.flatMap((l) => l.answers.flatMap((a) => a.files)))
    }
    const [file] = await filesOf('owner')
    expect(file).toMatchObject({ id: fileId, mime: 'image/png', bytes: 4 })
    expect(file?.url).toMatch(new RegExp(`^/api/shopper-uploads/${t.storeA1}/${fileId}\\.\\d+\\.[A-Za-z0-9_-]{43}$`))
    const open = (url: string, at = clock) => handleShopperUpload(new Request(`https://${host}${url}`), { sql: db.sql, now: () => at, uploadLinks: null }, bucket)
    const serve = async (url: string, at = clock) => handleShopperUpload(new Request(`https://${host}${url}`), { sql: db.sql, now: () => at, uploadLinks: await signer }, bucket)
    const opened = await serve(file?.url ?? '')
    expect(opened.status).toBe(200)
    expect(opened.headers.get('content-type')).toBe('image/png')
    expect(opened.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await opened.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
    // Expired, tampered, or with no key to check it: closed.
    expect((await serve(file?.url ?? '', new Date(clock.getTime() + 11 * 60_000))).status).toBe(404)
    expect((await serve((file?.url ?? '').replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).status).toBe(404)
    expect((await serve((file?.url ?? '').replace(t.storeA1, t.storeB1))).status).toBe(404)
    expect((await open(file?.url ?? '')).status).toBe(404)
    // A suspended store's links close at once; the link is a bearer only while its store is open.
    expect(opened.headers.get('referrer-policy')).toBe('no-referrer')
    await db.sql`update store set status = 'suspended', suspended_at = now(), suspended_reason = 'unpaid', suspended_previous_status = 'active' where id = ${t.storeA1}`
    expect((await serve(file?.url ?? '')).status).toBe(404)
    await db.sql`update store set status = 'active', suspended_at = null, suspended_reason = null, suspended_previous_status = null where id = ${t.storeA1}`
    // Support sees the file is there, never a link; a supplier's own line has no file, and the merchant's line isn't its to see.
    expect((await filesOf('support')).map((f) => f.url)).toEqual([null])
    expect(await filesOf('supplier')).toEqual([])
  })

  it('shows another store nothing', async () => {
    expect(await linesOf('bOwner')).toBeNull()
  })
})
