import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { selectCatalogExport } from '#db/scoped/catalogExports'
import { withScope, withSystemScope } from '#db/scoped/index'
import { buildReportExport } from '#engine/modules/reports/index'
import { catalogExportDeliverer } from '#jobs/queues/deliverers/catalogExport'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #322 (SAPI 18), parts 2 and 3: Reports' panels (FIRST-RELEASE §10), takings, what sold, markets, tax, suppliers and
// offers over the store's own days, their exports and the custom report builder; Owner and Manager only, behind the plan
// (ACCESS §5.1 `reports.read`, §11).

let db: TestDatabase
let t: Tenants
type Who = 'owner' | 'manager' | 'staff' | 'supplier' | 'other'
const cookies = {} as Record<Who, string>
const plans = { full: '', sales: '', none: '', business: '', customOnly: '', noExport: '' }
const products = { kurta: '', scarf: '' }
let india = ''
let usa = ''
let delta = ''
// 11:30 in Kolkata on 10 October: the last 7 days began at midnight there on the 4th (18:30 UTC on the 3rd).
const now = new Date('2026-10-10T06:00:00Z')

const subscribe = async (storeId: string, partnerId: string, planId: string, currency: string) => {
  await db.sql`update store set plan_id = ${planId} where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${planId}, 1, 'active', 'month', ${currency}, 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
}

interface Line { product: string; seller?: string | null; name: string; quantity: number; total: number; rateBps?: number; tax?: number }
const order = async (storeId: string, number: string, placedAt: string, o: {
  total: number; refunded?: number; tax?: number; paid?: boolean; method?: string; state?: 'placed' | 'cancelled'; currency?: string; market?: string | null; region?: string; test?: boolean
  lines?: Line[]; discounts?: [string, number][]
}) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, payment_state, currency, market_id, email, shipping_address, number, placed_at, subtotal_amount, shipping_amount, tax_amount, total_amount,
      refunded_amount, payment_method, cancelled_at, cancel_reason)
    values (${storeId}, ${o.state ?? 'placed'}, ${o.paid === false ? 'pending' : o.refunded ? 'partly_refunded' : 'paid'}, ${o.currency ?? 'INR'}, ${o.market ?? null}, 'a@example.com',
      ${db.sql.json({ name: 'Buyer', line1: '1 Road', city: 'Town', region: o.region ?? 'MH', country: 'IN' })}, ${number}, ${placedAt}, ${o.total}, 0, ${o.tax ?? 0}, ${o.total},
      ${o.refunded ?? 0}, ${o.method ?? 'stripe'}, ${o.state === 'cancelled' ? placedAt : null}, ${o.state === 'cancelled' ? 'store' : null})
    returning id`
  const id = row?.id ?? ''
  for (const [position, l] of (o.lines ?? [{ product: products.kurta, name: 'Kurta', quantity: 1, total: o.total }]).entries()) {
    await db.sql`insert into order_line (order_id, store_id, seller_id, version_id, product_id, name, quantity, unit_amount, tax_rate_bps, tax_amount, line_total_amount, position)
      select ${id}, ${storeId}, ${l.seller ?? null}, v.id, v.product_id, ${l.name}, ${l.quantity}, ${Math.floor(l.total / l.quantity)}, ${l.rateBps ?? null}, ${l.tax ?? 0}, ${l.total}, ${position}
      from product_version v where v.product_id = ${l.product}`
  }
  for (const [label, amount] of o.discounts ?? []) await db.sql`insert into order_adjustment (order_id, store_id, kind, label, amount) values (${id}, ${storeId}, 'discount', ${label}, ${amount})`
  if (o.test) await db.sql`insert into payment (order_id, store_id, provider, kind, state, amount, currency, mode) values (${id}, ${storeId}, 'stripe', 'card', 'captured', ${o.total}, ${o.currency ?? 'INR'}, 'test')`
}

