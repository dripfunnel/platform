import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveShopper } from '#auth/shopCaller'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { deleteExpiredCarts } from '#db/scoped/cart'
import { suppressAll } from '#db/scoped/emailSuppression'
import { withScope, withSystemScope } from '#db/scoped/index'
import { markAbandonedCarts, queueDueReminders } from '#engine/modules/cartReminders/index'
import type { OutgoingEmail, SesApi } from '#integrations/ses/index'
import { cartRemindDeliverer } from '#jobs/queues/deliverers/cartRemind'
import { emailDeliverer } from '#jobs/queues/deliverers/email'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #321 (SAPI 15), part 1: abandoned carts and their reminders (FIRST-RELEASE §9, §19; DATA-MODEL §7.2, §7.6): a cart
// left in checkout is marked, each step is sent once by email with its link and unsubscribe, the link restores the cart in
// its own store only, a reminder's code works on its own cart only, and a purchase stops the reminders.

let db: TestDatabase
let t: Tenants
const host = 'jaipur.shops.acme.example'
const otherHost = 'surat.shops.acme.example'
const suppressionKey = btoa('k'.repeat(32))
let store = ''
let surat = ''
let kurta = ''
let scarf = ''
const plans = { pro: '', starter: '', free: '' }
type Who = 'owner' | 'manager' | 'staff' | 'supplier' | 'surat'
const cookies = {} as Record<Who, string>
let attempts: { allow: boolean; keys: string[] } = { allow: true, keys: [] }
const sent: OutgoingEmail[] = []
const ses: SesApi = { send: async (email) => (sent.push(email), { messageId: `m-${sent.length}` }) }

const facts = { requestId: 'r', ip: '203.0.113.5', userAgent: null }
const shop = async (source: string, cart: string | null = null, on = host) => {
  const found = await resolveShopper(db.sql, new Request(`https://${on}/shop-api`, { headers: cart ? { 'x-shop-cart': cart } : {} }), on)
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = {
    sql: db.sql, shopper: found.shopper, origin: `https://${on}`, activity: activityLog, facts, couriers: null, allowAttempt: async () => true, allowNewCart: async () => true,
    allowCodeAttempt: async (key) => (attempts.keys.push(key), attempts.allow), now: () => new Date(),
  }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const merchant = async (source: string, who: Who, variables: Record<string, unknown> = {}, as: { support?: 'read' } = {}) => {
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'surat' ? surat : store, ...(who === 'supplier' ? { [supplierHeader]: seller } : {}) }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing = as.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } } } }
    : resolved
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, extensions: result.errors?.[0]?.extensions }
}
let seller = ''

const subscribe = async (storeId: string, planId: string) => {
  await db.sql`update store set plan_id = ${planId} where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${t.partnerA}, ${planId}, 1, 'active', 'month', 'INR', 0, now(), now() + interval '30 days')`
}

const step = (position: number, o: Record<string, unknown> = {}) => ({
  position, enabled: true, delayMinutes: [30, 1440, 4320][position - 1], channel: 'email', subject: `Reminder ${position}`, body: 'Your cart is waiting.', discountPercent: null, ...o,
})
const settings = (o: Record<string, unknown> = {}, steps: Record<string, unknown>[] = [step(1), step(2), step(3)]) => ({ enabled: true, skipOutOfStock: true, quietHours: false, weeklyCap: false, steps, ...o })
const saveSettings = `mutation S($revision: Int, $input: ReminderSettingsInput!) { saveReminderSettings(revision: $revision, input: $input) }`
const readSettings = '{ reminderSettings { enabled minimum { amount currency } quietHours steps { position enabled delayMinutes channel subject discountPercent } revision level } }'
/** Sets the store's sequence directly, whatever was saved before. */
const flow = async (storeId: string, o: { enabled?: boolean; quiet?: boolean; weekly?: boolean; min?: bigint | null; skipOos?: boolean; steps?: { position: number; enabled?: boolean; delay?: number; discount?: number | null }[] } = {}) => {
  await db.sql`delete from cart_reminder where store_id = ${storeId}`
  await db.sql`delete from cart_reminder_step where store_id = ${storeId}`
  await db.sql`delete from cart_reminder_flow where store_id = ${storeId}`
  await db.sql`insert into cart_reminder_flow (store_id, enabled, min_amount, currency, skip_out_of_stock, quiet_hours, weekly_cap)
    values (${storeId}, ${o.enabled ?? true}, ${o.min === undefined || o.min === null ? null : o.min.toString()}, ${o.min ? 'INR' : null}, ${o.skipOos ?? true}, ${o.quiet ?? false}, ${o.weekly ?? false})`
  for (const s of o.steps ?? [{ position: 1 }]) {
    await db.sql`insert into cart_reminder_step (store_id, position, enabled, delay_minutes, channel, subject, body, discount_bps)
      values (${storeId}, ${s.position}, ${s.enabled ?? true}, ${s.delay ?? [30, 1440, 4320][s.position - 1] ?? 30}, 'email', ${`Reminder ${s.position}`}, 'Your cart is waiting.', ${s.discount ? s.discount * 100 : null})`
  }
}

