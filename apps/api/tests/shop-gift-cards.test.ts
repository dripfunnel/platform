import { graphql, type GraphQLSchema } from 'graphql'
import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { hashGiftCardCode, normaliseGiftCardCode } from '#auth/giftCardCodes'
import { hashSessionId } from '#auth/session'
import { resolveShopper } from '#auth/shopCaller'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { redeemGiftCard, restoreGiftCard } from '#db/scoped/giftCards'
import { releaseUnpaidOrders } from '#engine/modules/checkout/index'
import { activityLog } from '#saas/activity/index'
import { prepareEmail } from '#saas/email/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #323 (SAPI 22), part 3: a gift card's balance and its redemption at checkout (FIRST-RELEASE §19), and the merchant's
// cards issued (CatEditor): one refusal for any number that opens no card here, rate-limited; a balance taken under the
// card's lock, so two orders never spend what only one can; given back on a cancellation or refund.

let db: TestDatabase
let t: Tenants
const host = 'kesari.shops.acme.example'
const otherHost = 'surat.shops.acme.example'
const stores = { kesari: '', surat: '' }
const ids = { cardProduct: '', amount: '', pack: '', suratCard: '', suratAmount: '' }
type Who = 'owner' | 'staff' | 'supplier' | 'suratOwner'
const cookies: Record<Who, string> = { owner: '', staff: '', supplier: '', suratOwner: '' }

const product = async (storeId: string, slug: string, type: string, amount: number) => {
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility, product_type) values (${storeId}, ${slug}, ${slug}, 'visible', ${type}) returning id`
  const id = (await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, position, track_stock) values (${storeId}, ${p?.id ?? ''}, 0, false) returning id`)[0]?.id ?? ''
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${id}, ${storeId}, 'INR', ${amount})`
  return { productId: p?.id ?? '', versionId: id }
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  const store = async (name: string, code: string) =>
    (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, ${name}, ${code}, 'IN', 'INR', 'active') returning id`)[0]?.id ?? ''
  stores.kesari = await store('Kesari', 'kesari')
  stores.surat = await store('Surat', 'surat')
  const card = await product(stores.kesari, 'gift-card', 'gift_card', 100000)
  ids.cardProduct = card.productId
  ids.amount = card.versionId
  await db.sql`update product set gift_card_expiry_months = 12 where id = ${card.productId}`
  ids.pack = (await product(stores.kesari, 'pattern-pack', 'digital', 40000)).versionId
  const surat = await product(stores.surat, 'gift-card', 'gift_card', 100000)
  ids.suratCard = surat.productId
  ids.suratAmount = surat.versionId
  await db.sql`insert into payment_provider_account (store_id, provider, status, bank_details) values (${stores.kesari}, 'bank_transfer', 'live', 'HDFC 1'), (${stores.kesari}, 'cod', 'live', null)`
  await db.sql`update seller set access_level = 'vendor-catalogue' where id = ${t.sellerA1First}`
  const person = async (storeId: string, email: string, role: string, sellerId: string | null = null) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, 'P', 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${sellerId}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person(stores.kesari, 'owner@kesari.example', 'owner')
  cookies.staff = await person(stores.kesari, 'staff@kesari.example', 'staff')
  // A supplier of Kesari: its store has one, from the fixtures' store A1, moved here.
  await db.sql`update seller set store_id = ${stores.kesari} where id = ${t.sellerA1First}`
  cookies.supplier = await person(stores.kesari, 'anand@kesari.example', 'supplier-admin', t.sellerA1First)
  cookies.suratOwner = await person(stores.surat, 'owner@surat.example', 'owner')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

