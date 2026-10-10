import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #320 (SAPI 14), part 2: offers on the Store API (FIRST-RELEASE §8, §19; OFFERS-DESIGN B–N, U): Owner and Manager
// write, Staff read, a supplier and every other store reach nothing (ACCESS §5.1, §11), and the plan gates hold on the server.

let db: TestDatabase
let t: Tenants
type Who = 'owner' | 'manager' | 'staff' | 'supplier' | 'other'
const cookies = {} as Record<Who, string>
const plans = { full: '', small: '', none: '' }
let product = ''
let otherProduct = ''
let group = ''

const facts = { requestId: 'r', ip: null, userAgent: null }
const gql = async (source: string, who: Who, variables: Record<string, unknown> = {}, as: { support?: 'read' } = {}) => {
  const headers: Record<string, string> = {
    cookie: `${storeCookieName}=${cookies[who]}`,
    [storeHeader]: who === 'other' ? t.storeA2 : t.storeA1,
    ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}),
  }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing = as.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } } } }
    : resolved
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, extensions: result.errors?.[0]?.extensions }
}

const subscribe = async (storeId: string, planId: string) => {
  await db.sql`update store set plan_id = ${planId} where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${t.partnerA}, ${planId}, 1, 'active', 'month', 'INR', 0, now(), now() + interval '30 days')`
}