const add = async (versionId: string, quantity: number, token: string | null = null, on = host) => {
  const r = await shop(`mutation { addToCart(versionId: "${versionId}", quantity: ${quantity}) { cartToken cart { id } } }`, token, on)
  const change = r.data?.['addToCart'] as { cartToken: string | null; cart: { id: string } }
  return { token: token ?? change.cartToken ?? '', id: change.cart.id }
}
/** A guest's cart with an email, left in checkout `minutesAgo` minutes ago. */
const left = async (email: string | null, minutesAgo: number, o: { on?: string; version?: string } = {}) => {
  const cart = await add(o.version ?? kurta, 1, null, o.on ?? host)
  await shop(`mutation { setCartContact(${email ? `email: "${email}"` : 'phone: "+919812345678"'}) { cart { id } } }`, cart.token, o.on ?? host)
  await db.sql`update "order" set updated_at = now() - make_interval(mins => ${minutesAgo}) where id = ${cart.id}`
  return cart
}
const jobs = { sql: undefined as unknown as TestDatabase['sql'], now: () => new Date() }
const sweep = async () => {
  await markAbandonedCarts({ ...jobs, sql: db.sql }, 100)
  return queueDueReminders({ ...jobs, sql: db.sql }, 200)
}
const relay = async () => {
  const [row] = await db.sql<{ now: Date }[]>`select now() + interval '1 second' as now`
  const at = row?.now ?? new Date()
  const hosts = { adminHost: 'admin.dripfunnel.test', platformHost: 'platform.dripfunnel.test' }
  return relayDue(db.sql, { 'cart.remind': cartRemindDeliverer(db.sql, suppressionKey), email: emailDeliverer(db.sql, ses, { hosts, senderDomain: 'mail.dripfunnel.test', suppressionKey }) }, { ...defaultRelayOptions, now: () => at })
}
/** Sweeps and delivers until nothing more goes: the cron and the outbox, as the Worker runs them. */
const run = async () => {
  await sweep()
  for (let i = 0; i < 3; i++) await relay()
}
const reminders = (orderId: string) =>
  db.sql<{ state: string; skip_reason: string | null; channel: string | null; position: number | null; promotion_code_id: string | null; clicked_at: Date | null }[]>`
    select r.state, r.skip_reason, r.channel, st.position, r.promotion_code_id, r.clicked_at from cart_reminder r left join cart_reminder_step st on st.id = r.step_id
    where r.order_id = ${orderId} order by r.queued_at`
const linkOf = (email: OutgoingEmail | undefined, path: 'cart/r' | 'unsubscribe') => new RegExp(`https://([^/\\s]+)/${path}/([0-9a-f]{64})`).exec(email?.text ?? '')
const mailTo = (address: string) => sent.filter((e) => e.to.includes(address))

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  const make = async (name: string, code: string, country: string) =>
    (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status, address) values (${t.partnerA}, ${name}, ${code}, ${country}, 'INR', 'active', ${db.sql.json({ street: '1 MI Road', city: 'Jaipur' })}) returning id`)[0]?.id ?? ''
  store = await make('Jaipur', 'jaipur', 'IN')
  surat = await make('Surat', 'surat', 'IN')
  const product = async (storeId: string, name: string, price: number) => {
    const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, ${name}, ${name.toLowerCase()}, 'visible') returning id`
    const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${storeId}, ${p?.id ?? ''}, ${name}, 0, true) returning id`
    await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${v?.id ?? ''}, ${storeId}, 'INR', ${price})`
    await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${v?.id ?? ''}, w.id, ${storeId}, 100 from warehouse w where w.store_id = ${storeId} and w.is_default`
    return v?.id ?? ''
  }
  kurta = await product(store, 'Kurta', 100000)
  scarf = await product(store, 'Scarf', 20000)
  await product(surat, 'Saree', 300000)
  await db.sql`insert into store_shipping (store_id, flat_enabled, flat_amount, pickup_enabled, pickup_hours, currency, area_mode, saved_at, revision)
    values (${store}, true, 5000, true, 'Mon–Sat', 'INR', 'everywhere', now(), 1)`
  await db.sql`insert into payment_provider_account (store_id, provider, status) values (${store}, 'cod', 'live')`
  const plan = async (name: string, level: number) => {
    const [row] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerA}, ${name}, 'live') returning id`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${row?.id ?? ''}, ${t.partnerA}, 1, 'cart_reminders', ${level})`
    return row?.id ?? ''
  }
  plans.pro = await plan('Growth Pro', 2)
  plans.starter = await plan('Growth', 1)
  plans.free = await plan('Free', 0)
  await subscribe(store, plans.pro)
  await subscribe(surat, plans.pro)
  seller = (await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status) values (${store}, 'Anand', 'vendor-stock', 'active') returning id`)[0]?.id ?? ''
  const person = async (email: string, role: string, storeId = store, sellerId: string | null = null) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${sellerId}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person('owner@jaipur.example', 'owner')
  cookies.manager = await person('manager@jaipur.example', 'manager')
  cookies.staff = await person('staff@jaipur.example', 'staff')
  cookies.supplier = await person('anand@jaipur.example', 'supplier-admin', store, seller)
  cookies.surat = await person('owner@surat.example', 'owner', surat)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(() => {
  attempts = { allow: true, keys: [] }
})

