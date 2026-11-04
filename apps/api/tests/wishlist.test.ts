import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveShopper } from '#auth/shopCaller'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { markAbandonedCarts, queueDueReminders } from '#engine/modules/cartReminders/index'
import type { OutgoingEmail, SesApi } from '#integrations/ses/index'
import { cartRemindDeliverer } from '#jobs/queues/deliverers/cartRemind'
import { emailDeliverer } from '#jobs/queues/deliverers/email'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1213: a signed-in shopper's wishlist on the Shop API, shown with their abandoned cart on the Store API and in the
// reminder email (FIRST-RELEASE §9, §19; DATA-MODEL §7.6; ACCESS §11).

let db: TestDatabase
let t: Tenants
const host = 'jaipur.shop.example'
const otherHost = 'surat.shop.example'
const suppressionKey = btoa('k'.repeat(32))
let store = ''
let surat = ''
let seller = ''
const cookies = { owner: '', staff: '', supplier: '', surat: '' }
const sent: OutgoingEmail[] = []
const ses: SesApi = { send: async (email) => (sent.push(email), { messageId: `m-${sent.length}` }) }
const facts = { requestId: 'r', ip: '203.0.113.5', userAgent: null }
const products: Record<string, { product: string; version: string }> = {}

const gql = async (source: string, who: { session?: string; cart?: string; on?: string } = {}) => {
  const on = who.on ?? host
  const headers: Record<string, string> = { ...(who.session ? { 'x-shop-session': who.session } : {}), ...(who.cart ? { 'x-shop-cart': who.cart } : {}) }
  const found = await resolveShopper(db.sql, new Request(`https://${on}/shop-api`, { headers }), on, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${on}`, activity: activityLog, facts, allowAttempt: async () => true, allowNewCart: async () => true, sessionToken: who.session ?? null, codeCheck: '0', now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const merchant = async (source: string, who: keyof typeof cookies) => {
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'surat' ? surat : store, ...(who === 'supplier' ? { [supplierHeader]: seller } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const signIn = async (phone: string, on = host) => {
  await gql(`mutation { requestSignInCode(channel: PHONE, to: "${phone}") }`, { on })
  const made = await gql(`mutation { verifySignInCode(channel: PHONE, to: "${phone}", code: "000000", name: "Asha") { sessionToken } }`, { on })
  return (made.data?.['verifySignInCode'] as { sessionToken: string }).sessionToken
}
const customerOf = async (phone: string) => (await db.sql<{ id: string }[]>`select id from customer where phone = ${phone}`)[0]?.id ?? ''
const wish = (name: string, session: string, on = host) => gql(`mutation { addToWishlist(productId: "${products[name]?.product ?? ''}") }`, { session, on })
const names = async (session: string, on = host) => ((await gql('{ wishlist { name } }', { session, on })).data?.['wishlist'] as { name: string }[]).map((p) => p.name)
const audits = async (action: string, customerId: string) => (await db.sql<{ n: number }[]>`select count(*)::int as n from activity_log where action = ${action} and customer_id = ${customerId}`)[0]?.n ?? 0

const left = async (session: string | null, email: string, version: string) => {
  const add = await gql(`mutation { addToCart(versionId: "${version}", quantity: 1) { cartToken cart { id } } }`, session ? { session } : {})
  const change = add.data?.['addToCart'] as { cartToken: string | null; cart: { id: string } }
  const who = session ? { session } : { cart: change.cartToken ?? '' }
  await gql(`mutation { setCartContact(email: "${email}") { cart { id } } }`, who)
  await db.sql`update "order" set updated_at = now() - interval '2 hours' where id = ${change.cart.id}`
  await markAbandonedCarts({ sql: db.sql, now: () => new Date() }, 100)
  return change.cart.id
}
const relay = async () => {
  const [row] = await db.sql<{ now: Date }[]>`select now() + interval '1 second' as now`
  const at = row?.now ?? new Date()
  const hosts = { adminHost: 'admin.dripfunnel.test', platformHost: 'platform.dripfunnel.test', shopDomain: 'shop.example' }
  await relayDue(db.sql, { 'cart.remind': cartRemindDeliverer(db.sql, suppressionKey, null), email: emailDeliverer(db.sql, ses, { hosts, senderDomain: 'mail.dripfunnel.test', suppressionKey }) }, { ...defaultRelayOptions, now: () => at })
}
const remind = async () => {
  await markAbandonedCarts({ sql: db.sql, now: () => new Date() }, 100)
  await queueDueReminders({ sql: db.sql, now: () => new Date() }, 200)
  for (let i = 0; i < 3; i++) await relay()
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  const make = async (name: string, code: string) =>
    (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status, address) values (${t.partnerA}, ${name}, ${code}, 'IN', 'INR', 'active', ${db.sql.json({ street: '1 MI Road', city: 'Jaipur' })}) returning id`)[0]?.id ?? ''
  store = await make('Jaipur', 'jaipur')
  surat = await make('Surat', 'surat')
  const product = async (storeId: string, name: string, price: number, stock = 100) => {
    const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, ${name}, ${name.toLowerCase().replaceAll(' ', '-')}, 'visible') returning id`
    const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${storeId}, ${p?.id ?? ''}, ${name}, 0, true) returning id`
    await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${v?.id ?? ''}, ${storeId}, 'INR', ${price})`
    await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${v?.id ?? ''}, w.id, ${storeId}, ${stock} from warehouse w where w.store_id = ${storeId} and w.is_default`
    products[name] = { product: p?.id ?? '', version: v?.id ?? '' }
  }
  for (const [name, price] of [['Kurta', 100000], ['Scarf', 20000], ['Shawl', 30000], ['Stole', 40000], ['Dupatta', 50000], ['Lehenga', 90000]] as const) await product(store, name, price)
  await product(store, 'Sold out', 10000, 0)
  await product(store, 'Hidden', 10000)
  await product(surat, 'Saree', 300000)
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerA}, 'Growth Pro', 'live') returning id`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${t.partnerA}, 1, 'cart_reminders', 2)`
  await db.sql`update store set plan_id = ${plan?.id ?? ''} where id = ${store}`
  await db.sql`delete from store_subscription where store_id = ${store}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${store}, ${t.partnerA}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, now(), now() + interval '30 days')`
  await db.sql`insert into cart_reminder_flow (store_id, enabled, skip_out_of_stock, quiet_hours, weekly_cap) values (${store}, true, true, false, false)`
  await db.sql`insert into cart_reminder_step (store_id, position, enabled, delay_minutes, channel, subject, body) values (${store}, 1, true, 30, 'email', 'Reminder 1', 'Your cart is waiting.')`
  seller = (await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status) values (${store}, 'Anand', 'vendor-stock', 'active') returning id`)[0]?.id ?? ''
  const person = async (email: string, role: string, storeId = store, sellerId: string | null = null) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${sellerId}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person('owner@jaipur.example', 'owner')
  cookies.staff = await person('staff@jaipur.example', 'staff')
  cookies.supplier = await person('anand@jaipur.example', 'supplier-admin', store, seller)
  cookies.surat = await person('owner@surat.example', 'owner', surat)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('the wishlist on the Shop API (wishlist, addToWishlist, removeFromWishlist)', () => {
  let session = ''
  let me = ''

  it('refuses a signed-out caller on all three', async () => {
    const id = products['Kurta']?.product ?? ''
    for (const source of ['{ wishlist { id } }', `mutation { addToWishlist(productId: "${id}") }`, `mutation { removeFromWishlist(productId: "${id}") }`]) {
      expect((await gql(source)).code).toBe('SIGNED_OUT')
    }
  })

  it('adds, lists newest first and removes, and a second add or remove changes nothing', async () => {
    session = await signIn('+919845011111')
    me = await customerOf('+919845011111')
    expect((await wish('Kurta', session)).data?.['addToWishlist']).toBe(true)
    expect((await wish('Kurta', session)).data?.['addToWishlist']).toBe(true)
    await wish('Scarf', session)
    await db.sql`update wishlist_item set created_at = now() - interval '1 day' where product_id = ${products['Kurta']?.product ?? ''} and customer_id = ${me}`
    expect(await names(session)).toEqual(['Scarf', 'Kurta'])
    expect(await audits('customer.wishlist_added', me)).toBe(2)
    expect((await gql(`mutation { removeFromWishlist(productId: "${products['Scarf']?.product ?? ''}") }`, { session })).data?.['removeFromWishlist']).toBe(true)
    expect((await gql(`mutation { removeFromWishlist(productId: "${products['Scarf']?.product ?? ''}") }`, { session })).data?.['removeFromWishlist']).toBe(true)
    expect(await names(session)).toEqual(['Kurta'])
    expect(await audits('customer.wishlist_removed', me)).toBe(1)
  })

  it('gives NOT_FOUND for another store’s product, a hidden one, one that isn’t there and a bad id', async () => {
    await db.sql`update product set visibility = 'hidden' where id = ${products['Hidden']?.product ?? ''}`
    for (const id of [products['Saree']?.product ?? '', products['Hidden']?.product ?? '', crypto.randomUUID(), 'nope']) {
      expect((await gql(`mutation { addToWishlist(productId: "${id}") }`, { session })).code).toBe('NOT_FOUND')
    }
    expect(await names(session)).toEqual(['Kurta'])
  })

  it('keeps 100 and gives LIMIT for the 101st, while an item already there still adds', async () => {
    await db.sql`insert into product (store_id, name, slug, visibility) select ${store}, 'Bulk ' || n, 'bulk-' || n, 'visible' from generate_series(1, 99) n`
    await db.sql`insert into wishlist_item (store_id, customer_id, product_id) select ${store}, ${me}, id from product where store_id = ${store} and name like 'Bulk %'`
    expect((await db.sql<{ n: number }[]>`select count(*)::int as n from wishlist_item where customer_id = ${me}`)[0]?.n).toBe(100)
    expect((await wish('Scarf', session)).code).toBe('LIMIT')
    expect((await wish('Kurta', session)).data?.['addToWishlist']).toBe(true)
    await db.sql`delete from wishlist_item where customer_id = ${me} and product_id in (select id from product where store_id = ${store} and name like 'Bulk %')`
  })

  it('keeps each account’s list its own, and each store’s', async () => {
    const other = await signIn('+919845022222')
    expect(await names(other)).toEqual([])
    const surati = await signIn('+919845033333', otherHost)
    expect((await wish('Saree', surati, otherHost)).data?.['addToWishlist']).toBe(true)
    expect(await names(session)).toEqual(['Kurta'])
    expect(await names(surati, otherHost)).toEqual(['Saree'])
    const as = (storeId: string, customerId: string | null): TenantContext => ({ caller: { kind: 'shopper', customerId }, partnerId: t.partnerA, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })
    expect(await withScope(db.sql, as(surat, await customerOf('+919845033333')), (tx) => tx`select product_id from wishlist_item`)).toHaveLength(1)
    expect(await withScope(db.sql, as(store, await customerOf('+919845022222')), (tx) => tx`select product_id from wishlist_item`)).toHaveLength(0)
    expect(await withScope(db.sql, as(surat, me), (tx) => tx`select product_id from wishlist_item`)).toHaveLength(0)
    await expect(withScope(db.sql, as(surat, await customerOf('+919845033333')), (tx) => tx`insert into wishlist_item (store_id, customer_id, product_id) values (${store}, ${me}, ${products['Scarf']?.product ?? ''})`)).rejects.toThrow(/row-level security/)
  })

  it('leaves the merchant side to read only: no write by a person, a support session or a supplier', async () => {
    const person = (extra: Partial<TenantContext> = {}): TenantContext => ({ caller: { kind: 'person', userId: 'u', sessionId: 's' }, partnerId: t.partnerA, storeId: store, sellerScope: { kind: 'all' }, subscription: 'active', ...extra })
    const row = (tx: Parameters<Parameters<typeof withScope>[2]>[0]) => tx`insert into wishlist_item (store_id, customer_id, product_id) values (${store}, ${me}, ${products['Scarf']?.product ?? ''})`
    expect(await withScope(db.sql, person(), (tx) => tx`select product_id from wishlist_item`)).toHaveLength(1)
    await expect(withScope(db.sql, person(), row)).rejects.toThrow(/permission denied/)
    const support: TenantContext = { caller: { kind: 'support', supportSessionId: 'ss', partnerUserId: 'pu', access: 'read' }, partnerId: t.partnerA, storeId: store, sellerScope: { kind: 'all' }, subscription: 'active' }
    await expect(withScope(db.sql, support, row)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, person({ sellerScope: { kind: 'seller', sellerId: seller } }), (tx) => tx`select product_id from wishlist_item`)).rejects.toThrow(/permission denied/)
  })

  it('goes with the customer account', async () => {
    const [c] = await db.sql<{ id: string }[]>`insert into customer (store_id, email, name, status) values (${store}, 'gone@example.com', 'Gone', 'active') returning id`
    await db.sql`insert into wishlist_item (store_id, customer_id, product_id) values (${store}, ${c?.id ?? ''}, ${products['Shawl']?.product ?? ''})`
    await db.sql`delete from customer where id = ${c?.id ?? ''}`
    expect(await db.sql`select 1 from wishlist_item where customer_id = ${c?.id ?? ''}`).toHaveLength(0)
  })
})

describe('abandonedCart.wishlist and the reminder email', () => {
  let session = ''
  let cart = ''
  let guest = ''
  const query = (id: string) => `{ abandonedCart(id: "${id}") { wishlist { productId name slug price { amount currency } } } }`
  const wishlistOf = async (id: string, who: keyof typeof cookies) => {
    const r = await merchant(query(id), who)
    return { code: r.code, items: (r.data?.['abandonedCart'] as { wishlist: { name: string; price: { amount: string } | null }[] } | null)?.wishlist ?? null }
  }

  it('lists what the account wished for that is in stock and visible, minus the cart, newest first', async () => {
    session = await signIn('+919845044444')
    const me = await customerOf('+919845044444')
    for (const name of ['Kurta', 'Scarf', 'Shawl', 'Stole', 'Dupatta', 'Lehenga', 'Sold out', 'Hidden']) {
      if (name === 'Hidden') await db.sql`update product set visibility = 'visible' where id = ${products['Hidden']?.product ?? ''}`
      expect((await wish(name, session)).data?.['addToWishlist']).toBe(true)
    }
    await db.sql`update product set visibility = 'hidden' where id = ${products['Hidden']?.product ?? ''}`
    const order = ['Kurta', 'Scarf', 'Shawl', 'Stole', 'Dupatta', 'Lehenga', 'Sold out', 'Hidden']
    for (const [i, name] of order.entries()) await db.sql`update wishlist_item set created_at = now() - make_interval(mins => ${order.length - i}) where customer_id = ${me} and product_id = ${products[name]?.product ?? ''}`
    cart = await left(session, 'asha@example.com', products['Kurta']?.version ?? '')
    const seen = await wishlistOf(cart, 'owner')
    expect(seen.items?.map((i) => i.name)).toEqual(['Lehenga', 'Dupatta', 'Stole', 'Shawl', 'Scarf'])
    expect(seen.items?.[4]?.price).toEqual({ amount: '20000', currency: 'INR' })
  })

  it('is empty for a guest cart, and Staff read it, a supplier and another store’s owner are refused', async () => {
    guest = await left(null, 'guest@example.com', products['Kurta']?.version ?? '')
    expect((await wishlistOf(guest, 'owner')).items).toEqual([])
    expect((await wishlistOf(cart, 'staff')).items).toHaveLength(5)
    expect((await wishlistOf(cart, 'supplier')).code).toBe('FORBIDDEN')
    expect((await wishlistOf(cart, 'surat')).items).toBeNull()
  })

  it('puts "Still on your wishlist" in the reminder with at most 4 items, under the cart’s lines, and none for a guest', async () => {
    await remind()
    const mail = sent.find((e) => e.to.includes('asha@example.com'))
    const text = mail?.text ?? ''
    expect(text).toContain('Still on your wishlist')
    expect(text.indexOf('1 × Kurta')).toBeLessThan(text.indexOf('Still on your wishlist'))
    for (const name of ['Lehenga', 'Dupatta', 'Stole', 'Shawl']) expect(text).toContain(name)
    for (const name of ['Scarf', 'Sold out', 'Hidden']) expect(text).not.toContain(name)
    const guestMail = sent.find((e) => e.to.includes('guest@example.com'))
    expect(guestMail?.text).toBeTruthy()
    expect(guestMail?.text).not.toContain('wishlist')
  })

  it('leaves the block out for a signed-in shopper whose wishlist is empty', async () => {
    const empty = await signIn('+919845055555')
    await left(empty, 'bare@example.com', products['Kurta']?.version ?? '')
    await remind()
    const mail = sent.find((e) => e.to.includes('bare@example.com'))
    expect(mail?.text).toContain('Kurta')
    expect(mail?.text).not.toContain('wishlist')
  })
})