const save = `mutation S($id: ID, $revision: Int, $input: OfferInput!) { saveOffer(id: $id, revision: $revision, input: $input) { id revision } }`
const none = { product: false, order: false, shipping: false }
const offerInput = (o: Record<string, unknown> = {}) => ({
  name: 'Summer 20% off',
  trigger: 'code',
  code: 'summer20',
  enabled: true,
  combines: none,
  conditions: [],
  action: { operation: 'order_percentage_discount', percent: 20 },
  ...o,
})
const create = async (o: Record<string, unknown> = {}, who: Who = 'owner') => {
  const r = await gql(save, who, { input: offerInput(o) })
  return { id: (r.data?.['saveOffer'] as { id: string } | null)?.id ?? '', code: r.code, extensions: r.extensions }
}
const fields = 'id name trigger code status enabled usesCount combines { product order shipping } conditions { operation amounts { amount currency } minimum productIds groupIds } action { operation percent amounts { amount currency } targets { productIds } } revision'
const offer = async (id: string, who: Who = 'owner') => (await gql(`{ offer(id: "${id}") { ${fields} } }`, who)).data?.['offer'] as Record<string, unknown> | null

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set pricing_currency = 'INR' where id in (${t.storeA1}, ${t.storeA2})`
  await db.sql`insert into store_currency (store_id, currency, mode, rounding, status, position) values (${t.storeA1}, 'USD', 'convert', 'none', 'active', 1)`
  const plan = async (name: string, e: { offers: boolean; group: boolean; live: number }) => {
    const [row] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerA}, ${name}, 'live') returning id`
    const id = row?.id ?? ''
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) values (${id}, ${t.partnerA}, 1, 'offers', ${e.offers}), (${id}, ${t.partnerA}, 1, 'group_offers', ${e.group})`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${id}, ${t.partnerA}, 1, 'live_offers', ${e.live})`
    return id
  }
  plans.full = await plan('Business', { offers: true, group: true, live: 2147483647 })
  plans.small = await plan('Free', { offers: true, group: false, live: 1 })
  plans.none = await plan('Nothing', { offers: false, group: false, live: 0 })
  await subscribe(t.storeA1, plans.full)
  await subscribe(t.storeA2, plans.full)
  const person = async (email: string, role: string, seller: string | null = null, storeId = t.storeA1) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${seller}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person('owner@a1.example', 'owner')
  cookies.manager = await person('manager@a1.example', 'manager')
  cookies.staff = await person('staff@a1.example', 'staff')
  cookies.supplier = await person('anand@a1.example', 'supplier-admin', t.sellerA1First)
  cookies.other = await person('owner@a2.example', 'owner', null, t.storeA2)
  product = (await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${t.storeA1}, 'Linen shirt', 'linen-shirt', 'visible') returning id`)[0]?.id ?? ''
  otherProduct = (await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${t.storeA2}, 'Kurta', 'kurta', 'visible') returning id`)[0]?.id ?? ''
  group = (await db.sql<{ id: string }[]>`insert into customer_group (store_id, name) values (${t.storeA1}, 'VIP') returning id`)[0]?.id ?? ''
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('saving an offer', () => {
  let id = ''
  it('saves a code offer, its code upper-cased, live at once when on with no start (#337)', async () => {
    const made = await create()
    id = made.id
    expect(await offer(id)).toEqual({
      id, name: 'Summer 20% off', trigger: 'code', code: 'SUMMER20', status: 'live', enabled: true, usesCount: 0, combines: none, conditions: [],
      action: { operation: 'order_percentage_discount', percent: 20, amounts: [], targets: null }, revision: 1,
    })
    const [entry] = await db.sql<{ actor_id: string; target_id: string }[]>`select actor_id, target_id from activity_log where action = 'offer.created'`
    expect(entry?.target_id).toBe(id)
  })

  it('edits at the revision it read, and refuses one read before someone else’s save', async () => {
    const edited = await gql(save, 'manager', { id, revision: 1, input: offerInput({ name: 'Summer 25% off', action: { operation: 'order_percentage_discount', percent: 25 } }) })
    expect(edited.data?.['saveOffer']).toEqual({ id, revision: 2 })
    const stale = await gql(save, 'owner', { id, revision: 1, input: offerInput() })
    expect([stale.code, stale.extensions?.['revision']]).toEqual(['STALE_REVISION', 2])
  })

  it('takes per-currency amounts only in the currencies the store sells in (fact 10)', async () => {
    const fixed = await create({ code: 'TENOFF', action: { operation: 'order_fixed_discount', amounts: [{ currency: 'INR', amount: '50000' }, { currency: 'USD', amount: '600' }] } })
    expect((await offer(fixed.id))?.['action']).toMatchObject({ amounts: [{ currency: 'INR', amount: '50000' }, { currency: 'USD', amount: '600' }] })
    expect((await create({ code: 'EUROS', action: { operation: 'order_fixed_discount', amounts: [{ currency: 'EUR', amount: '500' }] } })).code).toBe('CURRENCY_NOT_SOLD')
    expect((await create({ code: 'TWICE', action: { operation: 'order_fixed_discount', amounts: [{ currency: 'INR', amount: '5' }, { currency: 'INR', amount: '6' }] } })).code).toBe('INVALID_INPUT')
  })

  it('names only the store’s own products and groups', async () => {
    const own = await create({ code: 'SHIRTS', action: { operation: 'products_percentage_discount', percent: 10, targets: { productIds: [product] } } })
    expect((await offer(own.id))?.['action']).toMatchObject({ targets: { productIds: [product] } })
    expect((await create({ code: 'KURTAS', action: { operation: 'products_percentage_discount', percent: 10, targets: { productIds: [otherProduct] } } })).code).toBe('UNKNOWN_TARGET')
    expect((await create({ code: 'NOPE', action: { operation: 'products_percentage_discount', percent: 10, targets: {} } })).code).toBe('INVALID_INPUT')
  })

  it('refuses a code another offer holds, whatever its case, deleted ones included, naming that offer (H2, #188)', async () => {
    const taken = await create({ name: 'Another', code: 'Summer20' })
    expect([taken.code, taken.extensions?.['offerId'], taken.extensions?.['status']]).toEqual(['CODE_TAKEN', id, 'live'])
    const gone = await create({ name: 'Old', code: 'OLDCODE', enabled: false })
    expect((await gql(`mutation { deleteOffer(id: "${gone.id}") }`, 'owner')).data?.['deleteOffer']).toBe(true)
    expect((await create({ code: 'oldcode' })).extensions?.['status']).toBe('deleted')
    // Another store is free to use it.
    expect((await create({ code: 'SUMMER20' }, 'other')).code).toBeUndefined()
  })

  it('gives a code to one of two offers saved with it at once, and tells the other who holds it', async () => {
    // Another save has taken the code's lock and written its offer and code, not yet committed.
    let release = () => {}
    let ready = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const held = new Promise<void>((resolve) => (ready = resolve))
    let first = ''
    const other = db.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`offer-code:${t.storeA1}:twins10`}))`
      first = (await tx<{ id: string }[]>`insert into promotion (store_id, name, trigger, enabled) values (${t.storeA1}, 'Twin one', 'code', false) returning id`)[0]?.id ?? ''
      await tx`insert into promotion_action (promotion_id, store_id, operation, args, position) values (${first}, ${t.storeA1}, 'free_shipping', '{}', 0)`
      await tx`insert into promotion_code (promotion_id, store_id, code) values (${first}, ${t.storeA1}, 'TWINS10')`
      ready()
      await gate
    })
    await held
    const second = create({ name: 'Twin two', code: 'twins10', enabled: false })
    await new Promise((resolve) => setTimeout(resolve, 300))
    release()
    await other
    const refused = await second
    expect([refused.code, refused.extensions?.['offerId']]).toEqual(['CODE_TAKEN', first])
  })

  it('keeps a replaced code reserved to its offer, and lets the offer take it back (H5)', async () => {
    const o = await offer(id)
    await gql(save, 'owner', { id, revision: o?.['revision'], input: offerInput({ code: 'SUMMER25' }) })
    expect((await offer(id))?.['code']).toBe('SUMMER25')
    expect((await create({ name: 'Thief', code: 'SUMMER20' })).extensions?.['offerId']).toBe(id)
    const again = await offer(id)
    await gql(save, 'owner', { id, revision: again?.['revision'], input: offerInput({ code: 'SUMMER20' }) })
    expect((await offer(id))?.['code']).toBe('SUMMER20')
  })

  it('refuses a malformed code, a code on an automatic offer, and an instant without its offset', async () => {
    expect((await create({ code: 'NO SPACES' })).code).toBe('INVALID_INPUT')
    expect((await create({ trigger: 'automatic', code: 'AUTO' })).code).toBe('INVALID_INPUT')
    expect((await create({ code: 'LATER', startsAt: '2027-01-01T09:00' })).code).toBe('INVALID_INPUT')
    const scheduled = await create({ code: 'LATER', startsAt: '2027-01-01T09:00:00+05:30' })
    expect((await offer(scheduled.id))?.['status']).toBe('scheduled')
  })
})

describe('who may do what (ACCESS §5.1, §11)', () => {
  it('lets Staff read offers and change none (#184)', async () => {
    expect(((await gql('{ offers { nodes { name } } }', 'staff')).data?.['offers'] as { nodes: unknown[] }).nodes.length).toBeGreaterThan(0)
    expect((await create({ code: 'STAFF' }, 'staff')).code).toBe('FORBIDDEN')
    const [first] = ((await gql('{ offers { nodes { id } } }', 'staff')).data?.['offers'] as { nodes: { id: string }[] }).nodes
    expect((await gql(`mutation { pauseOffer(id: "${first?.id ?? ''}") }`, 'staff')).code).toBe('FORBIDDEN')
  })

  it('gives a supplier no offer at all, not even a count (OFFERS fact 15)', async () => {
    expect((await gql('{ offers { nodes { id } } }', 'supplier')).code).toBe('FORBIDDEN')
    expect((await gql('{ offerCounts { live } }', 'supplier')).code).toBe('FORBIDDEN')
    expect((await create({ code: 'VENDOR' }, 'supplier')).code).toBe('FORBIDDEN')
  })

  it('keeps each store to its own offers: lists, counts and ids', async () => {
    const mine = (await gql('{ offers { nodes { id } } }', 'owner')).data?.['offers'] as { nodes: { id: string }[] }
    const theirs = (await gql('{ offers { nodes { id } } }', 'other')).data?.['offers'] as { nodes: { id: string }[] }
    expect(theirs.nodes).toHaveLength(1)
    expect(mine.nodes.map((n) => n.id)).not.toContain(theirs.nodes[0]?.id)
    expect(await offer(theirs.nodes[0]?.id ?? '', 'owner')).toBeNull()
    expect((await gql('{ offerCounts { live scheduled off ended } }', 'other')).data?.['offerCounts']).toEqual({ live: 1, scheduled: 0, off: 0, ended: 0 })
    expect((await gql(`mutation { deleteOffer(id: "${theirs.nodes[0]?.id ?? ''}") }`, 'owner')).code).toBe('NOT_FOUND')
    expect((await gql(`mutation { pauseOffer(id: "${theirs.nodes[0]?.id ?? ''}") }`, 'owner')).code).toBe('NOT_FOUND')
  })

  it('lets no write reach another store’s offer, whatever its id and revision', async () => {
    const theirs = await create({ name: 'Surat only', code: 'SURATONLY', enabled: false }, 'other')
    const before = await offer(theirs.id, 'other')
    expect((await gql(save, 'owner', { id: theirs.id, revision: before?.['revision'], input: offerInput({ name: 'Taken over', code: 'SURATONLY', enabled: false }) })).code).toBe('NOT_FOUND')
    for (const m of ['resumeOffer', 'endOffer', 'duplicateOffer']) expect({ m, code: (await gql(`mutation { ${m}(id: "${theirs.id}") }`, 'owner')).code }).toEqual({ m, code: 'NOT_FOUND' })
    expect(await offer(theirs.id, 'other')).toEqual(before)
    expect(await db.sql`select count(*)::int as n from promotion where name like 'Copy of Surat%'`).toEqual([{ n: 0 }])
  })

  it('finds and counts nothing of another store’s offers by name or code', async () => {
    const counts = (await gql('{ offerCounts { live scheduled off ended } }', 'owner')).data?.['offerCounts']
    for (const search of ['Surat', 'SURATONLY']) expect(((await gql(`{ offers(search: "${search}") { nodes { id } } }`, 'owner')).data?.['offers'] as { nodes: unknown[] }).nodes).toEqual([])
    await create({ name: 'Surat two', code: 'SURATTWO', enabled: false }, 'other')
    expect((await gql('{ offerCounts { live scheduled off ended } }', 'owner')).data?.['offerCounts']).toEqual(counts)
  })

  it('names nothing of another store: its groups, customers, collections and filter values are unknown here', async () => {
    const [g] = await db.sql<{ id: string }[]>`insert into customer_group (store_id, name) values (${t.storeA2}, 'Their VIP') returning id`
    const [c] = await db.sql<{ id: string }[]>`insert into collection (store_id, name, slug, kind) values (${t.storeA2}, 'Their summer', 'their-summer', 'manual') returning id`
    const [f] = await db.sql<{ id: string }[]>`insert into filter (store_id, name, position) values (${t.storeA2}, 'Fabric', 0) returning id`
    const [v] = await db.sql<{ id: string }[]>`insert into filter_value (filter_id, store_id, name, position) values (${f?.id ?? ''}, ${t.storeA2}, 'Linen', 0) returning id`
    const tries = [
      { conditions: [{ operation: 'customer_group', groupIds: [g?.id] }] },
      { conditions: [{ operation: 'specific_customers', customerIds: [t.customerA2] }] },
      { action: { operation: 'products_percentage_discount', percent: 10, targets: { collectionIds: [c?.id] } } },
      { action: { operation: 'products_percentage_discount', percent: 10, targets: { filterValueIds: [v?.id] } } },
    ]
    for (const [i, o] of tries.entries()) expect({ i, code: (await create({ code: `THEIRS${i}`, ...o })).code }).toEqual({ i, code: 'UNKNOWN_TARGET' })
  })

  it('lets a read-only support session read and change nothing (ACCESS §8)', async () => {
    expect((await gql('{ offerCounts { live } }', 'owner', {}, { support: 'read' })).code).toBeUndefined()
    expect((await gql(save, 'owner', { input: offerInput({ code: 'SUPPORT' }) }, { support: 'read' })).code).toBe('READ_ONLY')
  })

  it('makes a past-due store read-only for the merchant side', async () => {
    await db.sql`update store set status = 'past_due' where id = ${t.storeA1}`
    try {
      expect((await create({ code: 'PASTDUE' })).code).toBe('READ_ONLY')
      expect((await gql('{ offerCounts { live } }', 'owner')).code).toBeUndefined()
    } finally {
      await db.sql`update store set status = 'active' where id = ${t.storeA1}`
    }
  })
})

describe('the list (B1–B4)', () => {
  it('tabs by status, Used up under Ended, each with its count', async () => {
    const off = await create({ code: 'PAUSED', enabled: false })
    const used = await create({ code: 'USEDUP', totalUsesLimit: 1 })
    await db.sql`update promotion set uses_count = 1 where id = ${used.id}`
    const ended = await create({ code: 'GONE', startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-02-01T00:00:00Z' })
    const tab = async (status: string) => ((await gql(`{ offers(status: "${status}") { nodes { id status } } }`, 'owner')).data?.['offers'] as { nodes: { id: string; status: string }[] }).nodes
    expect((await tab('off')).map((n) => n.id)).toContain(off.id)
    expect((await tab('ended')).map((n) => [n.id, n.status])).toEqual(expect.arrayContaining([[used.id, 'used_up'], [ended.id, 'ended']]))
    expect((await tab('live')).map((n) => n.id)).not.toContain(used.id)
    const counts = (await gql('{ offerCounts { live scheduled off ended } }', 'owner')).data?.['offerCounts'] as Record<string, number>
    expect(counts['ended']).toBe((await tab('ended')).length)
    expect(counts['live']).toBe((await tab('live')).length)
    expect((await gql('{ offers(status: "used_up") { nodes { id } } }', 'owner')).code).toBe('INVALID_INPUT')
  })

  it('finds an offer by name or by a shared code, filtered by type and trigger', async () => {
    const auto = await create({ name: 'Free delivery over ₹999', trigger: 'automatic', code: null, action: { operation: 'free_shipping' }, conditions: [{ operation: 'minimum_order_amount', amounts: [{ currency: 'INR', amount: '99900' }] }] })
    const ids = async (args: string) => ((await gql(`{ offers${args} { nodes { id } } }`, 'owner')).data?.['offers'] as { nodes: { id: string }[] }).nodes.map((n) => n.id)
    expect(await ids('(search: "delivery")')).toEqual([auto.id])
    expect(await ids('(search: "tenoff")')).toHaveLength(1)
    expect(await ids('(kind: "shipping")')).toEqual([auto.id])
    expect(await ids('(trigger: "automatic")')).toEqual([auto.id])
    expect(await ids('(search: "zz%")')).toEqual([])
  })
})

describe('paging the list (FIRST-RELEASE §19)', () => {
  it('pages by cursor both ways without overlap or gaps, with any filter, at most 50 a page', async () => {
    await db.sql`insert into promotion (store_id, name, trigger, enabled, created_at) select ${t.storeA2}, 'Filler ' || g, 'automatic', false, now() - g * interval '1 minute' from generate_series(1, 55) g`
    await db.sql`insert into promotion_action (promotion_id, store_id, operation, args, position) select id, store_id, 'free_shipping', '{}', 0 from promotion where store_id = ${t.storeA2} and name like 'Filler %'`
    type Page = { nodes: { id: string }[]; pageInfo: { startCursor: string; endCursor: string; hasNextPage: boolean; hasPreviousPage: boolean } }
    const page = async (args: string) => (await gql(`{ offers${args} { nodes { id } pageInfo { startCursor endCursor hasNextPage hasPreviousPage } } }`, 'other')).data?.['offers'] as Page
    const all = await page('(status: "off", first: 1000)')
    expect(all.nodes).toHaveLength(50)
    expect(all.pageInfo.hasNextPage).toBe(true)
    const first = await page('(status: "off", first: 2)')
    const second = await page(`(status: "off", first: 2, after: "${first.pageInfo.endCursor}")`)
    expect([first.pageInfo.hasPreviousPage, first.pageInfo.hasNextPage, second.pageInfo.hasPreviousPage]).toEqual([false, true, true])
    expect([...first.nodes, ...second.nodes].map((n) => n.id)).toEqual(all.nodes.slice(0, 4).map((n) => n.id))
    const back = await page(`(status: "off", first: 2, before: "${second.pageInfo.startCursor}")`)
    expect(back.nodes.map((n) => n.id)).toEqual(first.nodes.map((n) => n.id))
    expect(back.pageInfo.hasPreviousPage).toBe(false)
    expect((await gql('{ offers(first: 2, after: "not-a-cursor") { nodes { id } } }', 'other')).code).toBe('INVALID_CURSOR')
    await db.sql`update promotion set deleted_at = now() where store_id = ${t.storeA2} and name like 'Filler %'`
  })
})

describe('turning off, ending, duplicating and deleting (N2–N5)', () => {
  it('pauses and resumes, ends now, copies as Off with no code, and deletes softly', async () => {
    const o = await create({ code: 'FLASH50', action: { operation: 'products_percentage_discount', percent: 50, targets: { productIds: [product] } } })
    expect((await gql(`mutation { pauseOffer(id: "${o.id}") }`, 'manager')).data?.['pauseOffer']).toBe(true)
    expect((await offer(o.id))?.['status']).toBe('off')
    expect((await gql(`mutation { resumeOffer(id: "${o.id}") }`, 'manager')).data?.['resumeOffer']).toBe(true)
    expect((await offer(o.id))?.['status']).toBe('live')
    const copy = (await gql(`mutation { duplicateOffer(id: "${o.id}") }`, 'owner')).data?.['duplicateOffer'] as string
    expect(await offer(copy)).toMatchObject({ name: 'Copy of Summer 20% off', status: 'off', code: null, usesCount: 0, action: { operation: 'products_percentage_discount', percent: 50 } })
    expect((await gql(`mutation { endOffer(id: "${o.id}") }`, 'owner')).data?.['endOffer']).toBe(true)
    expect((await offer(o.id))?.['status']).toBe('ended')
    expect((await gql(`mutation { deleteOffer(id: "${o.id}") }`, 'owner')).data?.['deleteOffer']).toBe(true)
    expect(await offer(o.id)).toBeNull()
    expect(await db.sql`select deleted_at is not null as gone from promotion where id = ${o.id}`).toEqual([{ gone: true }])
    const actions = await db.sql<{ action: string }[]>`select action from activity_log where target_id = ${o.id} order by occurred_at`
    expect(actions.map((a) => a.action)).toEqual(['offer.created', 'offer.paused', 'offer.resumed', 'offer.ended', 'offer.deleted'])
  })

  it('ends a scheduled offer too, without breaking its dates', async () => {
    const later = await create({ code: 'XMAS', startsAt: '2027-12-01T00:00:00Z' })
    expect((await gql(`mutation { endOffer(id: "${later.id}") }`, 'owner')).data?.['endOffer']).toBe(true)
    expect((await offer(later.id))?.['status']).toBe('ended')
  })
})

describe('plan gates (OFFERS U1–U3)', () => {
  it('needs the offers switch to create one, and the group switch for customer groups and tiers', async () => {
    await subscribe(t.storeA1, plans.none)
    try {
      const refused = await create({ code: 'NOPLAN' })
      expect([refused.code, refused.extensions?.['key']]).toEqual(['PLAN_LIMIT', 'offers'])
      expect(refused.extensions?.['unlockedBy']).toMatchObject({ name: 'Business' })
    } finally {
      await subscribe(t.storeA1, plans.full)
    }
    await subscribe(t.storeA1, plans.small)
    try {
      const vip = await create({ code: 'VIP15', enabled: false, conditions: [{ operation: 'customer_group', groupIds: [group] }] })
      expect([vip.code, vip.extensions?.['key']]).toEqual(['PLAN_LIMIT', 'group_offers'])
      const tiers = await create({ code: 'TIERS', enabled: false, action: { operation: 'tiered_discount', kind: 'percent', tiers: [{ minimum: [{ currency: 'INR', amount: '100000' }], percent: 10 }, { minimum: [{ currency: 'INR', amount: '200000' }], percent: 15 }] } })
      expect(tiers.extensions?.['key']).toBe('group_offers')
    } finally {
      await subscribe(t.storeA1, plans.full)
    }
    expect((await create({ code: 'VIP15', conditions: [{ operation: 'customer_group', groupIds: [group] }] })).code).toBeUndefined()
  })

  it('holds turning an Off offer on to the same switches, by saveOffer or resumeOffer', async () => {
    const plain = await create({ code: 'OFFPLAIN', enabled: false })
    const vip = await create({ code: 'OFFVIP', enabled: false, conditions: [{ operation: 'customer_group', groupIds: [group] }] })
    const live = await create({ code: 'LIVEVIP', conditions: [{ operation: 'customer_group', groupIds: [group] }] })
    const ended = await create({ code: 'ENDEDVIP', startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-02-01T00:00:00Z', conditions: [{ operation: 'customer_group', groupIds: [group] }] })
    const endedPlain = await create({ code: 'ENDEDPLAIN', startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-02-01T00:00:00Z' })
    const on = async (id: string, by: 'save' | 'resume') => {
      if (by === 'resume') return gql(`mutation { resumeOffer(id: "${id}") }`, 'owner')
      const o = await offer(id)
      const conditions = id === plain.id ? [] : [{ operation: 'customer_group', groupIds: [group] }]
      return gql(save, 'owner', { id, revision: o?.['revision'], input: offerInput({ code: o?.['code'], enabled: true, conditions }) })
    }
    await subscribe(t.storeA1, plans.none)
    try {
      for (const by of ['save', 'resume'] as const) expect({ by, key: (await on(plain.id, by)).extensions?.['key'] }).toEqual({ by, key: 'offers' })
      const p = await offer(endedPlain.id)
      const extended = await gql(save, 'owner', { id: endedPlain.id, revision: p?.['revision'], input: offerInput({ code: 'ENDEDPLAIN', startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z' }) })
      expect(extended.extensions?.['key']).toBe('offers')
    } finally {
      await subscribe(t.storeA1, plans.full)
    }
    await subscribe(t.storeA1, plans.small)
    try {
      await db.sql`update promotion set enabled = false where store_id = ${t.storeA1} and id <> ${live.id}`
      for (const by of ['save', 'resume'] as const) expect({ by, key: (await on(vip.id, by)).extensions?.['key'] }).toEqual({ by, key: 'group_offers' })
      // An ended one brought back by a later end date is turned on too.
      const e = await offer(ended.id)
      const revived = await gql(save, 'owner', { id: ended.id, revision: e?.['revision'], input: offerInput({ code: 'ENDEDVIP', startsAt: '2026-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', conditions: [{ operation: 'customer_group', groupIds: [group] }] }) })
      expect([revived.code, revived.extensions?.['key']]).toEqual(['PLAN_LIMIT', 'group_offers'])
      // A group offer already live keeps running and can still be edited after the downgrade.
      const o = await offer(live.id)
      expect((await gql(save, 'owner', { id: live.id, revision: o?.['revision'], input: offerInput({ name: 'VIP, renamed', code: 'LIVEVIP', conditions: [{ operation: 'customer_group', groupIds: [group] }] }) })).code).toBeUndefined()
    } finally {
      await subscribe(t.storeA1, plans.full)
    }
  })

  it('counts live and scheduled offers against the limit; a downgrade keeps them running and blocks more (#337)', async () => {
    await subscribe(t.storeA2, plans.small)
    try {
      // Store A2 already has one live offer: over a limit of 1 it keeps running, and nothing more goes live.
      const second = await create({ code: 'SECOND' }, 'other')
      expect([second.code, second.extensions?.['key'], second.extensions?.['limit']]).toEqual(['PLAN_LIMIT', 'live_offers', 1])
      const kept = await create({ code: 'SECOND', enabled: false }, 'other')
      expect(kept.code).toBeUndefined()
      expect((await gql(`mutation { resumeOffer(id: "${kept.id}") }`, 'other')).code).toBe('PLAN_LIMIT')
      expect((await gql('{ offerCounts { live } }', 'other')).data?.['offerCounts']).toEqual({ live: 1 })
      const [first] = ((await gql('{ offers(status: "live") { nodes { id } } }', 'other')).data?.['offers'] as { nodes: { id: string }[] }).nodes
      expect((await gql(`mutation { pauseOffer(id: "${first?.id ?? ''}") }`, 'other')).data?.['pauseOffer']).toBe(true)
      expect((await gql(`mutation { resumeOffer(id: "${kept.id}") }`, 'other')).data?.['resumeOffer']).toBe(true)
    } finally {
      await subscribe(t.storeA2, plans.full)
    }
  })

  it('holds the last live place while another save is still uncommitted, so only one takes it', async () => {
    await db.sql`update promotion set enabled = false where store_id = ${t.storeA2}`
    await subscribe(t.storeA2, plans.small)
    try {
      // Another save that has taken the store's lock and written its live offer, not yet committed.
      let release = () => {}
      let ready = () => {}
      const gate = new Promise<void>((resolve) => (release = resolve))
      const held = new Promise<void>((resolve) => (ready = resolve))
      const other = db.sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${`offers:live:${t.storeA2}`}))`
        await tx`insert into promotion (store_id, name, trigger, enabled) values (${t.storeA2}, 'First', 'automatic', true)`
        ready()
        await gate
      })
      await held
      const saving = create({ code: 'RACEB' }, 'other')
      await new Promise((resolve) => setTimeout(resolve, 300))
      release()
      await other
      expect((await saving).code).toBe('PLAN_LIMIT')
      expect((await gql('{ offerCounts { live } }', 'other')).data?.['offerCounts']).toEqual({ live: 1 })
    } finally {
      await subscribe(t.storeA2, plans.full)
    }
  })

})