describe('the Reminders tab (reminderSettings, saveReminderSettings)', () => {
  it('reads the prototype’s starting sequence until the store saves its own, with what its plan allows', async () => {
    const r = (await merchant(readSettings, 'owner')).data?.['reminderSettings'] as Record<string, unknown>
    expect(r).toMatchObject({ enabled: false, minimum: null, quietHours: true, revision: null, level: 'automatic' })
    expect((r['steps'] as { delayMinutes: number; discountPercent: number | null }[]).map((s) => [s.delayMinutes, s.discountPercent])).toEqual([[60, null], [1440, 10], [4320, null]])
  })

  it('saves at the revision it read, refuses a stale one, and records the save', async () => {
    const first = await merchant(saveSettings, 'owner', { revision: null, input: settings({ minimum: { amount: '50000', currency: 'INR' } }) })
    expect(first.data?.['saveReminderSettings']).toBe(1)
    expect((await merchant(saveSettings, 'manager', { revision: 1, input: settings() })).data?.['saveReminderSettings']).toBe(2)
    expect((await merchant(saveSettings, 'owner', { revision: 1, input: settings() })).code).toBe('STALE_REVISION')
    expect((await merchant(saveSettings, 'owner', { revision: null, input: settings() })).code).toBe('STALE_REVISION')
    const [entry] = await db.sql<{ n: number }[]>`select count(*)::int as n from activity_log where action = 'cart_reminders.saved' and store_id = ${store}`
    expect(entry?.n).toBe(2)
  })

  it('refuses a sequence the tab would refuse: delays out of order, a missing subject, an unknown delay, a currency not sold', async () => {
    const bad = [
      settings({}, [step(1, { delayMinutes: 1440 }), step(2, { delayMinutes: 60 }), step(3)]),
      settings({}, [step(1, { subject: '  ' }), step(2), step(3)]),
      settings({}, [step(1, { delayMinutes: 45 }), step(2), step(3)]),
      settings({}, [step(1), step(2)]),
      settings({ minimum: { amount: '100', currency: 'USD' } }),
      settings({}, [step(1, { discountPercent: 12 }), step(2), step(3)]),
    ]
    for (const input of bad) expect((await merchant(saveSettings, 'owner', { revision: 2, input })).code).toBe('INVALID_INPUT')
  })

  it('offers WhatsApp to a store in India only (#337)', async () => {
    await db.sql`update store set country = 'US' where id = ${surat}`
    const whatsapp = settings({}, [step(1, { channel: 'whatsapp' }), step(2), step(3)])
    expect((await merchant(saveSettings, 'surat', { revision: null, input: whatsapp })).code).toBe('INVALID_INPUT')
    await db.sql`update store set country = 'IN' where id = ${surat}`
    expect((await merchant(saveSettings, 'surat', { revision: null, input: whatsapp })).data?.['saveReminderSettings']).toBe(1)
  })

  it('keeps each store’s sequence its own', async () => {
    const mine = (await merchant(readSettings, 'owner')).data?.['reminderSettings'] as { revision: number; minimum: unknown }
    const theirs = (await merchant(readSettings, 'surat')).data?.['reminderSettings'] as { revision: number; minimum: unknown; steps: { channel: string }[] }
    expect([mine.revision, theirs.revision, theirs.steps[0]?.channel]).toEqual([2, 1, 'whatsapp'])
  })

  it('lets Staff read and never save, refuses every supplier, and a read-only support session saves nothing (ACCESS §5.1, §8)', async () => {
    expect((await merchant(readSettings, 'staff')).data?.['reminderSettings']).toMatchObject({ revision: 2 })
    expect((await merchant(saveSettings, 'staff', { revision: 2, input: settings() })).code).toBe('FORBIDDEN')
    expect((await merchant(readSettings, 'supplier')).code).toBe('FORBIDDEN')
    expect((await merchant(saveSettings, 'supplier', { revision: 2, input: settings() })).code).toBe('FORBIDDEN')
    expect((await merchant(saveSettings, 'owner', { revision: 2, input: settings() }, { support: 'read' })).code).toBe('READ_ONLY')
  })

  it('holds the plan on the server: no automatic sending on You send, no follow-up or code below Growth Pro, but keeps what was saved', async () => {
    await subscribe(store, plans.free)
    expect((await merchant(readSettings, 'owner')).data?.['reminderSettings']).toMatchObject({ level: 'youSend' })
    // Already on: a save that keeps it on is fine, even on a plan that wouldn't let it be turned on.
    expect((await merchant(saveSettings, 'owner', { revision: 2, input: settings() })).data?.['saveReminderSettings']).toBe(3)
    await db.sql`update cart_reminder_flow set enabled = false where store_id = ${store}`
    const refused = await merchant(saveSettings, 'owner', { revision: 3, input: settings() })
    expect([refused.code, refused.extensions?.['key']]).toEqual(['PLAN_LIMIT', 'cart_reminders'])
    await subscribe(store, plans.starter)
    expect((await merchant(saveSettings, 'owner', { revision: 3, input: settings() })).data?.['saveReminderSettings']).toBe(4)
    const code = await merchant(saveSettings, 'owner', { revision: 4, input: settings({}, [step(1, { discountPercent: 10 }), step(2), step(3)]) })
    expect([code.code, code.extensions?.['unlockedBy']]).toEqual(['PLAN_LIMIT', { id: plans.pro, name: 'Growth Pro' }])
    await subscribe(store, plans.pro)
  })
})

