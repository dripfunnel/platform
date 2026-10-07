import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { PaymentRefused, PaymentUnavailable, type PaymentGateway, type RefundRequest } from '#core/payments'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #310 (SAPI 11), part 3: returns, refunds per owner with the store's override and the supplier ledger, and the money
// going back on the payment it came in on (ACCESS §7.3; DATA-MODEL §7.6; PortalOrders "Returns", "Refunds").

let db: TestDatabase
let t: Tenants
type Who = 'owner' | 'staff' | 'drop' | 'hub'
const cookies = {} as Record<Who, string>
const places = { main: '', drop: '' }
const versions = { house: '', scarf: '', stole: '' }
let stripeAccount = ''

// The provider as the tests set it: each refund asked for, and how it answers.
const asked: RefundRequest[] = []
let answer: 'done' | 'pending' | 'unavailable' | 'refused' = 'done'
const stripe: PaymentGateway = {
  available: () => true,
  start: async () => Promise.reject(new Error('not here')),
  outcome: async () => ({ state: 'pending' }),
  refund: async (account, ref, request) => {
    asked.push(request)
    if (account.externalAccountId !== 'acct_jaipur' || ref !== 'pi_paid') throw new PaymentRefused('not this payment')
    if (answer === 'unavailable') throw new PaymentUnavailable('down')
    if (answer === 'refused') throw new PaymentRefused('declined')
    return { providerRef: `re_${asked.length}`, state: answer }
  },
}

