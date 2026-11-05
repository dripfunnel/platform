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
import { markAbandonedCarts, queueDueReminders, queueDueWishlistReminders } from '#engine/modules/cartReminders/index'
import type { OutgoingEmail, SesApi } from '#integrations/ses/index'
import { cartRemindDeliverer } from '#jobs/queues/deliverers/cartRemind'
import { wishlistRemindDeliverer } from '#jobs/queues/deliverers/wishlistRemind'
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
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${on}`, activity: activityLog, facts, allowAttempt: async () => true, allowNewCart: async () => true, allowCodeAttempt: async () => true, sessionToken: who.session ?? null, codeCheck: '0', now: () => new Date() }
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
  await relayDue(db.sql, { 'cart.remind': cartRemindDeliverer(db.sql, suppressionKey, null), 'wishlist.remind': wishlistRemindDeliverer(db.sql, suppressionKey), email: emailDeliverer(db.sql, ses, { hosts, senderDomain: 'mail.dripfunnel.test', suppressionKey }) }, { ...defaultRelayOptions, now: () => at })
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
  const query = (id: string) => `{ abandonedCart(id: "${id}") { wishlist { productId name slug photoUrl price { amount currency } } } }`
  const wishlistOf = async (id: string, who: keyof typeof cookies) => {
    const r = await merchant(query(id), who)
    return { code: r.code, items: (r.data?.['abandonedCart'] as { wishlist: { name: string; photoUrl: string | null; price: { amount: string } | null }[] } | null)?.wishlist ?? null }
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

  it('gives each item its first photo as a merchant URL, and null when it has none', async () => {
    const file = (await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${store}, ${`stores/${store}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 1, ${'0'.repeat(64)}) returning id`)[0]?.id ?? ''
    await db.sql`insert into product_photo (product_id, store_id, asset_id, position) values (${products['Lehenga']?.product ?? ''}, ${store}, ${file}, 0)`
    const seen = await wishlistOf(cart, 'owner')
    expect(seen.items?.map((i) => [i.name, i.photoUrl])).toEqual([['Lehenga', `/api/assets/${file}`], ['Dupatta', null], ['Stole', null], ['Shawl', null], ['Scarf', null]])
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

describe('the Carts screen’s Wishlists tab', () => {
  const list = (args = 'first: 50') => `{ wishlistShoppers(${args}) { nodes { customerId name email items firstProduct lastSavedAt } pageInfo { hasNextPage endCursor } } wishlistShopperCount }`
  type Listed = { nodes: { customerId: string; items: number; firstProduct: string | null }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
  const listed = async (who: keyof typeof cookies, args?: string) => {
    const r = await merchant(list(args), who)
    return { code: r.code, page: r.data?.['wishlistShoppers'] as Listed | undefined, count: r.data?.['wishlistShopperCount'] as number | undefined }
  }
  let asha = ''
  let second = ''
  const ids = (page: Listed | undefined) => page?.nodes.map((n) => n.customerId) ?? []

  it('lists the shoppers with a wishlist, the newest saved first, with how many and the newest product', async () => {
    asha = await customerOf('+919845044444')
    const other = await signIn('+919845066666')
    second = await customerOf('+919845066666')
    expect((await wish('Kurta', other)).data?.['addToWishlist']).toBe(true)
    const seen = await listed('owner')
    expect(seen.count).toBe(seen.page?.nodes.length)
    expect(seen.page?.nodes[0]).toMatchObject({ customerId: second, items: 1, firstProduct: 'Kurta' })
    expect(seen.page?.nodes.find((n) => n.customerId === asha)).toMatchObject({ items: 8, firstProduct: 'Hidden' })
    expect(ids(seen.page).indexOf(second)).toBeLessThan(ids(seen.page).indexOf(asha))
  })

  it('finds a shopper by name, email or a product on their wishlist', async () => {
    expect(ids((await listed('owner', 'first: 10, search: "lehenga"')).page)).toEqual([asha])
    expect(ids((await listed('owner', 'first: 10, search: "dupatta"')).page)).toEqual([asha])
    expect(ids((await listed('owner', 'first: 10, search: "nothing like this"')).page)).toEqual([])
  })

  it('pages by keyset, each shopper once, in the list’s order', async () => {
    const all = ids((await listed('owner')).page)
    const walked: string[] = []
    let after = ''
    for (let guard = 0; guard < 20; guard++) {
      const one = await listed('owner', after ? `first: 1, after: "${after}"` : 'first: 1')
      walked.push(...ids(one.page))
      if (!one.page?.pageInfo.hasNextPage) break
      after = one.page.pageInfo.endCursor ?? ''
    }
    expect(all.length).toBeGreaterThan(2)
    expect(walked).toEqual(all)
  })

  it('opens a shopper’s wishlist: what they can see now, newest first, sold out ones marked, with price and photo', async () => {
    const r = await merchant(`{ wishlistShopper(customerId: "${asha}") { shopper { name items } items { name inStock photoUrl price { amount currency } } } }`, 'owner')
    const d = r.data?.['wishlistShopper'] as { shopper: { items: number }; items: { name: string; inStock: boolean; photoUrl: string | null; price: { amount: string } | null }[] }
    expect(d.items.map((i) => [i.name, i.inStock])).toEqual([['Sold out', false], ['Lehenga', true], ['Dupatta', true], ['Stole', true], ['Shawl', true], ['Scarf', true], ['Kurta', true]])
    expect(d.items[1]?.photoUrl).toMatch(/^\/api\/assets\//)
    expect(d.items[1]?.price?.amount).toBe('90000')
    expect(d.shopper.items).toBe(8)
  })

  it('is read by Staff, refused to a supplier, and shows another store nothing of this one', async () => {
    expect(ids((await listed('staff')).page)).toEqual(ids((await listed('owner')).page))
    expect((await listed('supplier')).code).toBe('FORBIDDEN')
    const away = await listed('surat')
    expect(ids(away.page)).not.toContain(asha)
    expect(away.count).toBe(1)
    const detail = await merchant(`{ wishlistShopper(customerId: "${asha}") { shopper { name } } }`, 'surat')
    expect(detail.data?.['wishlistShopper']).toBeNull()
  })

  it('leaves out an erased account', async () => {
    await db.sql`update customer set status = 'deleted' where id = ${second}`
    expect(ids((await listed('owner')).page)).not.toContain(second)
    expect((await merchant(`{ wishlistShopper(customerId: "${second}") { shopper { name } } }`, 'owner')).data?.['wishlistShopper']).toBeNull()
  })
})

describe('wishlist reminders: queued, decided and sent by the engine', () => {
  const email = 'reminded@example.com'
  let shopper = ''
  let customerId = ''
  const queue = () => queueDueWishlistReminders({ sql: db.sql, now: () => new Date() }, 200)
  const remindersOf = () => db.sql<{ state: string; skip_reason: string | null; position: number | null }[]>`
    select r.state, r.skip_reason, st.position from wishlist_reminder r left join wishlist_reminder_step st on st.id = r.step_id where r.customer_id = ${customerId} order by r.queued_at, st.position`
  const age = (minutes: number) => db.sql`update wishlist_item set created_at = now() - make_interval(mins => ${minutes}) where customer_id = ${customerId}`
  const mail = () => sent.filter((e) => e.to.includes(email))

  it('sends the first step once the list has sat for its delay: what can be bought now, with an unsubscribe link', async () => {
    shopper = await signIn('+919845077777')
    customerId = await customerOf('+919845077777')
    await db.sql`update customer set email = ${email}, name = 'Reena Das' where id = ${customerId}`
    for (const name of ['Kurta', 'Shawl', 'Sold out']) expect((await wish(name, shopper)).data?.['addToWishlist']).toBe(true)
    await db.sql`delete from wishlist_reminder_step where store_id = ${store}`
    await db.sql`delete from wishlist_reminder_flow where store_id = ${store}`
    await db.sql`insert into wishlist_reminder_flow (store_id, enabled, quiet_hours, weekly_cap) values (${store}, true, false, true)`
    await db.sql`insert into wishlist_reminder_step (store_id, position, enabled, delay_minutes, subject, body) values
      (${store}, 1, true, 60, 'Still thinking?', 'You saved these.'), (${store}, 2, true, 1440, 'Your wishlist is waiting', 'Take another look.'), (${store}, 3, false, 4320, 'Last look', 'Still here.')`
    await queue()
    expect(await remindersOf()).toHaveLength(0)
    await age(120)
    expect(await queue()).toBeGreaterThanOrEqual(1)
    expect(await remindersOf()).toHaveLength(1)
    expect(await queue()).toBe(0)
    for (let i = 0; i < 3; i++) await relay()
    expect((await remindersOf()).map((x) => [x.position, x.state])).toEqual([[1, 'sent']])
    const text = mail()[0]?.text ?? ''
    expect(mail()[0]?.subject).toBe('Still thinking?')
    expect(text).toContain('You saved these.')
    expect(text).toContain('Kurta')
    expect(text).toContain('Shawl')
    expect(text).not.toContain('Sold out')
    expect(text).toMatch(/unsubscribe\/[0-9a-f]{64}/i)
  })

  it('goes on to the next step by its own delay, and not before', async () => {
    await queue()
    expect(await remindersOf()).toHaveLength(1)
    await age(1500)
    await queue()
    for (let i = 0; i < 3; i++) await relay()
    expect((await remindersOf()).map((x) => [x.position, x.state, x.skip_reason])).toEqual([[1, 'sent', null], [2, 'skipped', 'weekly_cap']])
    expect(mail()).toHaveLength(1)
  })

  it('stops for good when the shopper unsubscribes from the link, and for a shopper the team stopped', async () => {
    const token = /unsubscribe\/([0-9a-f]{64})/i.exec(mail()[0]?.text ?? '')?.[1] ?? ''
    expect((await gql(`mutation { unsubscribe(token: "${token}") }`)).data?.['unsubscribe']).toBe(true)
    expect((await db.sql<{ consent_state: string }[]>`select consent_state from customer where id = ${customerId}`)[0]?.consent_state).toBe('stopped')
    await db.sql`delete from wishlist_reminder where customer_id = ${customerId}`
    await db.sql`update wishlist_reminder_flow set weekly_cap = false where store_id = ${store}`
    await queue()
    for (let i = 0; i < 3; i++) await relay()
    expect((await remindersOf()).every((x) => x.state === 'skipped' && x.skip_reason === 'opted_out')).toBe(true)
    expect(mail()).toHaveLength(1)
    await db.sql`delete from wishlist_reminder where customer_id = ${customerId}`
    await db.sql`update customer set consent_state = 'not_asked', wishlist_reminders_stopped_at = now() where id = ${customerId}`
    expect(await queue()).toBe(0)
  })

  it('sends nothing for a store that has not turned it on, or on a plan that is you-send only', async () => {
    await db.sql`update customer set wishlist_reminders_stopped_at = null where id = ${customerId}`
    await db.sql`delete from wishlist_reminder where customer_id = ${customerId}`
    await db.sql`update wishlist_reminder_flow set enabled = false where store_id = ${store}`
    await queue()
    for (let i = 0; i < 3; i++) await relay()
    expect(mail()).toHaveLength(1)
    expect((await remindersOf()).every((x) => x.state !== 'sent')).toBe(true)
  })
})

describe('wishlist reminders on the Store API: the sequence, and one shopper’s actions', () => {
  const settingsQuery = '{ wishlistReminderSettings { enabled skipOutOfStock quietHours weeklyCap revision level steps { position enabled delayMinutes subject body } } }'
  type Settings = { enabled: boolean; revision: number | null; level: string; quietHours: boolean; steps: { position: number; enabled: boolean; delayMinutes: number; subject: string }[] }
  const settingsOf = async (who: keyof typeof cookies) => (await merchant(settingsQuery, who)).data?.['wishlistReminderSettings'] as Settings | null
  const input = (over: Record<string, unknown> = {}, steps = [{ position: 1, enabled: true, delayMinutes: 240, subject: 'Hello again', body: 'Your saved things.' }, { position: 2, enabled: true, delayMinutes: 2880, subject: 'Still here', body: 'Take a look.' }, { position: 3, enabled: false, delayMinutes: 4320, subject: 'Last look', body: 'Still saved.' }]) => ({
    enabled: true,
    skipOutOfStock: true,
    quietHours: false,
    weeklyCap: true,
    steps,
    ...over,
  })
  const save = (revision: number | null, value: object, who: keyof typeof cookies = 'owner') => {
    const literal = (v: unknown): string => (Array.isArray(v) ? `[${v.map(literal).join(', ')}]` : v !== null && typeof v === 'object' ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${literal(x)}`).join(', ')} }` : JSON.stringify(v))
    return merchant(`mutation { saveWishlistReminderSettings(${revision === null ? '' : `revision: ${revision}, `}input: ${literal(value)}) }`, who)
  }
  let customerId = ''
  const detail = async (who: keyof typeof cookies = 'owner') => {
    const r = await merchant(`{ wishlistShopper(customerId: "${customerId}") { shopper { remindersSent stoppedAt stoppedBy stoppedNote } reminders { position state skipReason sentBy } } }`, who)
    return r.data?.['wishlistShopper'] as { shopper: { remindersSent: number; stoppedAt: string | null; stoppedBy: string | null; stoppedNote: string | null }; reminders: { position: number | null; state: string; skipReason: string | null; sentBy: string | null }[] } | null
  }

  it('reads the sequence with the plan’s level, and saves it at the revision read, once for each', async () => {
    const before = await settingsOf('owner')
    expect(before).toMatchObject({ enabled: false, level: 'automatic', revision: 1 })
    expect((await save(before?.revision ?? null, input())).data?.['saveWishlistReminderSettings']).toBe(2)
    const after = await settingsOf('owner')
    expect([after?.enabled, after?.revision, after?.steps.map((x) => [x.position, x.delayMinutes, x.subject])]).toEqual([true, 2, [[1, 240, 'Hello again'], [2, 2880, 'Still here'], [3, 4320, 'Last look']]])
    expect((await save(1, input())).code).toBe('STALE_REVISION')
    expect((await db.sql<{ n: number }[]>`select count(*)::int as n from activity_log where action = 'wishlist_reminders.saved' and store_id = ${store}`)[0]?.n).toBe(1)
  })

  it('refuses what is not valid, a step that goes no later than the one before, and a store whose plan has none', async () => {
    expect((await save(2, input({}, [{ position: 1, enabled: true, delayMinutes: 125, subject: 'x', body: '' }, { position: 2, enabled: false, delayMinutes: 1440, subject: '', body: '' }, { position: 3, enabled: false, delayMinutes: 4320, subject: '', body: '' }]))).code).toBe('INVALID_INPUT')
    expect((await save(2, input({}, [{ position: 1, enabled: true, delayMinutes: 1440, subject: 'x', body: '' }, { position: 2, enabled: true, delayMinutes: 1440, subject: 'y', body: '' }, { position: 3, enabled: false, delayMinutes: 4320, subject: '', body: '' }]))).code).toBe('INVALID_INPUT')
    expect((await save(2, input({}, [{ position: 1, enabled: true, delayMinutes: 60, subject: '', body: '' }, { position: 2, enabled: false, delayMinutes: 1440, subject: '', body: '' }, { position: 3, enabled: false, delayMinutes: 4320, subject: '', body: '' }]))).code).toBe('INVALID_INPUT')
    const bare = await settingsOf('surat')
    expect(bare).toMatchObject({ enabled: false, revision: null, level: 'youSend' })
    expect((await save(null, input(), 'surat')).code).toBe('PLAN_LIMIT')
  })

  it('is read by Staff and refused to write; a supplier meets nothing', async () => {
    expect((await settingsOf('staff'))?.revision).toBe(2)
    expect((await save(2, input(), 'staff')).code).toBe('FORBIDDEN')
    expect((await merchant(settingsQuery, 'supplier')).code).toBe('FORBIDDEN')
  })

  it('sends a reminder now to one shopper, who then shows it, and stops and resumes theirs with a note', async () => {
    customerId = await customerOf('+919845077777')
    await db.sql`update customer set email = 'reminded@example.com', consent_state = 'not_asked', wishlist_reminders_stopped_at = null where id = ${customerId}`
    await db.sql`delete from wishlist_reminder where customer_id = ${customerId}`
    const mailBefore = sent.filter((e) => e.to.includes('reminded@example.com')).length
    const now = await merchant(`mutation { remindWishlistNow(customerId: "${customerId}") }`, 'owner')
    expect(typeof now.data?.['remindWishlistNow']).toBe('string')
    for (let i = 0; i < 3; i++) await relay()
    expect(sent.filter((e) => e.to.includes('reminded@example.com'))).toHaveLength(mailBefore + 1)
    const shown = await detail()
    expect(shown?.shopper.remindersSent).toBe(1)
    expect(shown?.reminders.map((x) => [x.position, x.state, x.sentBy])).toEqual([[null, 'sent', expect.any(String)]])
    expect(await audits('wishlist.reminder_sent', customerId)).toBe(1)

    expect((await merchant(`mutation { stopWishlistReminders(customerId: "${customerId}", note: "She called") }`, 'owner')).data?.['stopWishlistReminders']).toBe(true)
    expect((await merchant(`mutation { stopWishlistReminders(customerId: "${customerId}") }`, 'owner')).data?.['stopWishlistReminders']).toBe(true)
    expect(await audits('wishlist.reminders_stopped', customerId)).toBe(1)
    const stopped = await detail()
    expect(stopped?.shopper).toMatchObject({ stoppedBy: expect.any(String), stoppedNote: 'She called' })
    expect((await merchant(`mutation { remindWishlistNow(customerId: "${customerId}") }`, 'owner')).code).toBe('CANT_REMIND')
    expect((await merchant(`mutation { resumeWishlistReminders(customerId: "${customerId}") }`, 'owner')).data?.['resumeWishlistReminders']).toBe(true)
    expect((await detail())?.shopper.stoppedAt).toBeNull()
    expect(await audits('wishlist.reminders_resumed', customerId)).toBe(1)
  })

  it('refuses a note that is too long, Staff, a supplier, and another store’s owner', async () => {
    expect((await merchant(`mutation { stopWishlistReminders(customerId: "${customerId}", note: "${'x'.repeat(201)}") }`, 'owner')).code).toBe('INVALID_INPUT')
    for (const who of ['staff', 'supplier'] as const) {
      expect((await merchant(`mutation { remindWishlistNow(customerId: "${customerId}") }`, who)).code).toBe('FORBIDDEN')
      expect((await merchant(`mutation { stopWishlistReminders(customerId: "${customerId}") }`, who)).code).toBe('FORBIDDEN')
    }
    expect((await merchant(`mutation { remindWishlistNow(customerId: "${customerId}") }`, 'surat')).code).toBe('NOT_FOUND')
    expect(await detail('surat')).toBeNull()
  })

  it('sorts shoppers into Not contacted, Reminded and Stopped, counts each, and sums the last 14 days', async () => {
    const inTab = async (tab: string) => ((await merchant(`{ wishlistShoppers(tab: "${tab}", first: 50) { nodes { customerId } } }`, 'owner')).data?.['wishlistShoppers'] as { nodes: { customerId: string }[] }).nodes.map((n) => n.customerId)
    expect(await inTab('reminded')).toContain(customerId)
    expect(await inTab('waiting')).not.toContain(customerId)
    expect((await merchant(`mutation { stopWishlistReminders(customerId: "${customerId}") }`, 'owner')).data?.['stopWishlistReminders']).toBe(true)
    expect(await inTab('stopped')).toContain(customerId)
    expect(await inTab('reminded')).not.toContain(customerId)
    const counts = (await merchant('{ wishlistShopperCounts { waiting reminded stopped } wishlistShopperCount wishlistSummary { days shoppers products reachable remindersSent reminded } }', 'owner')).data as {
      wishlistShopperCounts: { waiting: number; reminded: number; stopped: number }
      wishlistShopperCount: number
      wishlistSummary: { days: number; shoppers: number; products: number; reachable: number; remindersSent: number; reminded: number }
    }
    const c = counts.wishlistShopperCounts
    expect(c.waiting + c.reminded + c.stopped).toBe(counts.wishlistShopperCount)
    expect(c.stopped).toBeGreaterThanOrEqual(1)
    expect(counts.wishlistSummary).toMatchObject({ days: 14, shoppers: counts.wishlistShopperCount })
    expect(counts.wishlistSummary.remindersSent).toBeGreaterThanOrEqual(1)
    expect(counts.wishlistSummary.reminded).toBeGreaterThanOrEqual(1)
    expect(counts.wishlistSummary.products).toBeGreaterThanOrEqual(counts.wishlistSummary.shoppers)
    expect((await merchant('{ wishlistSummary(days: 1) { days } }', 'staff')).data).toMatchObject({ wishlistSummary: { days: 1 } })
    expect((await merchant('{ wishlistShopperCounts { waiting } }', 'supplier')).code).toBe('FORBIDDEN')
    expect((await merchant('{ wishlistSummary { shoppers } }', 'supplier')).code).toBe('FORBIDDEN')
    expect((await merchant(`mutation { resumeWishlistReminders(customerId: "${customerId}") }`, 'owner')).data?.['resumeWishlistReminders']).toBe(true)
  })
})