describe('finding abandoned carts', () => {
  it('marks a cart left in checkout 20 minutes or more, with what it came to, and nothing fresher or untouched by checkout', async () => {
    await flow(store, { enabled: false })
    const stale = await left('meera@example.com', 25)
    const fresh = await left('ravi@example.com', 5)
    const browsing = await add(scarf, 2)
    await db.sql`update "order" set updated_at = now() - interval '2 hours' where id = ${browsing.id}`
    await sweep()
    const rows = await db.sql<{ id: string; abandoned: boolean; amount: string | null }[]>`
      select id, abandoned_at is not null as abandoned, abandoned_amount::text as amount from "order" where id in (${stale.id}, ${fresh.id}, ${browsing.id})`
    expect(Object.fromEntries(rows.map((r) => [r.id, [r.abandoned, r.amount]]))).toEqual({ [stale.id]: [true, '100000'], [fresh.id]: [false, null], [browsing.id]: [false, null] })
  })

  it('marks it again when the shopper comes back and leaves again, from the new time', async () => {
    const cart = await left('kiran@example.com', 30)
    await sweep()
    await add(kurta, 1, cart.token)
    await db.sql`update "order" set updated_at = now() - interval '21 minutes' where id = ${cart.id}`
    await sweep()
    const [row] = await db.sql<{ same: boolean; amount: string }[]>`select abandoned_at = updated_at as same, abandoned_amount::text as amount from "order" where id = ${cart.id}`
    expect(row).toEqual({ same: true, amount: '200000' })
  })
})

