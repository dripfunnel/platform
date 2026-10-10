import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleDownload } from '#apis/shop/downloads'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { hashGiftCardCode, normaliseGiftCardCode } from '#auth/giftCardCodes'
import { hashSessionId } from '#auth/session'
import { resolveShopper } from '#auth/shopCaller'
import { linkSigner } from '#auth/signedLink'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { TenantContext } from '#core/tenancy'
import { suppressAll } from '#db/scoped/emailSuppression'
import { withScope, withSystemScope } from '#db/scoped/index'
import { applyOutcome } from '#engine/modules/checkout/index'
import { deliverOrder } from '#engine/modules/deliveries/index'
import { SesUnavailable, type OutgoingEmail, type SesApi } from '#integrations/ses/index'
import { emailDeliverer } from '#jobs/queues/deliverers/email'
import { activityLog } from '#saas/activity/index'
import { prepareEmail } from '#saas/email/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #323 (SAPI 22), part 2: each kind delivered once paid and never before (CatEditor; FIRST-RELEASE §19): a download's
// signed, expiring link served from R2 with one refusal, keys from the pool (and new keys to the orders left waiting), and
// a gift card issued and emailed on the morning its buyer chose, its code in that email alone.

let db: TestDatabase
let t: Tenants
const host = 'kesari.shops.acme.example'
const otherHost = 'surat.shops.acme.example'
const stores = { kesari: '', surat: '' }
const v = { pack: '', keys: '', card: '', lesson: '' }
let keysProduct = ''
let ownerCookie = ''
const kek = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
let signer: Awaited<ReturnType<typeof linkSigner>>
const bucket = new Map<string, Uint8Array>()
const files = { get: async (key: string) => (bucket.has(key) ? { body: new Response(bucket.get(key)?.slice()).body as ReadableStream } : null) }