let codeAttempts = true
const shop = async (source: string, cart: string | null = null, on = host, preview = false) => {
  const found = await resolveShopper(db.sql, new Request(`https://${on}/shop-api`, { headers: cart ? { 'x-shop-cart': cart } : {} }), on)
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: { ...found.shopper, preview }, origin: `https://${on}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.5', userAgent: null }, couriers: null, allowAttempt: async () => true, allowCodeAttempt: async () => codeAttempts, allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, message: result.errors?.[0]?.message }
}
const merchant = async (source: string, who: Who, as: { support?: 'read' } = {}) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'suratOwner' ? stores.surat : stores.kesari, ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}) }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing = as.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } } } }
    : resolved
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const issue = (who: Who, email = 'meera@example.com', product = ids.cardProduct, version = ids.amount, as: { support?: 'read' } = {}, key: string = crypto.randomUUID()) =>
  merchant(`mutation { issueGiftCard(productId: "${product}", versionId: "${version}", recipientEmail: "${email}", recipientName: "Meera", issueKey: "${key}") }`, who, as)
/** The card's email, composed as the relay would: its code read back from it. */
const send = async (giftCardId: string, storeId = stores.kesari) => {
  const prepared = await withSystemScope(db.sql, (tx) => prepareEmail(tx, { payload: { template: 'gift-card', giftCardId }, partnerId: t.partnerA, storeId }, { adminHost: 'a', platformHost: 'p' }, new Date()))
  if (!prepared.send) throw new Error(prepared.reason)
  const line = prepared.content.paragraphs.find((p) => p.startsWith('Your gift card number: ')) ?? ''
  return line.slice('Your gift card number: '.length)
}
const balance = (number: string, on = host) => shop(`{ giftCardBalance(number: "${number}") { balance { amount currency } expiresAt } }`, null, on)
const cartFields = 'cart { total { amount } amountDue { amount } giftCard { last4 applied { amount } balance { amount } } }'
type CartOut = { total: { amount: string }; amountDue: { amount: string }; giftCard: { last4: string; applied: { amount: string }; balance: { amount: string } } | null }
/** A guest's cart of downloads with its contact given, at the payment step. */
const cartOf = async (packs: number) => {
  const token = ((await shop(`mutation { addToCart(versionId: "${ids.pack}", quantity: ${packs}) { cartToken } }`)).data?.['addToCart'] as { cartToken: string }).cartToken
  await shop('mutation { setCartContact(email: "asha@example.com") { cart { id } } }', token)
  await shop('mutation { checkout { readyToPay } }', token)
  return token
}
const apply = async (token: string, number: string) => {
  const result = await shop(`mutation { applyGiftCard(number: "${number}") { ${cartFields} } }`, token)
  return { cart: (result.data?.['applyGiftCard'] as { cart: CartOut } | undefined)?.cart, code: result.code, message: result.message }
}
const place = async (token: string, provider: string) => {
  const result = await shop(`mutation { placeOrder(provider: "${provider}") { orderId } }`, token)
  return { orderId: (result.data?.['placeOrder'] as { orderId: string } | undefined)?.orderId ?? '', code: result.code }
}
const cardRow = async (id: string) => (await db.sql<{ balance: string }[]>`select balance_amount::text as balance from gift_card where id = ${id}`)[0]?.balance

let cardId = ''
let code = ''

describe('Issue a card', () => {
  it('is the Owner’s or a Manager’s: one of the product’s amounts, emailed and logged; refused to Staff, a supplier, another store and a read-only session', async () => {
    expect((await issue('staff')).code).toBe('FORBIDDEN')
    expect((await issue('supplier')).code).toBe('FORBIDDEN')
    expect((await issue('suratOwner')).code).toBe('NOT_FOUND')
    expect((await issue('owner', 'meera@example.com', ids.cardProduct, ids.amount, { support: 'read' })).code).toBe('READ_ONLY')
    expect((await issue('owner', 'not-an-email')).code).toBe('INVALID_INPUT')
    expect((await issue('owner', 'meera@example.com', ids.cardProduct, ids.pack)).code).toBe('NOT_FOUND')
    const key = crypto.randomUUID()
    cardId = String((await issue('owner', 'meera@example.com', ids.cardProduct, ids.amount, {}, key)).data?.['issueGiftCard'])
    // A double click or a retry with the same request key answers the same card, issued, emailed and logged once.
    expect((await issue('owner', 'meera@example.com', ids.cardProduct, ids.amount, {}, key)).data?.['issueGiftCard']).toBe(cardId)
    expect((await issue('owner', 'someone@example.com', ids.cardProduct, ids.amount, {}, key)).code).toBe('KEY_REUSED')
    expect((await issue('owner', 'meera@example.com', ids.cardProduct, ids.amount, {}, 'not-a-key')).code).toBe('INVALID_INPUT')
    expect(await db.sql`select id from gift_card where product_id = ${ids.cardProduct}`).toEqual([{ id: cardId }])
    expect(await db.sql`select reason from activity_log where action = 'gift_card.issued' and target_id = ${cardId}`).toEqual([{ reason: 'INR 100000' }])
    expect(await db.sql`select payload ->> 'template' as template from outbox where kind = 'email' and payload ->> 'giftCardId' = ${cardId}`).toEqual([{ template: 'gift-card' }])
    // Not usable until its email, which holds its code, has gone.
    code = await send(cardId)
    expect(normaliseGiftCardCode(code)).not.toBeNull()
  })

  it('lists a product’s cards with their last four and balance to the merchant side alone', async () => {
    const list = async (who: Who) => (await merchant(`{ giftCards(productId: "${ids.cardProduct}") { nodes { id last4 recipientEmail balance { amount } source } } }`, who))
    expect((await list('owner')).data?.['giftCards']).toEqual({ nodes: [{ id: cardId, last4: code.slice(-4), recipientEmail: 'meera@example.com', balance: { amount: '100000' }, source: 'issued' }] })
    expect(((await list('staff')).data?.['giftCards'] as { nodes: unknown[] }).nodes).toHaveLength(1)
    expect((await list('supplier')).code).toBe('FORBIDDEN')
    expect((await list('suratOwner')).data?.['giftCards']).toEqual({ nodes: [] })
    // Another store asking by this store's product id sees no card of it.
    expect((await merchant(`{ giftCards(productId: "${ids.cardProduct}") { nodes { id } } }`, 'suratOwner')).data?.['giftCards']).toEqual({ nodes: [] })
  })
})

describe('the balance', () => {
  it('is shown for this store’s card however its number is typed, with one refusal for every other number, rate-limited', async () => {
    expect((await balance(code.toLowerCase().replaceAll('-', ' '))).data?.['giftCardBalance']).toMatchObject({ balance: { amount: '100000', currency: 'INR' } })
    const wrong = await balance('ABCD-EFGH-JKLM-NPQR')
    expect(wrong.code).toBe('GIFT_CARD_INVALID')
    // Another shop of the same partner, a card not yet sent, an expired one and a used-up one: the same words.
    expect(await balance(code, otherHost)).toEqual(wrong)
    const unsent = String((await issue('owner', 'rohan@example.com')).data?.['issueGiftCard'])
    expect(unsent).toMatch(/^[0-9a-f-]{36}$/)
    await db.sql`update gift_card set expires_at = now() - interval '1 day' where id = ${cardId}`
    expect(await balance(code)).toEqual(wrong)
    await db.sql`update gift_card set expires_at = now() + interval '1 year', balance_amount = 0 where id = ${cardId}`
    expect(await balance(code)).toEqual(wrong)
    await db.sql`update gift_card set balance_amount = 100000 where id = ${cardId}`
    codeAttempts = false
    expect((await balance(code)).code).toBe('RATE_LIMITED')
    expect((await apply(await cartOf(1), code)).code).toBe('RATE_LIMITED')
    codeAttempts = true
  })
})

describe('redeeming', () => {
  it('pays a whole order with the card when it covers it, delivered as any paid order', async () => {
    const token = await cartOf(1)
    const applied = await apply(token, code)
    expect(applied.cart).toEqual({ total: { amount: '40000' }, amountDue: { amount: '0' }, giftCard: { last4: code.slice(-4), applied: { amount: '40000' }, balance: { amount: '100000' } } })
    expect((await place(token, 'cod')).code).toBe('METHOD_UNAVAILABLE')
    const { orderId } = await place(token, 'gift_card')
    expect(await db.sql`select payment_state, payment_method, gift_card_amount::int as gift from "order" where id = ${orderId}`).toEqual([{ payment_state: 'paid', payment_method: 'gift_card', gift: 40000 }])
    expect(await cardRow(cardId)).toBe('60000')
    expect(await db.sql`select kind, amount::int from gift_card_movement where order_id = ${orderId}`).toEqual([{ kind: 'redeemed', amount: 40000 }])
    expect(await db.sql`select payload ->> 'event' as event from outbox where kind = 'order.notify' and payload ->> 'orderId' = ${orderId}`).toEqual([{ event: 'confirmed' }])
  })

  it('tells the store’s webhooks a card-paid order was paid, and refunded onto the card with no payment to refund', async () => {
    const [owner] = await db.sql<{ id: string }[]>`select id from "user" where email = 'owner@kesari.example'`
    await db.sql`insert into webhook_endpoint (store_id, url, events, secret_sealed, created_by_user_id) values (${stores.kesari}, 'https://hooks.kesari.example/in', '{order.paid,order.refunded}', 'sealed', ${owner?.id ?? ''})`
    const before = await cardRow(cardId)
    const token = await cartOf(1)
    await apply(token, code)
    const { orderId } = await place(token, 'gift_card')
    expect((await merchant(`mutation { cancelOrder(orderId: "${orderId}", reason: store) }`, 'owner')).data?.['cancelOrder']).toBe(true)
    expect(await cardRow(cardId)).toBe(before)
    const events = await db.sql<{ event: string }[]>`select payload ->> 'event' as event from outbox where kind = 'webhook.event' and payload -> 'data' ->> 'id' = ${orderId} `
    expect(events.map((e) => e.event).sort()).toEqual(['order.paid', 'order.refunded'])
    await db.sql`delete from webhook_endpoint where store_id = ${stores.kesari}`
  })

  it('pays part, leaves the rest to pay, and gives the card back whole when the order is let go unpaid', async () => {
    const token = await cartOf(2)
    expect((await apply(token, code)).cart).toMatchObject({ total: { amount: '80000' }, amountDue: { amount: '20000' }, giftCard: { applied: { amount: '60000' } } })
    expect((await place(token, 'gift_card')).code).toBe('METHOD_UNAVAILABLE')
    const { orderId } = await place(token, 'bank_transfer')
    expect(await db.sql`select amount::int from payment where order_id = ${orderId}`).toEqual([{ amount: 20000 }])
    expect(await cardRow(cardId)).toBe('0')
    const at = new Date(Date.now() + 3 * 86_400_000 + 60_000)
    expect(await releaseUnpaidOrders({ sql: db.sql, activity: activityLog, gateways: {}, secrets: null, now: () => at }, at)).toBe(1)
    expect(await cardRow(cardId)).toBe('60000')
    expect(await db.sql`select kind, amount::int from gift_card_movement where order_id = ${orderId} order by created_at, kind`).toEqual([{ kind: 'redeemed', amount: 60000 }, { kind: 'restored', amount: 60000 }])
  })

  it('refunds a cancelled order through its payment first, the rest onto the card', async () => {
    const token = await cartOf(2)
    await apply(token, code)
    const { orderId } = await place(token, 'bank_transfer')
    expect((await merchant(`mutation { markOrderPaid(orderId: "${orderId}") }`, 'owner')).data?.['markOrderPaid']).toBe(true)
    expect((await merchant(`mutation { cancelOrder(orderId: "${orderId}", reason: store) }`, 'owner')).data?.['cancelOrder']).toBe(true)
    expect(await db.sql`select coalesce(sum(r.amount), 0)::int as back from payment_refund r join payment p on p.id = r.payment_id where p.order_id = ${orderId}`).toEqual([{ back: 20000 }])
    expect(await cardRow(cardId)).toBe('60000')
    expect(await db.sql`select refunded_amount::int as refunded, payment_state from "order" where id = ${orderId}`).toEqual([{ refunded: 80000, payment_state: 'refunded' }])
  })

  it('takes a balance under the card’s lock: an order priced before another spent it is told the cart changed (the race)', async () => {
    const token = await cartOf(1)
    await apply(token, code)
    // Another order holds the card, uncommitted, and spends it all; this placement waits for it, then finds too little.
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => (release = resolve))
    let locked: () => void = () => undefined
    const isLocked = new Promise<void>((resolve) => (locked = resolve))
    const other = db.sql.begin(async (tx: postgres.TransactionSql) => {
      await tx`select id from gift_card where id = ${cardId} for update`
      locked()
      await held
      await tx`update gift_card set balance_amount = 0 where id = ${cardId}`
    })
    await isLocked
    const redeemedBefore = await db.sql`select count(*)::int as n from gift_card_movement where gift_card_id = ${cardId} and kind = 'redeemed'`
    const placing = place(token, 'gift_card')
    const waited = await Promise.race([placing.then(() => 'finished'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 300))])
    expect(waited).toBe('waiting')
    release()
    await other
    expect((await placing).code).toBe('CART_CHANGED')
    expect(await cardRow(cardId)).toBe('0')
    expect(await db.sql`select count(*)::int as n from gift_card_movement where gift_card_id = ${cardId} and kind = 'redeemed'`).toEqual(redeemedBefore)
    // Two placements at once on a card that covers one: one is placed, the other told the cart changed.
    await db.sql`update gift_card set balance_amount = 40000 where id = ${cardId}`
    const [a, b] = [await cartOf(1), await cartOf(1)]
    await apply(a, code)
    await apply(b, code)
    const both = await Promise.all([place(a, 'gift_card'), place(b, 'gift_card')])
    expect(both.map((r) => r.code ?? 'placed').sort()).toEqual(['CART_CHANGED', 'placed'])
    expect(await cardRow(cardId)).toBe('0')
  })

  it('refuses to charge the whole total for a card spent since the shopper saw it: the card comes off and the cart changed', async () => {
    const fresh = String((await issue('owner')).data?.['issueGiftCard'])
    const number = await send(fresh)
    const token = await cartOf(2)
    expect((await apply(token, number)).cart?.amountDue).toEqual({ amount: '0' })
    await db.sql`update gift_card set balance_amount = 0 where id = ${fresh}`
    expect((await place(token, 'bank_transfer')).code).toBe('CART_CHANGED')
    expect((await place(token, 'gift_card')).code).toBe('METHOD_UNAVAILABLE')
    const seen = (await shop(`{ ${cartFields} }`, token)).data?.['cart'] as CartOut
    expect(seen).toMatchObject({ amountDue: { amount: '80000' }, giftCard: null })
    const { orderId } = await place(token, 'bank_transfer')
    expect(await db.sql`select amount::int, (select gift_card_amount::int from "order" where id = ${orderId}) as gift from payment where order_id = ${orderId}`).toEqual([{ amount: 80000, gift: 0 }])
  })

  it('never spends a card on a preview, and opens no card in another currency than the cart’s', async () => {
    const fresh = String((await issue('owner')).data?.['issueGiftCard'])
    const number = await send(fresh)
    const token = await cartOf(1)
    const inPreview = await shop(`mutation { applyGiftCard(number: "${number}") { ${cartFields} } }`, token, host, true)
    expect(inPreview.code).toBe('NOT_IN_PREVIEW')
    expect((await apply(token, number)).cart?.amountDue).toEqual({ amount: '0' })
    for (const provider of ['gift_card', 'bank_transfer']) {
      expect((await shop(`mutation { placeOrder(provider: "${provider}") { orderId } }`, token, host, true)).code).toBe('METHOD_UNAVAILABLE')
    }
    expect(await cardRow(fresh)).toBe('100000')
    // A card in dollars, in this rupee shop: the one refusal.
    const dollars = 'DLRS2345DLRS2345'
    await db.sql`insert into gift_card (store_id, product_id, currency, initial_amount, balance_amount, recipient_email, issued_by, code_hash, code_last4, sent_at)
      values (${stores.kesari}, ${ids.cardProduct}, 'USD', 5000, 5000, 'usd@example.com', ${crypto.randomUUID()}, ${await hashGiftCardCode(stores.kesari, dollars)}, '2345', now())`
    expect((await apply(await cartOf(1), dollars)).code).toBe('GIFT_CARD_INVALID')
  })

  it('gives back only onto the order’s own store’s card, and records only what was put back', async () => {
    const fresh = String((await issue('owner')).data?.['issueGiftCard'])
    const token = await cartOf(1)
    await apply(token, await send(fresh))
    const { orderId } = await place(token, 'gift_card')
    expect(await cardRow(fresh)).toBe('60000')
    await withSystemScope(db.sql, (tx) => restoreGiftCard(tx, stores.surat, orderId, 100n, new Date()))
    expect(await cardRow(fresh)).toBe('60000')
    await withSystemScope(db.sql, (tx) => restoreGiftCard(tx, stores.kesari, orderId, 100000n, new Date()))
    expect(await cardRow(fresh)).toBe('100000')
    expect(await db.sql`select kind, amount::int from gift_card_movement where gift_card_id = ${fresh} order by created_at, kind`).toEqual([
      { kind: 'issued', amount: 100000 },
      { kind: 'redeemed', amount: 40000 },
      { kind: 'restored', amount: 40000 },
    ])
  })

  it('debits a card only when it still holds the amount, writing nothing otherwise', async () => {
    const fresh = String((await issue('owner')).data?.['issueGiftCard'])
    await send(fresh)
    const [order] = await db.sql<{ id: string }[]>`select id from "order" where store_id = ${stores.kesari} and state = 'placed' limit 1`
    const take = (amount: bigint) => withSystemScope(db.sql, (tx) => redeemGiftCard(tx, { storeId: stores.kesari, giftCardId: fresh, orderId: order?.id ?? '', amount, currency: 'INR', at: new Date() }))
    expect(await take(100001n)).toBe(false)
    expect(await withSystemScope(db.sql, (tx) => redeemGiftCard(tx, { storeId: stores.surat, giftCardId: fresh, orderId: order?.id ?? '', amount: 1n, currency: 'INR', at: new Date() }))).toBe(false)
    expect(await cardRow(fresh)).toBe('100000')
    expect(await db.sql`select kind from gift_card_movement where gift_card_id = ${fresh}`).toEqual([{ kind: 'issued' }])
  })

  it('refuses another store’s card and a used-up one with the one refusal, and takes one off', async () => {
    const theirs = String((await merchant(`mutation { issueGiftCard(productId: "${ids.suratCard}", versionId: "${ids.suratAmount}", recipientEmail: "x@example.com", issueKey: "${crypto.randomUUID()}") }`, 'suratOwner')).data?.['issueGiftCard'])
    const theirCode = await send(theirs, stores.surat)
    const token = await cartOf(1)
    const refused = await apply(token, theirCode)
    expect(refused.code).toBe('GIFT_CARD_INVALID')
    expect(await apply(token, code)).toEqual(refused)
    await db.sql`update gift_card set balance_amount = 1000 where id = ${cardId}`
    expect((await apply(token, code)).cart?.amountDue).toEqual({ amount: '39000' })
    expect(((await shop(`mutation { removeGiftCard { ${cartFields} } }`, token)).data?.['removeGiftCard'] as { cart: CartOut }).cart).toMatchObject({ amountDue: { amount: '40000' }, giftCard: null })
  })
})

describe('isolation', () => {
  const merchantOf = (storeId: string, seller: string | null = null): TenantContext => ({ caller: { kind: 'person', userId: 'u', sessionId: 's' }, partnerId: t.partnerA, storeId, sellerScope: seller ? { kind: 'seller', sellerId: seller } : { kind: 'all' }, subscription: 'active' })
  const shopper = async (): Promise<TenantContext> => ({ caller: { kind: 'shopper', customerId: null, orderTokenHash: await hashSessionId('x') }, partnerId: t.partnerA, storeId: stores.kesari, sellerScope: { kind: 'all' }, subscription: 'active' })

  it('lets a card be read by its own store’s merchant side only, never its code’s hash, and changed by no request role', async () => {
    expect(await withScope(db.sql, merchantOf(stores.kesari), (tx) => tx`select id from gift_card`)).not.toHaveLength(0)
    expect(await withScope(db.sql, merchantOf(stores.surat), (tx) => tx`select id from gift_card where store_id = ${stores.kesari}`)).toHaveLength(0)
    await expect(withScope(db.sql, merchantOf(stores.kesari), (tx) => tx`select code_hash from gift_card`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, merchantOf(stores.kesari), (tx) => tx`update gift_card set balance_amount = 999999`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, merchantOf(stores.kesari, t.sellerA1First), (tx) => tx`select id from gift_card`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, await shopper(), (tx) => tx`select id from gift_card`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, await shopper(), (tx) => tx`update "order" set gift_card_id = null`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, { caller: { kind: 'partner-user', partnerUserId: crypto.randomUUID() }, partnerId: t.partnerA }, (tx) => tx`select id from gift_card`)).rejects.toThrow(/permission denied/)
  })
})