describe('sending a reminder', () => {
  it('sends the first step once by email, in the store’s name, with its return and unsubscribe links on the store’s own host', async () => {
    await flow(store)
    const cart = await left('asha@example.com', 45)
    await run()
    await run()
    const mail = mailTo('asha@example.com')
    expect(mail).toHaveLength(1)
    expect(mail[0]?.subject).toBe('Reminder 1')
    expect(mail[0]?.from).toContain('"Jaipur"')
    expect(mail[0]?.text).toContain('1 × Kurta: ₹1,000.00')
    expect(linkOf(mail[0], 'cart/r')?.[1]).toBe(host)
    expect(linkOf(mail[0], 'unsubscribe')?.[2]).toBe(linkOf(mail[0], 'cart/r')?.[2])
    expect(await reminders(cart.id)).toMatchObject([{ state: 'sent', channel: 'email', position: 1 }])
  })

  it('queues a step once however many sweeps run at the same moment', async () => {
    const cart = await left('twice@example.com', 45)
    await markAbandonedCarts({ ...jobs, sql: db.sql }, 100)
    const queued = await Promise.all([1, 2, 3, 4].map(() => queueDueReminders({ ...jobs, sql: db.sql }, 200)))
    expect(queued.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1)
    expect(await reminders(cart.id)).toHaveLength(1)
    // Two relays delivering at once still send one email: the reminder's row is decided and sent once.
    await Promise.all([relay(), relay()])
    await Promise.all([relay(), relay()])
    expect(mailTo('twice@example.com')).toHaveLength(1)
  })

  it('goes straight to the latest step due, never a burst of the ones it missed', async () => {
    await flow(store, { steps: [{ position: 1 }, { position: 2 }, { position: 3 }] })
    const cart = await left('late@example.com', 3 * 24 * 60 + 10)
    await run()
    expect((await reminders(cart.id)).map((r) => r.position)).toEqual([3])
    expect(mailTo('late@example.com').map((e) => e.subject)).toEqual(['Reminder 3'])
  })

  it('sends the next step from when the shopper left, and nothing once every step is sent', async () => {
    await flow(store, { steps: [{ position: 1 }, { position: 2 }] })
    const cart = await left('next@example.com', 45)
    await run()
    await db.sql`update "order" set abandoned_at = abandoned_at - interval '1 day', updated_at = updated_at - interval '1 day' where id = ${cart.id}`
    await run()
    await run()
    expect(mailTo('next@example.com').map((e) => e.subject)).toEqual(['Reminder 1', 'Reminder 2'])
  })

  it('sends nothing for a store whose plan sends by hand only, and only the first on Growth', async () => {
    await flow(store, { steps: [{ position: 1 }, { position: 2 }] })
    await subscribe(store, plans.free)
    const none = await left('free@example.com', 45)
    await run()
    expect(await reminders(none.id)).toEqual([])
    await subscribe(store, plans.starter)
    const one = await left('growth@example.com', 26 * 60)
    await run()
    expect((await reminders(one.id)).map((r) => r.position)).toEqual([1])
    await subscribe(store, plans.pro)
  })

  it('pauses a past-due store’s reminders, and a store with them off sends none (FIRST-RELEASE §1)', async () => {
    await flow(store)
    await db.sql`update store set status = 'past_due' where id = ${store}`
    const due = await left('pastdue@example.com', 45)
    await run()
    expect(await reminders(due.id)).toEqual([])
    await db.sql`update store set status = 'active' where id = ${store}`
    await flow(store, { enabled: false })
    await run()
    expect(await reminders(due.id)).toEqual([])
  })
})