const store = async (name: string, code: string) =>
  (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status, time_zone) values (${t.partnerA}, ${name}, ${code}, 'IN', 'INR', 'active', 'Asia/Kolkata') returning id`)[0]?.id ?? ''

const product = async (storeId: string, slug: string, type: string, kind: Record<string, unknown> = {}, amount = 90000) => {
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility, product_type) values (${storeId}, ${slug}, ${slug}, 'visible', ${type}) returning id`
  if (Object.keys(kind).length > 0) await db.sql`update product set ${db.sql(kind)} where id = ${p?.id ?? ''}`
  const id = (await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, position, track_stock) values (${storeId}, ${p?.id ?? ''}, 0, false) returning id`)[0]?.id ?? ''
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${id}, ${storeId}, 'INR', ${amount})`
  return { productId: p?.id ?? '', versionId: id }
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  signer = await linkSigner(kek, 'download-links')
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  stores.kesari = await store('Kesari', 'kesari')
  stores.surat = await store('Surat', 'surat')
  const key = `stores/${stores.kesari}/assets/00000000-0000-4000-8000-000000000001.pdf`
  bucket.set(key, new TextEncoder().encode('%PDF-1.7 twelve motifs'))
  const [asset] = await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${stores.kesari}, ${key}, 'file', 'application/pdf', 22, ${'0'.repeat(64)}) returning id`
  v.pack = (await product(stores.kesari, 'pattern-pack', 'digital', { download_mode: 'file', download_asset_id: asset?.id, download_limit: 3, download_days: 7 })).versionId
  const keys = await product(stores.kesari, 'font-licence', 'digital', { download_mode: 'keys' })
  v.keys = keys.versionId
  keysProduct = keys.productId
  await db.sql`insert into licence_key (store_id, product_id, key) values (${stores.kesari}, ${keysProduct}, 'KEY-ONE')`
  v.card = (await product(stores.kesari, 'gift-card', 'gift_card', { gift_card_expiry_months: 12 }, 100000)).versionId
  v.lesson = (await product(stores.kesari, 'block-printing-class', 'service', { service_duration: '2 hours' })).versionId
  await db.sql`insert into payment_provider_account (store_id, provider, status, bank_details) values (${stores.kesari}, 'bank_transfer', 'live', 'HDFC 1'), (${stores.surat}, 'bank_transfer', 'live', 'HDFC 2')`
  const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'owner@kesari.example', 'O', 'active') returning id`
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${u?.id ?? ''}, ${stores.kesari}, 'owner', 'active')`
  ownerCookie = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const shopContext = async (on: string, cart: string | null): Promise<ShopContext> => {
  const found = await resolveShopper(db.sql, new Request(`https://${on}/shop-api`, { headers: cart ? { 'x-shop-cart': cart } : {} }), on)
  if (found.kind !== 'found') throw new Error('no store')
  return { sql: db.sql, shopper: found.shopper, origin: `https://${on}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.5', userAgent: null }, couriers: null, allowAttempt: async () => true, allowNewCart: async () => true, downloadLinks: signer, now: () => new Date() }
}
const shop = async (source: string, cart: string | null = null, variables: Record<string, unknown> = {}, on = host) => {
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue: await shopContext(on, cart), variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const merchant = async (source: string) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers: { cookie: `${storeCookieName}=${ownerCookie}`, [storeHeader]: stores.kesari } }), t.partnerA, new Date(), activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const addMutation = 'mutation A($v: ID!, $q: Int!, $g: ShopGiftCardInput) { addToCart(versionId: $v, quantity: $q, gift: $g) { cartToken cart { lines { versionId quantity gift { recipientName recipientEmail message sendOn } } } } }'
const add = async (versionId: string, quantity: number, gift: Record<string, unknown> | null = null, cart: string | null = null) => {
  const result = await shop(addMutation, cart, { v: versionId, q: quantity, g: gift })
  const change = result.data?.['addToCart'] as { cartToken: string | null; cart: { lines: { versionId: string; quantity: number; gift: Record<string, unknown> | null }[] } } | undefined
  return { token: change?.cartToken ?? cart ?? '', lines: change?.cart.lines ?? [], code: result.code }
}
const sendOn = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
const meera = { recipientName: 'Meera Iyer', recipientEmail: 'Meera@Example.com', message: 'Happy Diwali!', sendOn }

/** A guest's order of these lines placed by bank transfer, unpaid. */
const placed = async (lines: { versionId: string; quantity?: number; gift?: Record<string, unknown> }[], on = host) => {
  let token: string | null = null
  for (const l of lines) {
    const result = await shop(addMutation, token, { v: l.versionId, q: l.quantity ?? 1, g: l.gift ?? null }, on)
    const fresh: string | null = (result.data?.['addToCart'] as { cartToken: string | null } | undefined)?.cartToken ?? null
    token = fresh ?? token
  }
  await shop('mutation { setCartContact(email: "asha@example.com") { cart { id } } }', token, {}, on)
  await shop('mutation { checkout { readyToPay } }', token, {}, on)
  const order = (await shop('mutation { placeOrder(provider: "bank_transfer") { orderId } }', token, {}, on)).data?.['placeOrder'] as { orderId: string }
  return { orderId: order.orderId, token: token ?? '' }
}
const markPaid = async (orderId: string) => (await merchant(`mutation { markOrderPaid(orderId: "${orderId}") }`)).data?.['markOrderPaid']
const orderView = async (orderId: string, token: string) =>
  (await shop(`{ order(id: "${orderId}") { downloads { name url usesLeft expiresAt } licenceKeys { name key } lines { name gift { recipientName sendOn } } } }`, token)).data?.['order'] as {
    downloads: { name: string; url: string | null; usesLeft: number; expiresAt: string }[]
    licenceKeys: { name: string; key: string }[]
    lines: { name: string; gift: { recipientName: string; sendOn: string | null } | null }[]
  }
const fetchDownload = async (url: string, allow = true) => {
  const target = new URL(url)
  const context = { ...(await shopContext(target.host, null)), allowAttempt: async () => false, allowDownload: async () => allow }
  const response = await handleDownload(new Request(url), context, files)
  return { status: response.status, text: await response.text(), disposition: response.headers.get('content-disposition') }
}
const emailFor = (payload: Record<string, unknown>, storeId = stores.kesari) =>
  withSystemScope(db.sql, (tx) => prepareEmail(tx, { payload, partnerId: t.partnerA, storeId }, { adminHost: 'admin.example', platformHost: 'platform.example', downloadLinks: signer }, new Date()))

describe('a gift card in the cart', () => {
  it('takes one card a line for a recipient, and refuses a recipient on anything else', async () => {
    expect((await add(v.card, 1)).code).toBe('INVALID_INPUT')
    expect((await add(v.card, 2, meera)).code).toBe('INVALID_INPUT')
    expect((await add(v.card, 1, { ...meera, recipientEmail: 'not-an-email' })).code).toBe('INVALID_INPUT')
    expect((await add(v.card, 1, { ...meera, message: 'x'.repeat(201) })).code).toBe('INVALID_INPUT')
    expect((await add(v.card, 1, { ...meera, sendOn: '2099-01-01' })).code).toBe('INVALID_INPUT')
    expect((await add(v.pack, 1, meera)).code).toBe('INVALID_INPUT')
    const { token, lines } = await add(v.card, 1, meera)
    expect(lines).toEqual([{ versionId: v.card, quantity: 1, gift: { recipientName: 'Meera Iyer', recipientEmail: 'meera@example.com', message: 'Happy Diwali!', sendOn } }])
    // The recipient chosen last: still one card.
    expect((await add(v.card, 1, { ...meera, recipientName: 'Rohan' }, token)).lines).toMatchObject([{ quantity: 1, gift: { recipientName: 'Rohan' } }])
    expect((await shop(`mutation { setCartQuantity(versionId: "${v.card}", quantity: 2) { cart { id } } }`, token)).code).toBe('INVALID_INPUT')
  })
})

let order = { orderId: '', token: '' }
let shortOrder = { orderId: '', token: '' }

describe('delivery', () => {
  it('hands out nothing before payment, and on "Mark as paid" a download, a key and a gift card, once', async () => {
    order = await placed([{ versionId: v.pack }, { versionId: v.keys }, { versionId: v.card, gift: meera }, { versionId: v.lesson }])
    // Placed while the pool's one key looked free to both: keys are taken at payment, as stock is.
    shortOrder = await placed([{ versionId: v.keys }])
    expect(await orderView(order.orderId, order.token)).toMatchObject({ downloads: [], licenceKeys: [] })
    expect(await db.sql`select id from gift_card`).toEqual([])
    expect(await markPaid(order.orderId)).toBe(true)
    const seen = await orderView(order.orderId, order.token)
    expect(seen.downloads).toMatchObject([{ name: 'pattern-pack', usesLeft: 3 }])
    expect(seen.downloads[0]?.url).toMatch(new RegExp(`^https://${host.replaceAll('.', '\\.')}/shop-api/downloads/[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43}$`))
    expect(seen.licenceKeys).toEqual([{ name: 'font-licence', key: 'KEY-ONE' }])
    expect(seen.lines.find((l) => l.name === 'gift-card')?.gift).toEqual({ recipientName: 'Meera Iyer', sendOn })
    const [card] = await db.sql<{ initial_amount: string; balance_amount: string; currency: string; code_hash: string | null; expiry_months: number }[]>`select initial_amount::text, balance_amount::text, currency, code_hash, expiry_months from gift_card`
    expect(card).toEqual({ initial_amount: '100000', balance_amount: '100000', currency: 'INR', code_hash: null, expiry_months: 12 })
    expect(await db.sql`select kind, amount::text from gift_card_movement`).toEqual([{ kind: 'issued', amount: '100000' }])
    // The card's email waits for 08:00 in Jaipur on the day chosen; the links go now.
    const emails = await db.sql<{ template: string; due: Date }[]>`select payload ->> 'template' as template, next_attempt_at as due from outbox where kind = 'email' and store_id = ${stores.kesari} order by template`
    expect(emails.map((e) => e.template)).toEqual(['gift-card', 'order-downloads'])
    expect(emails[0]?.due.toISOString()).toBe(`${sendOn}T02:30:00.000Z`)
    // A replay of the payment hands out nothing again.
    await withSystemScope(db.sql, (tx) => deliverOrder(tx, activityLog, stores.kesari, order.orderId, new Date()))
    expect(await db.sql`select (select count(*) from gift_card)::int as cards, (select count(*) from order_download)::int as downloads, (select count(*) from licence_key where order_line_id is not null)::int as keys`).toEqual([{ cards: 1, downloads: 1, keys: 1 }])
  })

  it('serves the file from R2 as an attachment, a use at a time, with one refusal for a link that won’t open', async () => {
    const url = (await orderView(order.orderId, order.token)).downloads[0]?.url ?? ''
    const first = await fetchDownload(url)
    expect(first).toMatchObject({ status: 200, text: '%PDF-1.7 twelve motifs', disposition: 'attachment; filename="pattern-pack.pdf"' })
    expect((await orderView(order.orderId, order.token)).downloads[0]?.usesLeft).toBe(2)
    const refused = (await fetchDownload(`${url.slice(0, -4)}AAAA`))
    expect(refused.status).toBe(404)
    // Another shop of the same partner, an unknown grant, an expired link, a used-up one: the same answer, word for word.
    expect(await fetchDownload(url.replace(host, otherHost))).toEqual(refused)
    expect(await fetchDownload(`https://${host}/shop-api/downloads/${crypto.randomUUID()}.${url.split('.').pop()}`)).toEqual(refused)
    await db.sql`update order_download set expires_at = now() - interval '1 minute'`
    expect(await fetchDownload(url)).toEqual(refused)
    await db.sql`update order_download set expires_at = now() + interval '1 day', uses_left = 0`
    expect(await fetchDownload(url)).toEqual(refused)
    await db.sql`update order_download set uses_left = 2`
    expect((await fetchDownload(url, false)).status).toBe(429)
  })

  it('sends the gift card’s code in its email alone, once, and the links and key in the order’s', async () => {
    const [{ id } = { id: '' }] = await db.sql<{ id: string }[]>`select id from gift_card`
    const prepared = await emailFor({ template: 'gift-card', giftCardId: id })
    if (!prepared.send) throw new Error(prepared.reason)
    expect(prepared.to).toEqual(['meera@example.com'])
    const line = prepared.content.paragraphs.find((p) => p.startsWith('Your gift card number: ')) ?? ''
    const code = normaliseGiftCardCode(line.slice('Your gift card number: '.length)) ?? ''
    const [row] = await db.sql<{ code_hash: string; code_last4: string; months: number }[]>`select code_hash, code_last4, extract(month from age(expires_at, sent_at))::int + 12 * extract(year from age(expires_at, sent_at))::int as months from gift_card`
    expect(row).toEqual({ code_hash: await hashGiftCardCode(stores.kesari, code), code_last4: code.slice(-4), months: 12 })
    expect(prepared.content.paragraphs).toContain('“Happy Diwali!”')
    expect(await emailFor({ template: 'gift-card', giftCardId: id })).toEqual({ send: false, reason: 'link_closed' })
    expect(await emailFor({ template: 'gift-card', giftCardId: id }, stores.surat)).toEqual({ send: false, reason: 'tenant_mismatch' })
    const links = await emailFor({ template: 'order-downloads', orderId: order.orderId })
    if (!links.send) throw new Error(links.reason)
    expect(links.to).toEqual(['asha@example.com'])
    expect(links.content.paragraphs.some((p) => p.startsWith(`pattern-pack: https://${host}/shop-api/downloads/`))).toBe(true)
    expect(links.content.paragraphs).toContain('font-licence, your licence key: KEY-ONE')
  })

  it('keeps a gift card unsent, its code unset, whenever its email is skipped or fails, and sends it once nothing stands in the way', async () => {
    const [p] = await db.sql<{ product_id: string }[]>`select product_id from product_version where id = ${v.card}`
    const [made] = await db.sql<{ id: string }[]>`insert into gift_card (store_id, product_id, currency, initial_amount, balance_amount, recipient_email, issued_by)
      values (${stores.kesari}, ${p?.product_id ?? ''}, 'INR', 5000, 5000, 'blocked@example.com', ${crypto.randomUUID()}) returning id`
    const id = made?.id ?? ''
    const unsent = async () => (await db.sql<{ unsent: boolean }[]>`select code_hash is null and sent_at is null as unsent from gift_card where id = ${id}`)[0]?.unsent
    const payload = { template: 'gift-card', giftCardId: id }
    // Asked for by another store's or another partner's row: refused before anything is written.
    expect(await emailFor(payload, stores.surat)).toEqual({ send: false, reason: 'tenant_mismatch' })
    const hosts = { adminHost: 'admin.example', platformHost: 'platform.example', downloadLinks: signer }
    expect(await withSystemScope(db.sql, (tx) => prepareEmail(tx, { payload, partnerId: t.partnerB, storeId: stores.kesari }, hosts, new Date()))).toEqual({ send: false, reason: 'tenant_mismatch' })
    expect(await unsent()).toBe(true)
    // A suppressed recipient, and SES down: the code set while composing is rolled back with the message.
    const suppressionKey = btoa('k'.repeat(32))
    await withSystemScope(db.sql, (tx) => suppressAll(tx, suppressionKey, ['blocked@example.com'], 'bounce', new Date()))
    const sent: OutgoingEmail[] = []
    let sesUp = true
    const ses: SesApi = {
      send: async (email) => {
        if (!sesUp) throw new SesUnavailable('down')
        sent.push(email)
        return { messageId: `m-${sent.length}` }
      },
    }
    const deliver = () =>
      emailDeliverer(db.sql, ses, { hosts, senderDomain: 'mail.test', suppressionKey }).deliver(
        { id: crypto.randomUUID(), kind: 'email', idempotencyKey: `gift-card:${id}`, payload, partnerId: t.partnerA, storeId: stores.kesari, attempt: 1 },
        new AbortController().signal,
      )
    await deliver()
    expect(sent).toEqual([])
    expect(await unsent()).toBe(true)
    await db.sql`delete from email_suppression`
    sesUp = false
    await expect(deliver()).rejects.toThrow(SesUnavailable)
    expect(await unsent()).toBe(true)
    sesUp = true
    await deliver()
    expect(sent).toHaveLength(1)
    expect(await unsent()).toBe(false)
  })

  it('logs an order the key pool ran dry for, and gives it the merchant’s next keys', async () => {
    const short = shortOrder
    expect(await markPaid(short.orderId)).toBe(true)
    expect((await orderView(short.orderId, short.token)).licenceKeys).toEqual([])
    expect(await db.sql`select reason from activity_log where action = 'order.licence_keys_short' and target_id = ${short.orderId}`).toEqual([{ reason: '1' }])
    const added = await merchant(`mutation { addLicenceKeys(productId: "${keysProduct}", keys: ["KEY-TWO", "KEY-THREE"]) { download { keysLeft keysSold } } }`)
    expect(added.data?.['addLicenceKeys']).toEqual({ download: { keysLeft: 1, keysSold: 2 } })
    const keys = (await orderView(short.orderId, short.token)).licenceKeys
    expect(keys).toHaveLength(1)
    expect(['KEY-TWO', 'KEY-THREE']).toContain(keys[0]?.key)
    expect(await db.sql`select count(*)::int as n from outbox where kind = 'email' and payload ->> 'orderId' = ${short.orderId}`).toEqual([{ n: 1 }])
  })

  it('delivers a card payment as its provider confirms it, and only once it does', async () => {
    const card = await placed([{ versionId: v.pack }])
    await db.sql`update "order" set payment_method = 'stripe' where id = ${card.orderId}`
    await db.sql`update payment set provider = 'stripe', kind = 'card', provider_ref = ${`pi_${card.orderId}`} where order_id = ${card.orderId}`
    const deps = { sql: db.sql, activity: activityLog, now: () => new Date() }
    expect(await applyOutcome(deps, 'stripe', `pi_${card.orderId}`, { state: 'pending' })).toBe('pending')
    expect(await db.sql`select id from order_download where order_id = ${card.orderId}`).toEqual([])
    expect(await applyOutcome(deps, 'stripe', `pi_${card.orderId}`, { state: 'captured', amount: { amount: 90000n, currency: 'INR' } })).toBe('paid')
    expect(await db.sql`select uses_left from order_download where order_id = ${card.orderId}`).toEqual([{ uses_left: 3 }])
  })

  it('closes a refunded order’s links and hides its keys, on the order page, the link and the email', async () => {
    const bought = await placed([{ versionId: v.pack }, { versionId: v.keys }])
    expect(await markPaid(bought.orderId)).toBe(true)
    const seen = await orderView(bought.orderId, bought.token)
    expect(seen.licenceKeys).toHaveLength(1)
    const url = seen.downloads[0]?.url ?? ''
    expect((await fetchDownload(url)).status).toBe(200)
    expect((await merchant(`mutation { cancelOrder(orderId: "${bought.orderId}", reason: store) }`)).data?.['cancelOrder']).toBe(true)
    expect(await db.sql`select payment_state from "order" where id = ${bought.orderId}`).toEqual([{ payment_state: 'refunded' }])
    expect(await orderView(bought.orderId, bought.token)).toMatchObject({ downloads: [], licenceKeys: [] })
    const refused = await fetchDownload(url)
    expect(refused.status).toBe(404)
    expect(refused.text).toContain('LINK_CLOSED')
    expect(await emailFor({ template: 'order-downloads', orderId: bought.orderId })).toEqual({ send: false, reason: 'link_closed' })
  })

  it('never sends a gift card whose order was refunded before its day', async () => {
    const bought = await placed([{ versionId: v.card, gift: meera }])
    expect(await markPaid(bought.orderId)).toBe(true)
    const [card] = await db.sql<{ id: string }[]>`select g.id from gift_card g join order_line l on l.id = g.order_line_id where l.order_id = ${bought.orderId}`
    expect((await merchant(`mutation { cancelOrder(orderId: "${bought.orderId}", reason: store) }`)).data?.['cancelOrder']).toBe(true)
    expect(await emailFor({ template: 'gift-card', giftCardId: card?.id ?? '' })).toEqual({ send: false, reason: 'link_closed' })
    expect(await db.sql`select code_hash, sent_at from gift_card where id = ${card?.id ?? ''}`).toEqual([{ code_hash: null, sent_at: null }])
  })

  it('hands nothing out for a preview’s test order', async () => {
    const test = await placed([{ versionId: v.pack }])
    await db.sql`update payment set mode = 'test' where order_id = ${test.orderId}`
    await markPaid(test.orderId)
    expect(await db.sql`select id from order_download where order_id = ${test.orderId}`).toEqual([])
  })
})