const gql = async (source: string, who: Who, as: { support?: 'read' } = {}) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = {
    cookie: `${storeCookieName}=${cookies[who]}`,
    [storeHeader]: who === 'other' ? t.storeA2 : t.storeA1,
    ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}),
  }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing = as.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } } } }
    : resolved
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}

const panels = `days timeZone from to previousFrom currency currencies
  takings { orders sales { amount currency } refunds { amount } net { amount } previousNet { amount } previousOrders }
  sold { productId name units amount { amount } }
  markets { marketId name orders amount { amount } }
  tax { by total { amount currency } rows { key orders amount { amount } } }
  offers { name orders discount { amount } amount { amount } }`
const report = async (who: Who, args = 'days: 7', fields = panels) => gql(`{ report(${args}) { ${fields} } }`, who)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set country = 'IN', time_zone = 'Asia/Kolkata', pricing_currency = 'INR' where id = ${t.storeA1}`
  await db.sql`update store set country = 'US', time_zone = 'America/New_York', pricing_currency = 'USD' where id = ${t.storeA2}`
  const plan = async (name: string, keys: string[]) => {
    const [row] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerA}, ${name}, 'live') returning id`
    for (const key of keys) await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) values (${row?.id ?? ''}, ${t.partnerA}, 1, ${key}, true)`
    return row?.id ?? ''
  }
  plans.full = await plan('Pro', ['reports_sales', 'reports_export'])
  plans.sales = await plan('Growth', ['reports_sales'])
  plans.none = await plan('Starter', [])
  // Unpriced plans unlock by name (entitlements.ts), so this one sorts after Growth and Pro.
  plans.business = await plan('Scale', ['reports_sales', 'reports_export', 'reports_custom'])
  plans.customOnly = await plan('Zed', ['reports_custom'])
  plans.noExport = await plan('Zen', ['reports_sales', 'reports_custom'])
  await subscribe(t.storeA1, t.partnerA, plans.full, 'INR')
  await subscribe(t.storeA2, t.partnerA, plans.full, 'USD')

  const person = async (email: string, storeId: string, role: string, seller: string | null = null) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${seller}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  await db.sql`update seller set access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1First}`
  cookies.owner = await person('owner@a1.example', t.storeA1, 'owner')
  cookies.manager = await person('manager@a1.example', t.storeA1, 'manager')
  cookies.staff = await person('staff@a1.example', t.storeA1, 'staff')
  cookies.supplier = await person('anand@a1.example', t.storeA1, 'supplier-admin', t.sellerA1First)
  cookies.other = await person('owner@a2.example', t.storeA2, 'owner')

  const product = async (storeId: string, name: string, seller: string | null = null) => {
    const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, seller_id, name, slug, visibility) values (${storeId}, ${seller}, ${name}, ${name.toLowerCase()}, 'visible') returning id`
    await db.sql`insert into product_version (store_id, product_id, sku, position) values (${storeId}, ${p?.id ?? ''}, ${name}, 0)`
    return p?.id ?? ''
  }
  products.kurta = await product(t.storeA1, 'Kurta')
  products.scarf = await product(t.storeA1, 'Scarf', t.sellerA1First)
  const tee = await product(t.storeA2, 'Tee')
  // Store A2 has its own supplier, market and offer, so a leak in either direction would show.
  delta = (await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status) values (${t.storeA2}, 'Delta Goods', 'vendor-catalogue', 'active') returning id`)[0]?.id ?? ''
  const cap = await product(t.storeA2, 'Cap', delta)
  usa = (await db.sql<{ id: string }[]>`update market set name = 'United States' where store_id = ${t.storeA2} and is_primary returning id`)[0]?.id ?? ''
  // Every store starts with its Home market (migration 0051).
  india = (await db.sql<{ id: string }[]>`update market set name = 'India' where store_id = ${t.storeA1} and is_primary returning id`)[0]?.id ?? ''

  await order(t.storeA1, 'R-1', '2026-10-05T10:00:00Z', {
    total: 10000, refunded: 1000, tax: 1000, market: india, discounts: [['DIWALI10', 500]],
    lines: [
      { product: products.kurta, name: 'Kurta', quantity: 2, total: 6000, rateBps: 1200, tax: 600 },
      { product: products.scarf, seller: t.sellerA1First, name: 'Scarf', quantity: 1, total: 4000, rateBps: 500, tax: 200 },
    ],
  })
  // 01:30 on the 10th in Kolkata: inside the range though it is still the 9th in UTC.
  await order(t.storeA1, 'R-2', '2026-10-09T20:00:00Z', { total: 5000, discounts: [['DIWALI10', 300], ['FREESHIP', 200]] })
  // 22:30 on the 3rd in Kolkata: the period before.
  await order(t.storeA1, 'R-3', '2026-10-03T17:00:00Z', { total: 4000 })
  await order(t.storeA1, 'R-4', '2026-10-06T10:00:00Z', { total: 9000, state: 'cancelled' })
  await order(t.storeA1, 'R-5', '2026-10-06T11:00:00Z', { total: 3000, paid: false, method: 'cod' })
  await order(t.storeA1, 'R-6', '2026-10-06T12:00:00Z', { total: 7000, test: true })
  await order(t.storeA1, 'R-7', '2026-10-07T10:00:00Z', { total: 2000, currency: 'USD' })
  await order(t.storeA2, 'S-1', '2026-10-07T10:00:00Z', { total: 8000, tax: 600, currency: 'USD', region: 'ny', market: usa, lines: [{ product: tee, name: 'Tee', quantity: 4, total: 8000 }] })
  await order(t.storeA2, 'S-2', '2026-10-08T10:00:00Z', {
    total: 3000, tax: 300, currency: 'USD', region: 'CA', discounts: [['SUMMER', 400]],
    lines: [{ product: tee, name: 'Tee', quantity: 1, total: 1500 }, { product: cap, seller: delta, name: 'Cap', quantity: 2, total: 1500 }],
  })
  // 55 offers on one euro order, for the panels' page size.
  await order(t.storeA2, 'S-3', '2026-10-08T11:00:00Z', { total: 9000, currency: 'EUR', lines: [{ product: tee, name: 'Tee', quantity: 1, total: 9000 }], discounts: Array.from({ length: 55 }, (_, i): [string, number] => [`OFFER${String(i).padStart(2, '0')}`, 100 + i]) })
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('the panels', () => {
  it('reports the last 7 of the store’s days in its pricing currency against the 7 before', async () => {
    const r = await report('owner')
    expect(r.errors).toBeUndefined()
    expect(r.data?.['report']).toEqual({
      days: 7,
      timeZone: 'Asia/Kolkata',
      from: '2026-10-03T18:30:00.000Z',
      to: '2026-10-10T06:00:00.000Z',
      previousFrom: '2026-09-26T18:30:00.000Z',
      currency: 'INR',
      currencies: ['INR', 'USD'],
      // R-1 and R-2: never the cancelled, unpaid, test or dollar orders.
      takings: { orders: 2, sales: { amount: '15000', currency: 'INR' }, refunds: { amount: '1000' }, net: { amount: '14000' }, previousNet: { amount: '4000' }, previousOrders: 1 },
      sold: [
        { productId: products.kurta, name: 'Kurta', units: 3, amount: { amount: '11000' } },
        { productId: products.scarf, name: 'Scarf', units: 1, amount: { amount: '4000' } },
      ],
      markets: [{ marketId: india, name: 'India', orders: 1, amount: { amount: '9000' } }, { marketId: null, name: null, orders: 1, amount: { amount: '5000' } }],
      // India's GST by rate; what no line carries (R-1's delivery) last.
      tax: { by: 'rate', total: { amount: '1000', currency: 'INR' }, rows: [{ key: '1200', orders: 1, amount: { amount: '600' } }, { key: '500', orders: 1, amount: { amount: '200' } }, { key: null, orders: 1, amount: { amount: '200' } }] },
      offers: [
        { name: 'DIWALI10', orders: 2, discount: { amount: '800' }, amount: { amount: '14000' } },
        { name: 'FREESHIP', orders: 1, discount: { amount: '200' }, amount: { amount: '5000' } },
      ],
    })
  })

  it('widens to 30 days, reads another currency the store sold in, and limits a panel’s rows', async () => {
    expect((await report('manager', 'days: 30', 'takings { orders net { amount } } sold(first: 1) { name }')).data?.['report']).toEqual({ takings: { orders: 3, net: { amount: '18000' } }, sold: [{ name: 'Kurta' }] })
    expect((await report('owner', 'days: 7, currency: "usd"', 'currency takings { orders sales { amount currency } } offers { name }')).data?.['report']).toEqual({
      currency: 'USD', takings: { orders: 1, sales: { amount: '2000', currency: 'USD' } }, offers: [],
    })
    for (const [args, field] of [['days: 14', 'days'], ['days: 7, currency: "rupees"', 'currency'], ['days: 7, currency: "US"', 'currency']] as const) {
      const refused = await report('owner', args, 'days')
      expect(refused.errors?.[0]?.extensions, args).toMatchObject({ code: 'INVALID_INPUT', field })
    }
    expect((await report('owner', 'days: 7, currency: "US"', 'days')).errors?.[0]?.message).toBe('That isn’t a currency code.')
  })

  it('counts units per supplier, the store’s own first, and never their money', async () => {
    expect((await report('owner', 'days: 7', 'suppliers { supplierId name units }')).data?.['report']).toEqual({
      suppliers: [{ supplierId: null, name: null, units: 3 }, { supplierId: t.sellerA1First, name: 'Anand Textiles', units: 1 }],
    })
  })

  it('goes by state for a US store, and counts nothing of another store', async () => {
    expect((await report('other', 'days: 7', 'currency currencies takings { orders sales { amount } } tax { by total { amount } rows { key amount { amount } } } sold { name units }')).data?.['report']).toEqual({
      currency: 'USD',
      currencies: ['EUR', 'USD'],
      takings: { orders: 2, sales: { amount: '11000' } },
      tax: { by: 'state', total: { amount: '900' }, rows: [{ key: 'NY', amount: { amount: '600' } }, { key: 'CA', amount: { amount: '300' } }] },
      sold: [{ name: 'Tee', units: 5 }, { name: 'Cap', units: 2 }],
    })
  })

  it('keeps each store’s markets, offers and suppliers its own, both ways (ACCESS §11)', async () => {
    const fields = 'markets { marketId name } offers { name } suppliers { supplierId name units }'
    expect((await report('owner', 'days: 7', fields)).data?.['report']).toEqual({
      markets: [{ marketId: india, name: 'India' }, { marketId: null, name: null }],
      offers: [{ name: 'DIWALI10' }, { name: 'FREESHIP' }],
      suppliers: [{ supplierId: null, name: null, units: 3 }, { supplierId: t.sellerA1First, name: 'Anand Textiles', units: 1 }],
    })
    expect((await report('other', 'days: 7', fields)).data?.['report']).toEqual({
      markets: [{ marketId: usa, name: 'United States' }, { marketId: null, name: null }],
      offers: [{ name: 'SUMMER' }],
      suppliers: [{ supplierId: null, name: null, units: 5 }, { supplierId: delta, name: 'Delta Goods', units: 2 }],
    })
  })

  it('answers 5 of a ranked panel’s rows by default and never more than 50', async () => {
    const offers = async (args: string) => ((await report('other', 'days: 7, currency: "EUR"', `offers${args} { name }`)).data?.['report'] as { offers: { name: string }[] }).offers
    expect((await offers('')).map((o) => o.name)).toEqual(['OFFER54', 'OFFER53', 'OFFER52', 'OFFER51', 'OFFER50'])
    expect(await offers('(first: 500)')).toHaveLength(50)
    expect(await offers('(first: 0)')).toHaveLength(1)
    expect((await report('other', 'days: 7, currency: "EUR"', 'tax(first: 500) { rows { key } } suppliers(first: 500) { units }')).data?.['report']).toEqual({ tax: { rows: [] }, suppliers: [{ units: 1 }] })
  })
})

describe('who may read them (ACCESS §5.1, §11)', () => {
  it('refuses Staff and every supplier', async () => {
    expect((await report('staff', 'days: 7', 'days')).code).toBe('FORBIDDEN')
    for (const tier of ['vendor-orders-fulfil', 'vendor-catalogue', 'vendor-stock']) {
      await db.sql`update seller set access_level = ${tier} where id = ${t.sellerA1First}`
      expect((await report('supplier', 'days: 7', 'days')).code, tier).toBe('FORBIDDEN')
    }
    await db.sql`update seller set access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1First}`
  })

  it('locks Reports below the plan that has them, and the supplier panel below export, naming the plan that unlocks it', async () => {
    await subscribe(t.storeA1, t.partnerA, plans.none, 'INR')
    try {
      const refused = await report('owner', 'days: 7', 'days')
      expect(refused.errors?.[0]?.extensions).toMatchObject({ code: 'PLAN_LIMIT', key: 'reports_sales', unlockedBy: { id: plans.sales } })
      expect((await report('manager', 'days: 7', 'days')).code).toBe('PLAN_LIMIT')
      await subscribe(t.storeA1, t.partnerA, plans.sales, 'INR')
      const partial = await report('owner', 'days: 7', 'takings { orders } suppliers { units }')
      expect(partial.errors?.[0]?.extensions).toMatchObject({ code: 'PLAN_LIMIT', key: 'reports_export', unlockedBy: { id: plans.full } })
    } finally {
      await subscribe(t.storeA1, t.partnerA, plans.full, 'INR')
    }
  })

  it('reads in a read-only support session and while the store is past due', async () => {
    expect((await gql('{ report(days: 7) { takings { orders } } }', 'owner', { support: 'read' })).data?.['report']).toEqual({ takings: { orders: 2 } })
    await db.sql`update store set status = 'past_due' where id = ${t.storeA1}`
    try {
      expect((await report('manager', 'days: 7', 'takings { orders }')).data?.['report']).toEqual({ takings: { orders: 2 } })
    } finally {
      await db.sql`update store set status = 'active' where id = ${t.storeA1}`
    }
  })
})

describe('exports and the custom report builder', () => {
  const relay = () => relayDue(db.sql, { 'export.catalog': catalogExportDeliverer(db.sql) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
  const ask = async (who: Who, args: string, as: { support?: 'read' } = {}) => gql(`mutation { exportReport(${args}) }`, who, as)
  const file = async (who: Who, args: string) => {
    const asked = await ask(who, args)
    expect(asked.errors, args).toBeUndefined()
    await relay()
    const read = (await gql(`{ reportExport(id: "${String(asked.data?.['exportReport'])}") { state rows csv } }`, who)).data?.['reportExport'] as { state: string; rows: number; csv: string }
    expect(read.state, args).toBe('done')
    return read.csv.split('\n')
  }

  it('gives each panel’s file over the range shown, read back only by the asker', async () => {
    expect(await file('owner', 'panel: takings, days: 7')).toEqual([
      'order,placed at (UTC),customer,market,total,refunded,net,tax,currency',
      'R-1,2026-10-05T10:00:00.000Z,Buyer,India,100.00,10.00,90.00,10.00,INR',
      'R-2,2026-10-09T20:00:00.000Z,Buyer,,50.00,0.00,50.00,0.00,INR',
    ])
    expect(await file('manager', 'panel: sold, days: 7')).toEqual(['product,units,takings,currency', 'Kurta,3,110.00,INR', 'Scarf,1,40.00,INR'])
    expect(await file('owner', 'panel: markets, days: 7')).toEqual(['market,orders,takings,currency', 'India,1,90.00,INR', ',1,50.00,INR'])
    expect(await file('owner', 'panel: tax, days: 7')).toEqual(['rate,orders,tax,currency', '12%,1,6.00,INR', '5%,1,2.00,INR', ',1,2.00,INR'])
    expect(await file('owner', 'panel: suppliers, days: 7')).toEqual(['supplier,units sold', 'Your own products,3', 'Anand Textiles,1'])
    expect(await file('owner', 'panel: offers, days: 7')).toEqual(['offer,orders,discount,takings,currency', 'DIWALI10,2,8.00,140.00,INR', 'FREESHIP,1,2.00,50.00,INR'])
    expect(await file('other', 'panel: tax, days: 7')).toEqual(['state,orders,tax,currency', 'NY,1,6.00,USD', 'CA,1,3.00,USD'])
    const mine = String((await ask('owner', 'panel: sold, days: 30')).data?.['exportReport'])
    for (const who of ['manager', 'other'] as const) expect((await gql(`{ reportExport(id: "${mine}") { id } }`, who)).data?.['reportExport'], who).toBeNull()
    // The store's other exports never read a report's job.
    expect((await gql(`{ catalogExport(id: "${mine}") { id } }`, 'owner')).data?.['catalogExport']).toBeNull()
    expect(((await gql('{ reportExports { id } }', 'owner')).data?.['reportExports'] as { id: string }[]).map((e) => e.id)).toContain(mine)
    const logged = await db.sql<{ changes: unknown }[]>`select changes from activity_log where action = 'report.exported' and target_id = ${mine}`
    expect(logged[0]?.changes).toEqual([{ field: 'report', before: null, after: '{"panel":"sold","days":30,"currency":"INR","custom":null}', redacted: false }])
  })

  it('builds a custom report a row an order, a line, a product or a customer, on Business', async () => {
    expect((await ask('owner', 'panel: custom, days: 7, custom: { rows: "orders", columns: "basic" }')).errors?.[0]?.extensions).toMatchObject({ code: 'PLAN_LIMIT', key: 'reports_custom', unlockedBy: { id: plans.business } })
    // A partner's plan can carry the builder alone: it is still an export of the sales Reports lock.
    await subscribe(t.storeA1, t.partnerA, plans.customOnly, 'INR')
    expect((await ask('owner', 'panel: custom, days: 7, custom: { rows: "orders", columns: "basic" }')).errors?.[0]?.extensions).toMatchObject({ code: 'PLAN_LIMIT', key: 'reports_sales' })
    await subscribe(t.storeA1, t.partnerA, plans.noExport, 'INR')
    expect((await ask('owner', 'panel: custom, days: 7, custom: { rows: "customers", columns: "basic" }')).errors?.[0]?.extensions).toMatchObject({ code: 'PLAN_LIMIT', key: 'reports_export' })
    await subscribe(t.storeA1, t.partnerA, plans.business, 'INR')
    try {
      expect(await file('owner', 'panel: custom, days: 7, custom: { rows: "orders", columns: "basic" }')).toEqual(['order,placed at (UTC),customer,total,currency', 'R-1,2026-10-05T10:00:00.000Z,Buyer,100.00,INR', 'R-2,2026-10-09T20:00:00.000Z,Buyer,50.00,INR'])
      expect((await file('owner', 'panel: custom, days: 7, custom: { rows: "orders", columns: "lines" }'))).toEqual([
        'order,placed at (UTC),item,option,sku,quantity,unit price,line total,supplier,currency',
        'R-1,2026-10-05T10:00:00.000Z,Kurta,,,2,30.00,60.00,,INR',
        'R-1,2026-10-05T10:00:00.000Z,Scarf,,,1,40.00,40.00,Anand Textiles,INR',
        'R-2,2026-10-09T20:00:00.000Z,Kurta,,,1,50.00,50.00,,INR',
      ])
      expect(await file('owner', 'panel: custom, days: 7, custom: { rows: "products", columns: "stock" }')).toEqual(['product,units,takings,currency,stock left,supplier', 'Kurta,3,110.00,INR,0,', 'Scarf,1,40.00,INR,0,Anand Textiles'])
      await db.sql`update customer set name = 'Priya Shah', tags = '{VIP}' where id = ${t.customerA1}`
      await db.sql`update "order" set customer_id = ${t.customerA1} where store_id = ${t.storeA1} and number = 'R-1'`
      const [group] = await db.sql<{ id: string }[]>`insert into customer_group (store_id, name) values (${t.storeA1}, 'Trade') returning id`
      await db.sql`insert into customer_group_member (group_id, customer_id, store_id) values (${group?.id ?? ''}, ${t.customerA1}, ${t.storeA1})`
      expect(await file('owner', 'panel: custom, days: 7, custom: { rows: "customers", columns: "groups" }')).toEqual(['name,email,orders,spent,currency,groups,tags', 'Priya Shah,priya@example.com,1,90.00,INR,Trade,VIP'])
      for (const custom of ['{ rows: "orders", columns: "stock" }', '{ rows: "shops", columns: "basic" }']) expect((await ask('owner', `panel: custom, days: 7, custom: ${custom}`)).code, custom).toBe('INVALID_INPUT')
      expect((await ask('owner', 'panel: custom, days: 7')).code).toBe('INVALID_INPUT')
      expect((await ask('owner', 'panel: sold, days: 7, custom: { rows: "orders", columns: "basic" }')).code).toBe('INVALID_INPUT')
    } finally {
      await subscribe(t.storeA1, t.partnerA, plans.full, 'INR')
    }
  })

  it('cuts a file at its cap, saying where, and counts only the rows kept', async () => {
    const id = String((await ask('owner', 'panel: sold, days: 7')).data?.['exportReport'])
    const merchant = { caller: { kind: 'person' as const, userId: crypto.randomUUID(), sessionId: '' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' as const }, subscription: 'active' as const }
    const build = (max: number) => withScope(db.sql, merchant, async (tx) => {
      const job = await selectCatalogExport(tx, t.storeA1, id)
      if (!job) throw new Error('no job')
      return buildReportExport(tx, job, max)
    })
    const cut = await build(1)
    expect([cut.rows, cut.truncated, cut.csv.split('\n')]).toEqual([1, true, ['product,units,takings,currency', 'Kurta,3,110.00,INR', 'Cut at 1 rows: pick a shorter range for the rest.']])
    const whole = await build(2)
    expect([whole.rows, whole.truncated, whole.csv.split('\n').at(-1)]).toEqual([2, false, 'Scarf,1,40.00,INR'])
  })

  it('refuses Staff, suppliers, a plan without export and a read-only support session; allows a past-due store', async () => {
    for (const who of ['staff', 'supplier'] as const) {
      expect((await ask(who, 'panel: sold, days: 7')).code, who).toBe('FORBIDDEN')
      expect((await gql('{ reportExports { id } }', who)).code, who).toBe('FORBIDDEN')
    }
    expect((await ask('owner', 'panel: sold, days: 7', { support: 'read' })).code).toBe('FORBIDDEN')
    await subscribe(t.storeA1, t.partnerA, plans.sales, 'INR')
    try {
      expect((await ask('owner', 'panel: sold, days: 7')).errors?.[0]?.extensions).toMatchObject({ code: 'PLAN_LIMIT', key: 'reports_export' })
    } finally {
      await subscribe(t.storeA1, t.partnerA, plans.full, 'INR')
    }
    await db.sql`update store set status = 'past_due' where id = ${t.storeA1}`
    try {
      expect((await ask('manager', 'panel: sold, days: 7')).errors).toBeUndefined()
    } finally {
      await db.sql`update store set status = 'active' where id = ${t.storeA1}`
    }
  })
})