describe('who is not reminded', () => {
  beforeEach(async () => {
    await flow(store)
  })
  const skipped = async (cart: { id: string }) => (await reminders(cart.id)).map((r) => [r.state, r.skip_reason])

  it('skips a cart under the minimum, and one where everything is out of stock (Carts)', async () => {
    await flow(store, { min: 150000n })
    const small = await left('small@example.com', 45)
    await run()
    expect(await skipped(small)).toEqual([['skipped', 'under_minimum']])
    await flow(store)
    await db.sql`update stock_level set on_hand = 0 where version_id = ${scarf}`
    const gone = await left('gone@example.com', 45, { version: scarf })
    await run()
    expect(await skipped(gone)).toEqual([['skipped', 'out_of_stock']])
    await db.sql`update stock_level set on_hand = 100 where version_id = ${scarf}`
  })

  it('skips a shopper who stopped marketing, one whose address bounced, and in an opt-in country one who never agreed', async () => {
    await db.sql`insert into customer (store_id, email, status, consent_state) values (${store}, 'stopped@example.com', 'unverified', 'stopped')`
    const stopped = await left('stopped@example.com', 45)
    await withSystemScope(db.sql, (tx) => suppressAll(tx, suppressionKey, ['bounced@example.com'], 'bounce', new Date()))
    const bounced = await left('bounced@example.com', 45)
    await run()
    expect([await skipped(stopped), await skipped(bounced)]).toEqual([[['skipped', 'opted_out']], [['skipped', 'undeliverable']]])
    await db.sql`update store set country = 'DE' where id = ${store}`
    const eu = await left('eu@example.com', 45)
    await db.sql`insert into customer (store_id, email, status, consent_state, consent_channels) values (${store}, 'agreed@example.com', 'unverified', 'opted_in', '{email}')`
    const agreed = await left('agreed@example.com', 45)
    await run()
    await db.sql`update store set country = 'IN' where id = ${store}`
    expect([await skipped(eu), (await reminders(agreed.id)).map((r) => r.state)]).toEqual([[['skipped', 'opted_out']], ['sent']])
  })

  it('reminds a shopper about one cart a week when the cap is on', async () => {
    await flow(store, { weekly: true })
    const first = await left('weekly@example.com', 45)
    await run()
    const second = await left('weekly@example.com', 45)
    await run()
    expect([(await reminders(first.id)).map((r) => r.state), await skipped(second)]).toEqual([['sent'], [['skipped', 'weekly_cap']]])
  })

  it('holds a reminder through quiet hours in the store’s time and sends it at 8 am', async () => {
    await flow(store, { quiet: true })
    const cart = await left('night@example.com', 45)
    await sweep()
    // 22:30 in Kolkata: held, not counted as an attempt, until 08:00 there, 9½ hours on.
    const night = new Date('2026-10-10T17:00:00Z')
    await relayDue(db.sql, { 'cart.remind': cartRemindDeliverer(db.sql, suppressionKey, () => night) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
    const [row] = await db.sql<{ wait: number; attempts: number; last_error: string }[]>`
      select round(extract(epoch from next_attempt_at - now()) / 3600)::int as wait, attempts, last_error from outbox where kind = 'cart.remind' and payload ->> 'reminderId' = (select id::text from cart_reminder where order_id = ${cart.id})`
    expect(row).toEqual({ wait: 10, attempts: 0, last_error: 'quiet_hours' })
    expect(await reminders(cart.id)).toMatchObject([{ state: 'queued' }])
  })

  it('stops for a cart whose reminders were stopped, and never queues a cart with no email', async () => {
    const stoppedCart = await left('halted@example.com', 45)
    await db.sql`update "order" set reminders_stopped_at = now() where id = ${stoppedCart.id}`
    const phoneOnly = await left(null, 45)
    await run()
    expect(await reminders(stoppedCart.id)).toEqual([])
    expect(await skipped(phoneOnly)).toEqual([['skipped', 'no_contact']])
  })
})

describe('the return link (cart/r/{token})', () => {
  let token = ''
  let cart = { id: '', token: '' }
  it('opens the cart in the browser that follows it, which takes the cart over', async () => {
    await flow(store)
    cart = await left('back@example.com', 45)
    await run()
    token = linkOf(mailTo('back@example.com')[0], 'cart/r')?.[2] ?? ''
    const r = await shop(`mutation { restoreCart(token: "${token}") { cartToken signInRequired cart { id lines { quantity } } } }`)
    const restored = r.data?.['restoreCart'] as { cartToken: string; signInRequired: boolean; cart: { id: string; lines: { quantity: number }[] } }
    expect([restored.signInRequired, restored.cart.id, restored.cart.lines]).toEqual([false, cart.id, [{ quantity: 1 }]])
    expect((await shop('{ cart { id } }', restored.cartToken)).data?.['cart']).toEqual({ id: cart.id })
    expect((await reminders(cart.id))[0]?.clicked_at).not.toBeNull()
    expect(attempts.keys).toEqual([`cart-link:${store}:203.0.113.5`])
  })

  it('answers one refusal for a token unknown, from another store’s host, or whose cart is gone', async () => {
    for (const [value, on] of [['f'.repeat(64), host], [token, otherHost], ['not a token', host]] as const) {
      expect((await shop(`mutation { restoreCart(token: "${value}") { cartToken } }`, null, on)).code).toBe('LINK_INVALID')
    }
    await db.sql`update "order" set cart_expires_at = now() - interval '1 minute' where id = ${cart.id}`
    expect((await shop(`mutation { restoreCart(token: "${token}") { cartToken } }`)).code).toBe('LINK_INVALID')
    await db.sql`update "order" set cart_expires_at = now() + interval '30 days' where id = ${cart.id}`
  })

  it('is limited per host and address', async () => {
    attempts.allow = false
    expect((await shop(`mutation { restoreCart(token: "${token}") { cartToken } }`)).code).toBe('RATE_LIMITED')
    expect((await shop(`mutation { unsubscribe(token: "${token}") }`)).code).toBe('RATE_LIMITED')
  })

  it('asks the shopper to sign in for an account’s cart, and hands it to nobody else', async () => {
    const [c] = await db.sql<{ id: string }[]>`insert into customer (store_id, email, status) values (${store}, 'member@example.com', 'active') returning id`
    await db.sql`update "order" set customer_id = ${c?.id ?? ''}, access_token_hash = null, email = 'member@example.com' where id = (
      select o.id from "order" o join cart_reminder r on r.order_id = o.id where o.email = 'back@example.com')`
    const r = await shop(`mutation { restoreCart(token: "${token}") { cartToken signInRequired cart { id } } }`)
    expect(r.data?.['restoreCart']).toEqual({ cartToken: null, signInRequired: true, cart: null })
  })
})

describe('a reminder’s code (DATA-MODEL §7.7)', () => {
  let cart = { id: '', token: '' }
  let code = ''
  it('comes with a step that gives one, bound to this cart, and is added to it on the way back', async () => {
    await flow(store, { steps: [{ position: 1, discount: 10 }] })
    cart = await left('coded@example.com', 45)
    await run()
    const mail = mailTo('coded@example.com')[0]
    code = /Use (BACK-[A-Z0-9]{6}) for 10% off/.exec(mail?.text ?? '')?.[1] ?? ''
    expect(code).not.toBe('')
    const back = await shop(`mutation { restoreCart(token: "${linkOf(mail, 'cart/r')?.[2] ?? ''}") { cartToken cart { discount { amount } codes { code state } } } }`)
    const restored = back.data?.['restoreCart'] as { cartToken: string; cart: { discount: { amount: string }; codes: unknown[] } }
    expect(restored.cart).toEqual({ discount: { amount: '10000' }, codes: [{ code, state: 'APPLIED' }] })
    cart = { ...cart, token: restored.cartToken }
  })

  it('works on no other cart, whoever types it', async () => {
    const other = await add(kurta, 1)
    const r = await shop(`mutation { applyCode(code: "${code}") { state } }`, other.token)
    expect(r.data?.['applyCode']).toEqual({ state: 'INVALID' })
  })

  it('never shows in the Offers list or counts against its limit', async () => {
    const r = await merchant('{ offers { nodes { name } } offerCounts { live } }', 'owner')
    expect(r.data).toEqual({ offers: { nodes: [] }, offerCounts: { live: 0 } })
  })

  it('recovers the cart when it is placed, crediting the reminder, and its reminders stop', async () => {
    await shop('mutation { setShippingAddress(address: { name: "Asha", line1: "12 MG Road", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN" }) { cart { id } } }', cart.token)
    await shop('mutation { setShippingOption(option: "flat") { cart { id } } }', cart.token)
    await shop('mutation { checkout { id } }', cart.token)
    const placed = await shop('mutation { placeOrder(provider: "cod") { orderId } }', cart.token)
    expect((placed.data?.['placeOrder'] as { orderId: string }).orderId).toBe(cart.id)
    const [row] = await db.sql<{ by: string; credited: boolean }[]>`
      select recovered_by_order_id as by, recovered_by_reminder_id = (select id from cart_reminder where order_id = ${cart.id}) as credited from "order" where id = ${cart.id}`
    expect(row).toEqual({ by: cart.id, credited: true })
    expect((await shop(`mutation { applyCode(code: "${code}") { state } }`, (await add(kurta, 1)).token)).data?.['applyCode']).toEqual({ state: 'INVALID' })
  })

  it('a purchase on another cart recovers the shopper’s other carts left this week, which then get no reminder', async () => {
    await flow(store, { steps: [{ position: 1, delay: 60 }] })
    const waiting = await left('buyer@example.com', 45)
    await sweep()
    const bought = await left('buyer@example.com', 0)
    await shop('mutation { setShippingAddress(address: { name: "B", line1: "1 Road", city: "Pune", country: "IN" }) { cart { id } } }', bought.token)
    await shop('mutation { setShippingOption(option: "flat") { cart { id } } }', bought.token)
    await shop('mutation { checkout { id } }', bought.token)
    await shop('mutation { placeOrder(provider: "cod") { orderId } }', bought.token)
    await db.sql`update "order" set abandoned_at = abandoned_at - interval '1 hour', updated_at = updated_at - interval '1 hour' where id = ${waiting.id}`
    await run()
    const [row] = await db.sql<{ by: string }[]>`select recovered_by_order_id as by from "order" where id = ${waiting.id}`
    expect([row?.by, await reminders(waiting.id)]).toEqual([bought.id, []])
  })
})

describe('unsubscribe/{token}', () => {
  it('stops the shopper’s marketing, a guest getting a customer row to remember it, recorded once however often it is pressed', async () => {
    await flow(store)
    const cart = await left('leave.me@example.com', 45)
    await run()
    const token = linkOf(mailTo('leave.me@example.com')[0], 'unsubscribe')?.[2] ?? ''
    expect((await shop(`mutation { unsubscribe(token: "${token}") }`, null, otherHost)).code).toBe('LINK_INVALID')
    expect((await shop(`mutation { unsubscribe(token: "${token}") }`)).data?.['unsubscribe']).toBe(true)
    expect((await shop(`mutation { unsubscribe(token: "${token}") }`)).data?.['unsubscribe']).toBe(true)
    const [c] = await db.sql<{ consent_state: string; consent_source: string; status: string }[]>`select consent_state, consent_source, status from customer where store_id = ${store} and email = 'leave.me@example.com'`
    expect(c).toEqual({ consent_state: 'stopped', consent_source: 'email', status: 'unverified' })
    const [entries] = await db.sql<{ n: number }[]>`select count(*)::int as n from activity_log where action = 'customer.consent_recorded' and store_id = ${store}`
    expect(entries?.n).toBe(1)
    await db.sql`update "order" set abandoned_at = abandoned_at - interval '1 day', updated_at = updated_at - interval '1 day' where id = ${cart.id}`
    await flow(store, { steps: [{ position: 1 }, { position: 2 }] })
    await run()
    expect((await reminders(cart.id)).map((r) => r.skip_reason)).toEqual(['opted_out'])
  })

  it('keeps an expired cart reminded in the last 30 days, so its unsubscribe link keeps working', async () => {
    await flow(store)
    const cart = await left('keep@example.com', 45)
    await run()
    await db.sql`update "order" set cart_expires_at = now() - interval '1 day' where id = ${cart.id}`
    await withSystemScope(db.sql, (tx) => deleteExpiredCarts(tx, new Date(), 500))
    const token = linkOf(mailTo('keep@example.com')[0], 'unsubscribe')?.[2] ?? ''
    expect((await shop(`mutation { unsubscribe(token: "${token}") }`)).data?.['unsubscribe']).toBe(true)
    await db.sql`update cart_reminder set sent_at = now() - interval '31 days' where order_id = ${cart.id}`
    expect((await shop(`mutation { unsubscribe(token: "${token}") }`)).code).toBe('LINK_INVALID')
    await withSystemScope(db.sql, (tx) => deleteExpiredCarts(tx, new Date(), 500))
    expect(await db.sql`select 1 from "order" where id = ${cart.id}`).toHaveLength(0)
  })
})

describe('isolation (ACCESS §11.1)', () => {
  const person = (storeId: string, sellerId: string | null = null) => ({
    caller: { kind: 'person' as const, userId: crypto.randomUUID(), sessionId: crypto.randomUUID() },
    partnerId: t.partnerA,
    storeId,
    sellerScope: sellerId ? { kind: 'seller' as const, sellerId } : { kind: 'all' as const },
    subscription: 'active' as const,
  })
  it('a store reads its own reminders and settings only, a supplier none, and nobody reads a link’s hash', async () => {
    const count = (storeId: string, sellerId: string | null = null) =>
      withScope(db.sql, person(storeId, sellerId), async (tx) => {
        const [r] = await tx<{ reminders: number; flows: number }[]>`select (select count(*)::int from cart_reminder) as reminders, (select count(*)::int from cart_reminder_flow) as flows`
        return r
      })
    const [all] = await db.sql<{ n: number }[]>`select count(*)::int as n from cart_reminder where store_id = ${store}`
    expect(await count(store)).toEqual({ reminders: all?.n, flows: 1 })
    expect((await count(surat))?.reminders).toBe(0)
    await expect(count(store, seller)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, person(store), (tx) => tx`select link_token_hash from cart_reminder`)).rejects.toThrow(/permission denied/)
  })

  it('a merchant can neither write a sent reminder nor another store’s settings', async () => {
    await expect(withScope(db.sql, person(store), (tx) => tx`update cart_reminder set state = 'sent'`)).rejects.toThrow(/permission denied/)
    const written = await withScope(db.sql, person(surat), (tx) => tx`update cart_reminder_flow set enabled = false where store_id = ${store}`)
    expect(written.count).toBe(0)
    await expect(withScope(db.sql, person(surat), (tx) => tx`insert into cart_reminder_flow (store_id, enabled) values (${t.storeB1}, true)`)).rejects.toThrow(/row-level security/)
  })
})