describe('isolation', () => {
  const guest = async (presented: string | null): Promise<TenantContext> => ({
    caller: { kind: 'shopper', customerId: null, orderTokenHash: presented ? await hashSessionId(presented) : null },
    partnerId: t.partnerA,
    storeId: stores.kesari,
    sellerScope: { kind: 'all' },
    subscription: 'active',
  })
  const merchantOf = (storeId: string, seller: string | null = null): TenantContext => ({ caller: { kind: 'person', userId: 'u', sessionId: 's' }, partnerId: t.partnerA, storeId, sellerScope: seller ? { kind: 'seller', sellerId: seller } : { kind: 'all' }, subscription: 'active' })

  it('shows a download and a key only to the guest whose order took it, and a gift card to no shopper', async () => {
    expect(await withScope(db.sql, await guest(order.token), (tx) => tx`select id from order_download`)).toHaveLength(1)
    expect(await withScope(db.sql, await guest(order.token), (tx) => tx`select key from licence_key`)).toEqual([{ key: 'KEY-ONE' }])
    expect(await withScope(db.sql, await guest('f'.repeat(64)), (tx) => tx`select id from order_download`)).toHaveLength(0)
    expect(await withScope(db.sql, await guest('f'.repeat(64)), (tx) => tx`select key from licence_key`)).toHaveLength(0)
    await expect(withScope(db.sql, await guest(order.token), (tx) => tx`update order_download set uses_left = 99`)).rejects.toThrow(/permission denied/)
    for (const table of ['gift_card', 'gift_card_movement']) {
      await expect(withScope(db.sql, await guest(order.token), (tx) => tx.unsafe(`select id from ${table}`))).rejects.toThrow(/permission denied/)
    }
    // The merchant side reads its cards issued (part 3), never their ledger rows or a code's hash.
    await expect(withScope(db.sql, merchantOf(stores.kesari), (tx) => tx`select id from gift_card_movement`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, merchantOf(stores.kesari), (tx) => tx`select code_hash from gift_card`)).rejects.toThrow(/permission denied/)
    expect(await withScope(db.sql, merchantOf(stores.kesari), (tx) => tx`select id from order_download`)).not.toHaveLength(0)
    expect(await withScope(db.sql, merchantOf(stores.surat), (tx) => tx`select id from order_download`)).toHaveLength(0)
    await expect(withScope(db.sql, merchantOf(stores.kesari, t.sellerA1First), (tx) => tx`select id from order_download`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, { caller: { kind: 'partner-user', partnerUserId: crypto.randomUUID() }, partnerId: t.partnerA }, (tx) => tx`select id from order_download`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, { caller: { kind: 'staff', staffId: crypto.randomUUID() } }, (tx) => tx`select id from gift_card`)).rejects.toThrow(/permission denied/)
  })
})