/** A paid order, every line shipped: line totals 2 × 1,000, 1 × 1,500, 1 × 1,000, and 500 of delivery. */
const paidOrder = async (number: string, method: 'stripe' | 'cod') => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, payment_state, fulfilment_state, currency, number, placed_at, paid_at, subtotal_amount, shipping_amount, total_amount, payment_method)
    values (${t.storeA1}, 'placed', 'paid', 'fulfilled', 'INR', ${number}, now(), now(), 4500, 500, 5000, ${method}) returning id`
  const id = row?.id ?? ''
  const lines = [
    { version: versions.house, seller: null, quantity: 2, total: 2000 },
    { version: versions.scarf, seller: t.sellerA1First, quantity: 1, total: 1500 },
    { version: versions.stole, seller: t.sellerA1Second, quantity: 1, total: 1000 },
  ]
  for (const [position, l] of lines.entries()) {
    const [v] = await db.sql<{ product_id: string }[]>`select product_id from product_version where id = ${l.version}`
    await db.sql`insert into order_line (order_id, store_id, seller_id, version_id, product_id, name, quantity, unit_amount, line_total_amount, fulfilled_quantity, position)
      values (${id}, ${t.storeA1}, ${l.seller}, ${l.version}, ${v?.product_id ?? ''}, 'Item', ${l.quantity}, ${l.total / l.quantity}, ${l.total}, ${l.quantity}, ${position})`
  }
  for (const [seller, mode] of [[null, 'store'], [t.sellerA1First, 'to-shopper'], [t.sellerA1Second, 'to-store']] as const) {
    await db.sql`insert into order_part (order_id, store_id, seller_id, shipping_mode, state) values (${id}, ${t.storeA1}, ${seller}, ${mode}, 'shipped')`
  }
  await db.sql`insert into payment (order_id, store_id, provider, provider_account_id, provider_ref, kind, state, amount, currency, mode, captured_at)
    values (${id}, ${t.storeA1}, ${method}, ${method === 'stripe' ? stripeAccount : null}, ${method === 'stripe' ? 'pi_paid' : null}, ${method === 'stripe' ? 'card' : 'cod'}, 'captured', 5000, 'INR', 'live', now())`
  return id
}
const lineOf = async (orderId: string, versionId: string) => (await db.sql<{ id: string }[]>`select id from order_line where order_id = ${orderId} and version_id = ${versionId}`)[0]?.id ?? ''
const orderState = async (id: string) =>
  (await db.sql<{ payment_state: string; refunded_amount: string }[]>`select payment_state, refunded_amount::text from "order" where id = ${id}`)[0]
const onHand = async (versionId: string, warehouseId: string) => (await db.sql<{ on_hand: number }[]>`select on_hand from stock_level where version_id = ${versionId} and warehouse_id = ${warehouseId}`)[0]?.on_hand ?? 0

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set shipping_mode = 'to-shopper', access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1First}`
  await db.sql`update seller set shipping_mode = 'to-store', access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1Second}`
  places.main = (await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${t.storeA1} and seller_id is null and is_default`)[0]?.id ?? ''
  places.drop = (await db.sql<{ id: string }[]>`insert into warehouse (store_id, seller_id, name, is_default) values (${t.storeA1}, ${t.sellerA1First}, 'Anand works', true) returning id`)[0]?.id ?? ''
  await db.sql`insert into warehouse (store_id, seller_id, name, is_default) values (${t.storeA1}, ${t.sellerA1Second}, 'Bhatia mill', true)`
  const version = async (seller: string | null, sku: string) => {
    const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, seller_id, name, slug, visibility) values (${t.storeA1}, ${seller}, ${sku}, ${sku}, 'visible') returning id`
    return (await db.sql<{ id: string }[]>`insert into product_version (store_id, seller_id, product_id, sku, position, track_stock) values (${t.storeA1}, ${seller}, ${p?.id ?? ''}, ${sku}, 0, true) returning id`)[0]?.id ?? ''
  }
  versions.house = await version(null, 'house')
  versions.scarf = await version(t.sellerA1First, 'scarf')
  versions.stole = await version(t.sellerA1Second, 'stole')
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, seller_id, on_hand) values (${versions.house}, ${places.main}, ${t.storeA1}, null, 5)`
  stripeAccount = (await db.sql<{ id: string }[]>`insert into payment_provider_account (store_id, provider, mode, external_account_id) values (${t.storeA1}, 'stripe', 'live', 'acct_jaipur') returning id`)[0]?.id ?? ''

  const person = async (email: string, role: string, seller: string | null = null) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${t.storeA1}, ${seller}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person('owner@a1.example', 'owner')
  cookies.staff = await person('staff@a1.example', 'staff')
  cookies.drop = await person('anand@a1.example', 'supplier-admin', t.sellerA1First)
  cookies.hub = await person('bhatia@a1.example', 'supplier-member', t.sellerA1Second)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const sellerOf: Partial<Record<Who, () => string>> = { drop: () => t.sellerA1First, hub: () => t.sellerA1Second }
const gql = async (source: string, who: Who, as: { support?: 'read' } = {}) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const seller = sellerOf[who]?.()
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: t.storeA1, ...(seller ? { [supplierHeader]: seller } : {}) }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing = as.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } } } }
    : resolved
  const payments = { gateways: { stripe }, stripeConnect: null, stripeTax: () => null, webhookUrl: () => '' }
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, payments, secrets: null, now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
type Line = { id: string; quantity: number; amount?: string }
const refund = (who: Who, orderId: string, lines: Line[], extra = '', as: { support?: 'read' } = {}) =>
  gql(`mutation { refund(orderId: "${orderId}", lines: [${lines.map((l) => `{ lineId: "${l.id}", quantity: ${l.quantity}${l.amount ? `, amount: "${l.amount}"` : ''} }`).join(', ')}]${extra.includes('reason') ? '' : ', reason: returned'}${extra}) }`, who, as)

describe('refunds on a card order', () => {
  let id = ''
  const lines = { house: '', scarf: '', stole: '' }
  beforeAll(async () => {
    id = await paidOrder('A-3001', 'stripe')
    lines.house = await lineOf(id, versions.house)
    lines.scarf = await lineOf(id, versions.scarf)
    lines.stole = await lineOf(id, versions.stole)
  })

  it('gives the store’s own unit back through the provider, its share of the line, and restocks it as returned', async () => {
    const made = await refund('owner', id, [{ id: lines.house, quantity: 1 }], ', restock: true, note: "Torn seam"')
    expect(made.code).toBeUndefined()
    expect(asked.at(-1)?.amount).toEqual({ amount: 1000n, currency: 'INR' })
    expect(await orderState(id)).toEqual({ payment_state: 'partly_refunded', refunded_amount: '1000' })
    expect(await onHand(versions.house, places.main)).toBe(6)
    const [movement] = await db.sql`select delta, reason, source_kind from stock_movement where version_id = ${versions.house}`
    expect(movement).toEqual({ delta: 1, reason: 'returned', source_kind: 'order' })
    const detail = (await gql(`{ order(id: "${id}") { refunds { supplierId override amount { amount } reason note restock paymentState lines { quantity amount { amount } } } parts { lines { refundedQuantity } } history { action } } }`, 'owner')).data?.['order'] as Record<string, unknown>
    expect(detail['refunds']).toEqual([{ supplierId: null, override: false, amount: { amount: '1000' }, reason: 'returned', note: 'Torn seam', restock: true, paymentState: 'done', lines: [{ quantity: 1, amount: { amount: '1000' } }] }])
    expect((detail['history'] as { action: string }[])[0]).toEqual({ action: 'refund.issued' })
  })

  it('keeps a supplier’s lines its own to refund, unless the store overrides, which the ledger records against the supplier', async () => {
    expect((await refund('owner', id, [{ id: lines.scarf, quantity: 1 }])).code).toBe('NOT_YOURS')
    expect((await refund('owner', id, [{ id: lines.scarf, quantity: 1 }], ', override: true')).code).toBeUndefined()
    const ledger = (who: Who, arg = '') => gql(`{ supplierLedger${arg} { entries { amount { amount } kind orderNumber supplierName } balance { amount currency } } }`, who)
    const expected = { entries: [{ amount: { amount: '1500' }, kind: 'refund_override', orderNumber: 'A-3001', supplierName: 'Anand Textiles' }], balance: [{ amount: '1500', currency: 'INR' }] }
    expect((await ledger('owner', `(supplierId: "${t.sellerA1First}")`)).data?.['supplierLedger']).toEqual(expected)
    expect((await ledger('drop', `(supplierId: "${t.sellerA1Second}")`)).data?.['supplierLedger']).toEqual(expected)
    expect((await ledger('hub')).data?.['supplierLedger']).toEqual({ entries: [], balance: [] })
    // Told, with no note and no shopper: the thin entry.
    const seen = (await gql(`{ order(id: "${id}") { refunds { supplierId override note paymentState } history { action note } } }`, 'drop')).data?.['order']
    expect(seen).toEqual({ refunds: [{ supplierId: t.sellerA1First, override: true, note: null, paymentState: null }], history: [{ action: 'refund.overridden', note: null }] })
  })

  it('lets a supplier refund its own lines, up to their value, never another’s or anything beyond them', async () => {
    // Another owner's line answers as one that doesn't exist (ACCESS §7.3).
    expect((await refund('hub', id, [{ id: lines.house, quantity: 1 }])).code).toBe('NOT_FOUND')
    expect((await refund('hub', id, [{ id: crypto.randomUUID(), quantity: 1 }])).code).toBe('NOT_FOUND')
    expect((await refund('hub', id, [{ id: lines.stole, quantity: 1, amount: '1001' }])).code).toBe('TOO_MANY')
    expect((await refund('hub', id, [{ id: lines.stole, quantity: 1 }], ', extra: "100"')).code).toBe('INVALID_INPUT')
    expect((await refund('hub', id, [{ id: lines.stole, quantity: 1 }], ', override: true')).code).toBe('INVALID_INPUT')
    expect((await refund('hub', id, [{ id: lines.stole, quantity: 1, amount: '600' }], ', restock: true')).code).toBeUndefined()
    expect(await orderState(id)).toEqual({ payment_state: 'partly_refunded', refunded_amount: '3100' })
    const [made] = await db.sql`select seller_id, override_of_seller_id, amount::text from refund where order_id = ${id} and seller_id = ${t.sellerA1Second}`
    expect(made).toEqual({ seller_id: t.sellerA1Second, override_of_seller_id: null, amount: '600' })
    // The rest of its line is money only now, since its one unit has gone back.
    expect((await refund('hub', id, [{ id: lines.stole, quantity: 1 }])).code).toBe('TOO_MANY')
    expect((await refund('hub', id, [{ id: lines.stole, quantity: 0, amount: '401' }])).code).toBe('TOO_MANY')
  })

  it('keeps nothing when the provider is down or refuses, and asks again with the same refund id', async () => {
    answer = 'unavailable'
    expect((await refund('owner', id, [{ id: lines.house, quantity: 1 }])).code).toBe('PROVIDER_UNAVAILABLE')
    const first = asked.at(-1)?.refundId
    answer = 'refused'
    expect((await refund('owner', id, [{ id: lines.house, quantity: 1 }])).code).toBe('PROVIDER_REFUSED')
    expect(asked.at(-1)?.refundId).toBe(first)
    expect(await orderState(id)).toEqual({ payment_state: 'partly_refunded', refunded_amount: '3100' })
    expect(await db.sql`select 1 from refund where order_id = ${id}`).toHaveLength(3)
    answer = 'pending'
    expect((await refund('owner', id, [{ id: lines.house, quantity: 1 }])).code).toBeUndefined()
    expect(asked.at(-1)?.refundId).toBe(first)
    answer = 'done'
  })

  it('gives the delivery back as the store’s own, and the order is refunded once everything has gone back', async () => {
    expect((await refund('owner', id, [], ', extra: "901", reason: goodwill')).code).toBe('TOO_MANY')
    const calls = asked.length
    expect((await refund('owner', id, [{ id: lines.stole, quantity: 0, amount: '400' }], ', extra: "500", reason: goodwill, override: true')).code).toBeUndefined()
    // Two owners' refunds, one provider refund: all of the money goes back or none of it.
    expect(asked.slice(calls).map((r) => r.amount.amount)).toEqual([900n])
    const atProvider = await db.sql<{ provider_ref: string; amount: string }[]>`select p.provider_ref, p.amount::text from payment_refund p join refund f on f.id = p.refund_id where f.order_id = ${id} and f.reason = 'goodwill' order by p.amount`
    expect(atProvider).toEqual([{ provider_ref: `re_${asked.length}`, amount: '400' }, { provider_ref: `re_${asked.length}`, amount: '500' }])
    expect(await orderState(id)).toEqual({ payment_state: 'refunded', refunded_amount: '5000' })
    expect((await db.sql`select state from payment where order_id = ${id}`)[0]?.['state']).toBe('refunded')
    expect((await refund('owner', id, [], ', extra: "1", reason: goodwill')).code).toBe('NOT_PAID')
  })

  it('never starts a return of units already refunded outside one', async () => {
    expect((await gql(`mutation { startReturn(orderId: "${id}", lines: [{ lineId: "${lines.house}", quantity: 1 }], reason: damaged) }`, 'owner')).code).toBe('TOO_MANY')
  })
})

describe('returns, then refunds on a cash order', () => {
  let id = ''
  const lines = { house: '', scarf: '' }
  let returnId = ''
  beforeAll(async () => {
    id = await paidOrder('A-3101', 'cod')
    lines.house = await lineOf(id, versions.house)
    lines.scarf = await lineOf(id, versions.scarf)
  })

  it('starts a return the store’s alone, each line back to its owner’s location, a supplier told without the note', async () => {
    const start = (who: Who, quantity: number) =>
      gql(`mutation { startReturn(orderId: "${id}", lines: [{ lineId: "${lines.house}", quantity: ${quantity} }, { lineId: "${lines.scarf}", quantity: 1 }], reason: damaged, note: "Shopper rang") }`, who)
    expect((await start('owner', 3)).code).toBe('TOO_MANY')
    expect((await start('drop', 1)).code).toBe('FORBIDDEN')
    expect((await start('staff', 1)).code).toBe('FORBIDDEN')
    const made = await start('owner', 1)
    expect(made.code).toBeUndefined()
    returnId = made.data?.['startReturn'] as string
    const detail = (await gql(`{ order(id: "${id}") { returns { number state reason note lines { quantity warehouseId } } } }`, 'owner')).data?.['order'] as { returns: unknown[] }
    expect(detail.returns).toEqual([{ number: 'RA-3101-1', state: 'requested', reason: 'damaged', note: 'Shopper rang', lines: expect.arrayContaining([{ quantity: 1, warehouseId: places.main }, { quantity: 1, warehouseId: places.drop }]) }])
    expect(((await gql(`{ order(id: "${id}") { returns { number note } } }`, 'drop')).data?.['order'] as { returns: unknown[] }).returns).toEqual([{ number: 'RA-3101-1', note: null }])
    expect(((await gql(`{ order(id: "${id}") { returns { number } } }`, 'hub')).data?.['order'] as { returns: unknown[] }).returns).toEqual([])
  })

  it('refunds a return only once received, and cancels one only while it’s on its way back', async () => {
    const inReturn = (who: Who, line: string, extra = '') => refund(who, id, [{ id: line, quantity: 1 }], `, returnId: "${returnId}"${extra}`)
    expect((await inReturn('owner', lines.house)).code).toBe('NOT_RECEIVED')
    expect((await gql(`mutation { receiveReturn(returnId: "${returnId}") }`, 'drop')).code).toBe('FORBIDDEN')
    expect((await gql(`mutation { receiveReturn(returnId: "${returnId}") }`, 'owner')).data?.['receiveReturn']).toBe(true)
    expect((await gql(`mutation { cancelReturn(returnId: "${returnId}") }`, 'owner')).code).toBe('NOT_REQUESTED')
    const before = asked.length
    expect((await inReturn('owner', lines.house, ', restock: true')).code).toBeUndefined()
    // Cash goes back by the store's own hand: recorded, never sent to a provider.
    expect(asked.length).toBe(before)
    expect((await db.sql`select state, provider_ref from payment_refund p join refund f on f.id = p.refund_id where f.order_id = ${id}`)[0]).toEqual({ state: 'done', provider_ref: null })
    expect((await db.sql`select state from "return" where id = ${returnId}`)[0]?.['state']).toBe('received')
    // The supplier refunds its own line in the return, and it comes back to its own location.
    expect((await inReturn('drop', lines.scarf, ', restock: true')).code).toBeUndefined()
    expect(await onHand(versions.scarf, places.drop)).toBe(1)
    expect((await db.sql`select state from "return" where id = ${returnId}`)[0]?.['state']).toBe('refunded')
  })

  it('cancels a return still on its way back, so its units can go back again', async () => {
    const again = await gql(`mutation { startReturn(orderId: "${id}", lines: [{ lineId: "${lines.house}", quantity: 1 }], reason: doesnt_fit) }`, 'owner')
    const other = again.data?.['startReturn'] as string
    expect((await gql(`mutation { startReturn(orderId: "${id}", lines: [{ lineId: "${lines.house}", quantity: 1 }], reason: doesnt_fit) }`, 'owner')).code).toBe('TOO_MANY')
    expect((await gql(`mutation { cancelReturn(returnId: "${other}") }`, 'owner')).data?.['cancelReturn']).toBe(true)
    expect((await gql(`mutation { startReturn(orderId: "${id}", lines: [{ lineId: "${lines.house}", quantity: 1 }], reason: doesnt_fit) }`, 'owner')).code).toBeUndefined()
  })

  it('refunds no more within a return than it holds, across all its refunds, nor its units again outside it', async () => {
    const other = await paidOrder('A-3150', 'cod')
    const house = await lineOf(other, versions.house)
    const made = (await gql(`mutation { startReturn(orderId: "${other}", lines: [{ lineId: "${house}", quantity: 2 }], reason: damaged) }`, 'owner')).data?.['startReturn'] as string
    await gql(`mutation { receiveReturn(returnId: "${made}") }`, 'owner')
    expect((await refund('owner', other, [{ id: house, quantity: 1 }], `, returnId: "${made}"`)).code).toBeUndefined()
    expect((await refund('owner', other, [{ id: house, quantity: 2 }], `, returnId: "${made}"`)).code).toBe('TOO_MANY')
    expect((await refund('owner', other, [{ id: house, quantity: 1 }])).code).toBe('TOO_MANY')
    expect((await refund('owner', other, [{ id: house, quantity: 1 }], `, returnId: "${made}"`)).code).toBeUndefined()
    expect((await db.sql`select state from "return" where id = ${made}`)[0]?.['state']).toBe('refunded')
  })

  it('tells a supplier nothing of a return holding none of its lines, whatever its state', async () => {
    const [storeOnly] = await db.sql<{ id: string }[]>`select id from "return" where order_id = ${id} and state = 'requested'`
    const probe = () => refund('drop', id, [{ id: lines.scarf, quantity: 0, amount: '1' }], `, returnId: "${storeOnly?.id ?? ''}"`)
    expect((await probe()).code).toBe('NOT_FOUND')
    expect((await gql(`mutation { receiveReturn(returnId: "${storeOnly?.id ?? ''}") }`, 'owner')).data?.['receiveReturn']).toBe(true)
    expect((await probe()).code).toBe('NOT_FOUND')
    expect((await refund('drop', id, [{ id: lines.scarf, quantity: 0, amount: '1' }], `, returnId: "${crypto.randomUUID()}"`)).code).toBe('NOT_FOUND')
  })
})

describe('what never refunds', () => {
  it('refuses an unpaid order, Staff, and a read-only support session', async () => {
    const id = await paidOrder('A-3201', 'cod')
    const house = await lineOf(id, versions.house)
    expect((await refund('staff', id, [{ id: house, quantity: 1 }])).code).toBe('FORBIDDEN')
    expect((await refund('owner', id, [{ id: house, quantity: 1 }], '', { support: 'read' })).code).toBe('READ_ONLY')
    await db.sql`update "order" set payment_state = 'pending' where id = ${id}`
    expect((await refund('owner', id, [{ id: house, quantity: 1 }])).code).toBe('NOT_PAID')
  })
})

describe('in the database (DATA-MODEL §5.3, §7.6)', () => {
  const as = (seller: string | null): TenantContext => ({ caller: { kind: 'person', userId: crypto.randomUUID(), sessionId: crypto.randomUUID() }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: seller ? { kind: 'seller', sellerId: seller } : { kind: 'all' }, subscription: 'active' })

  it('gives a supplier its own refunds and ledger without the store’s note or who, no return or payment of its own accord, and no writes', async () => {
    for (const query of ['select note from refund', 'select by_user_id from refund', 'select note from supplier_ledger_entry', 'select 1 from "return"', 'select 1 from payment_refund']) {
      await expect(withScope(db.sql, as(t.sellerA1First), (tx) => tx.unsafe(query)), query).rejects.toThrow(/permission denied/)
    }
    const own = await withScope(db.sql, as(t.sellerA1First), (tx) => tx<{ seller_id: string }[]>`select seller_id from refund`)
    expect(new Set(own.map((r) => r.seller_id))).toEqual(new Set([t.sellerA1First]))
    expect(new Set((await withScope(db.sql, as(t.sellerA1Second), (tx) => tx<{ seller_id: string }[]>`select seller_id from supplier_ledger_entry`)).map((r) => r.seller_id))).toEqual(new Set([t.sellerA1Second]))
    for (const who of [t.sellerA1First, null]) {
      await expect(withScope(db.sql, as(who), (tx) => tx`insert into refund_line (refund_id, order_line_id, store_id, quantity, amount, currency) select refund_id, order_line_id, store_id, 1, 1, 'INR' from refund_line limit 1`)).rejects.toThrow(/permission denied/)
    }
  })

  it('caps a line’s refunds at its quantity and what was paid for it, whoever writes them', async () => {
    const id = await paidOrder('A-3301', 'cod')
    const house = await lineOf(id, versions.house)
    const refundId = crypto.randomUUID()
    await expect(withSystemScope(db.sql, async (tx) => {
      await tx`insert into refund (id, store_id, order_id, amount, currency, reason, by_user_id) values (${refundId}, ${t.storeA1}, ${id}, 2001, 'INR', 'other', ${crypto.randomUUID()})`
      await tx`insert into refund_line (refund_id, order_line_id, store_id, quantity, amount, currency) values (${refundId}, ${house}, ${t.storeA1}, 1, 2001, 'INR')`
    })).rejects.toThrow(/refund past the line/)
    await expect(withSystemScope(db.sql, async (tx) => {
      await tx`insert into refund (id, store_id, order_id, amount, currency, reason, by_user_id) values (${refundId}, ${t.storeA1}, ${id}, 1, 'INR', 'other', ${crypto.randomUUID()})`
      await tx`insert into refund_line (refund_id, order_line_id, store_id, quantity, amount, currency) values (${refundId}, ${house}, ${t.storeA1}, 3, 1, 'INR')`
    })).rejects.toThrow(/refund past the line/)
  })
})
