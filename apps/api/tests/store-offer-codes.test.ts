import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withScope, withSystemScope } from '#db/scoped/index'
import { insertSingleUseCodes } from '#db/scoped/promotions'
import { catalogExportDeliverer } from '#jobs/queues/deliverers/catalogExport'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #320 (SAPI 14), part 3: single-use codes, their export (`offers.export`, Owner and Manager), "Check a code a customer
// gives you" (rate-limited per person and store, one answer for a wrong and a missing code) and an offer's results.

let db: TestDatabase
let t: Tenants
type Who = 'owner' | 'manager' | 'staff' | 'supplier' | 'other'
const cookies = {} as Record<Who, string>
const plans = { full: '', small: '' }
const people = {} as Record<Who, string>
let limiter: { allow: boolean; keys: string[] } = { allow: true, keys: [] }

const facts = { requestId: 'r', ip: null, userAgent: null }
const gql = async (source: string, who: Who, o: { support?: 'read'; noLimiter?: boolean } = {}) => {
  const headers: Record<string, string> = {
    cookie: `${storeCookieName}=${cookies[who]}`,
    [storeHeader]: who === 'other' ? t.storeA2 : t.storeA1,
    ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}),
  }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing = o.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: o.support } } } }
    : resolved
  const allowCodeCheck = async (key: string) => {
    limiter.keys.push(key)
    return limiter.allow
  }
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => new Date(), ...(o.noLimiter ? {} : { allowCodeCheck }) }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, extensions: result.errors?.[0]?.extensions }
}

const subscribe = async (storeId: string, planId: string) => {
  await db.sql`update store set plan_id = ${planId} where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${t.partnerA}, ${planId}, 1, 'active', 'month', 'INR', 0, now(), now() + interval '30 days')`
}
const offer = async (storeId: string, o: { code?: string; trigger?: string; enabled?: boolean; endsAt?: Date; limit?: number; uses?: number } = {}) => {
  const [p] = await db.sql<{ id: string }[]>`
    insert into promotion (store_id, name, trigger, enabled, ends_at, total_uses_limit, uses_count, created_at)
    values (${storeId}, 'Insta giveaway', ${o.trigger ?? 'code'}, ${o.enabled ?? true}, ${o.endsAt ?? null}, ${o.limit ?? null}, ${o.uses ?? 0}, now()) returning id`
  const id = p?.id ?? ''
  await db.sql`insert into promotion_action (promotion_id, store_id, operation, args, position) values (${id}, ${storeId}, 'order_percentage_discount', '{"percent": 10}', 0)`
  if (o.code) await db.sql`insert into promotion_code (promotion_id, store_id, code) values (${id}, ${storeId}, ${o.code})`
  return id
}
const generate = (id: string, args: string, who: Who = 'owner') => gql(`mutation { generateCodes(offerId: "${id}"${args}) { id prefix length count used } }`, who)

let insta = ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set pricing_currency = 'INR', time_zone = 'Asia/Kolkata' where id in (${t.storeA1}, ${t.storeA2})`
  const plan = async (name: string, group: boolean, results: boolean) => {
    const [row] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerA}, ${name}, 'live') returning id`
    const id = row?.id ?? ''
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) values (${id}, ${t.partnerA}, 1, 'offers', true), (${id}, ${t.partnerA}, 1, 'group_offers', ${group}), (${id}, ${t.partnerA}, 1, 'offer_results', ${results})`
    return id
  }
  plans.full = await plan('Business', true, true)
  plans.small = await plan('Free', false, false)
  await subscribe(t.storeA1, plans.full)
  await subscribe(t.storeA2, plans.full)
  const person = async (who: Who, email: string, role: string, seller: string | null = null, storeId = t.storeA1) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    people[who] = u?.id ?? ''
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${seller}, ${role}, 'active')`
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  await person('owner', 'owner@a1.example', 'owner')
  await person('manager', 'manager@a1.example', 'manager')
  await person('staff', 'staff@a1.example', 'staff')
  await person('supplier', 'anand@a1.example', 'supplier-admin', t.sellerA1First)
  await person('other', 'owner@a2.example', 'owner', null, t.storeA2)
  insta = await offer(t.storeA1)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('single-use codes (H4)', () => {
  let batch = ''
  it('makes a run of readable codes under the prefix, upper-cased and unique in the store', async () => {
    const made = await generate(insta, ', count: 50, prefix: "ig-", length: 8')
    batch = (made.data?.['generateCodes'] as { id: string }).id
    expect(made.data?.['generateCodes']).toEqual({ id: batch, prefix: 'IG-', length: 8, count: 50, used: 0 })
    const codes = await db.sql<{ code: string; single_use: boolean }[]>`select code, single_use from promotion_code where batch_id = ${batch}`
    expect(codes).toHaveLength(50)
    expect(codes.every((c) => /^IG-[A-HJ-NP-Z2-9]{8}$/.test(c.code) && c.single_use)).toBe(true)
    expect((await gql(`{ offerCodeBatches(offerId: "${insta}") { nodes { id count used } } }`, 'staff')).data?.['offerCodeBatches']).toEqual({ nodes: [{ id: batch, count: 50, used: 0 }] })
    const [entry] = await db.sql<{ changes: unknown }[]>`select changes from activity_log where action = 'offer.codes_generated'`
    expect(entry?.changes).toEqual([expect.objectContaining({ field: 'codes', after: '50' })])
  })

  it('skips a code the store already holds, so none is ever two offers’', async () => {
    const [one] = await db.sql<{ code: string }[]>`select code from promotion_code where batch_id = ${batch} limit 1`
    const n = await withScope(db.sql, { caller: { kind: 'person', userId: people.owner, sessionId: 's' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' }, (tx) =>
      insertSingleUseCodes(tx, t.storeA1, insta, batch, [one?.code ?? '', 'IG-FRESHONE']))
    expect(n).toBe(1)
  })

  it('refuses an automatic offer, a run too big, a bad prefix, Staff, a supplier, another store and a plan without single-use codes', async () => {
    expect((await generate(await offer(t.storeA1, { trigger: 'automatic' }), ', count: 5')).code).toBe('NOT_A_CODE_OFFER')
    expect((await generate(insta, ', count: 5001')).code).toBe('INVALID_INPUT')
    expect((await generate(insta, ', count: 5, prefix: "-IG"')).code).toBe('INVALID_INPUT')
    expect((await generate(insta, ', count: 5, prefix: "ABCDEFGHIJKL", length: 16')).code).toBeUndefined()
    expect((await generate(insta, ', count: 5, prefix: "ABCDEFGHIJKLM"')).code).toBe('INVALID_INPUT')
    expect((await generate(insta, ', count: 5', 'staff')).code).toBe('FORBIDDEN')
    expect((await generate(insta, ', count: 5', 'supplier')).code).toBe('FORBIDDEN')
    expect((await generate(insta, ', count: 5', 'other')).code).toBe('NOT_FOUND')
    await subscribe(t.storeA1, plans.small)
    try {
      const refused = await generate(insta, ', count: 5')
      expect([refused.code, refused.extensions?.['key']]).toEqual(['PLAN_LIMIT', 'group_offers'])
    } finally {
      await subscribe(t.storeA1, plans.full)
    }
  })

  it('lists runs a page at a time, newest first, and none of another store’s or to a supplier', async () => {
    const paged = await offer(t.storeA1)
    const ids: string[] = []
    for (let i = 0; i < 3; i += 1) ids.push(((await generate(paged, ', count: 1')).data?.['generateCodes'] as { id: string }).id)
    type Page = { nodes: { id: string }[]; pageInfo: { endCursor: string; hasNextPage: boolean } }
    const page = async (args: string, who: Who = 'owner') => (await gql(`{ offerCodeBatches(offerId: "${paged}"${args}) { nodes { id } pageInfo { endCursor hasNextPage } } }`, who))
    const first = page(', first: 2')
    const one = (await first).data?.['offerCodeBatches'] as Page
    expect([one.nodes.map((n) => n.id), one.pageInfo.hasNextPage]).toEqual([[ids[2], ids[1]], true])
    const two = (await page(`, first: 2, after: "${one.pageInfo.endCursor}"`)).data?.['offerCodeBatches'] as Page
    expect([two.nodes.map((n) => n.id), two.pageInfo.hasNextPage]).toEqual([[ids[0]], false])
    expect(((await page('', 'other')).data?.['offerCodeBatches'] as Page).nodes).toEqual([])
    expect((await page('', 'supplier')).code).toBe('FORBIDDEN')
  })

  it('holds an offer to 100,000 codes, and says so', async () => {
    const full = await offer(t.storeA1)
    const [b] = await db.sql<{ id: string }[]>`insert into promotion_code_batch (promotion_id, store_id, prefix, length, count) values (${full}, ${t.storeA1}, 'FULL', 6, 5000) returning id`
    await db.sql`insert into promotion_code (promotion_id, store_id, batch_id, code, single_use) select ${full}, ${t.storeA1}, ${b?.id ?? ''}, 'FULL' || lpad(g::text, 6, '0'), true from generate_series(1, 99998) g`
    expect((await generate(full, ', count: 3')).code).toBe('TOO_MANY')
    expect((await generate(full, ', count: 2')).code).toBeUndefined()
  }, 60_000)

  it('exports a run as a file for the Owner and Manager, read back only by whoever asked (decided 2026-10-05)', async () => {
    await db.sql`update promotion_code set used_at = '2026-10-09T10:00:00Z' where code = 'IG-FRESHONE'`
    const fresh = (await db.sql<{ id: string }[]>`select batch_id as id from promotion_code where code = 'IG-FRESHONE'`)[0]?.id ?? ''
    const asked = await gql(`mutation { exportOfferCodes(batchId: "${fresh}") }`, 'manager')
    const job = asked.data?.['exportOfferCodes'] as string
    expect(typeof job).toBe('string')
    await relayDue(db.sql, { 'export.catalog': catalogExportDeliverer(db.sql) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
    const file = (await gql(`{ offerCodesExport(id: "${job}") { state rows csv } }`, 'manager')).data?.['offerCodesExport'] as { state: string; rows: number; csv: string }
    expect([file.state, file.rows]).toEqual(['done', 51])
    expect(file.csv.split('\n')[0]).toBe('code,state,used at (UTC)')
    expect(file.csv).toContain('IG-FRESHONE,used,2026-10-09T10:00:00.000Z')
    expect((await gql(`{ offerCodesExport(id: "${job}") { state } }`, 'owner')).data?.['offerCodesExport']).toBeNull()
    expect((await gql(`{ offerCodesExport(id: "${job}") { state } }`, 'staff')).code).toBe('FORBIDDEN')
    expect((await gql(`mutation { exportOfferCodes(batchId: "${fresh}") }`, 'staff')).code).toBe('FORBIDDEN')
    expect((await gql(`mutation { exportOfferCodes(batchId: "${fresh}") }`, 'supplier')).code).toBe('FORBIDDEN')
    expect((await gql(`mutation { exportOfferCodes(batchId: "${fresh}") }`, 'other')).code).toBe('NOT_FOUND')
    expect((await gql(`mutation { exportOfferCodes(batchId: "${fresh}") }`, 'owner', { support: 'read' })).code).toBe('FORBIDDEN')
    expect(await db.sql`select 1 from activity_log where action = 'offer.codes_exported' and target_id = ${insta}`).toHaveLength(1)
  })
})

describe('checking a code a customer gives you', () => {
  const check = async (code: string, who: Who = 'staff', o: { noLimiter?: boolean } = {}) => gql(`{ checkCode(code: "${code}") { code deleted singleUse usedAt answer offer { id name status } } }`, who, o)
  const answer = async (code: string) => ((await check(code)).data?.['checkCode'] as { answer: string } | null)?.answer ?? null

  it('finds the offer behind a code whatever its case, and says what a shopper meets (O3)', async () => {
    const id = await offer(t.storeA1, { code: 'WELCOME10' })
    expect((await check('welcome10')).data?.['checkCode']).toEqual({ code: 'WELCOME10', deleted: false, singleUse: false, usedAt: null, answer: 'WORKS', offer: { id, name: 'Insta giveaway', status: 'live' } })
    await offer(t.storeA1, { code: 'PAUSED10', enabled: false })
    await offer(t.storeA1, { code: 'OVER10', endsAt: new Date('2026-01-01') })
    await offer(t.storeA1, { code: 'GONE10', limit: 5, uses: 5 })
    const deleted = await offer(t.storeA1, { code: 'DELETED10' })
    await db.sql`update promotion set deleted_at = now() where id = ${deleted}`
    expect([await answer('PAUSED10'), await answer('OVER10'), await answer('GONE10'), await answer('DELETED10')]).toEqual(['INVALID', 'EXPIRED', 'USED_UP', 'INVALID'])
    expect((await check('DELETED10')).data?.['checkCode']).toMatchObject({ deleted: true, offer: null })
    expect(await answer('IG-FRESHONE')).toBe('USED_UP')
  })

  it('gives one answer, null, for a malformed code, a missing one and another store’s', async () => {
    await offer(t.storeA2, { code: 'THEIRS10' })
    for (const code of ['no such', 'NOSUCH10', 'THEIRS10']) expect((await check(code)).data?.['checkCode']).toBeNull()
  })

  it('is rate-limited per person and store, and refuses every check where no limiter is bound', async () => {
    limiter = { allow: true, keys: [] }
    await check('WELCOME10', 'owner')
    expect(limiter.keys).toEqual([`offer-code:${t.storeA1}:${people.owner}`])
    limiter = { allow: false, keys: [] }
    expect((await check('WELCOME10')).code).toBe('RATE_LIMITED')
    limiter = { allow: true, keys: [] }
    expect((await check('WELCOME10', 'staff', { noLimiter: true })).code).toBe('RATE_LIMITED')
  })

  it('is the merchant side’s: a supplier is refused before anything is read', async () => {
    limiter = { allow: true, keys: [] }
    expect((await check('WELCOME10', 'supplier')).code).toBe('FORBIDDEN')
    expect(limiter.keys).toEqual([])
  })
})

describe('an offer’s results (P1)', () => {
  it('counts its uses, the discount given, sales with it and the average order, by currency and by day', async () => {
    const order = async (storeId: string, number: string, total: number, currency = 'INR') =>
      (await db.sql<{ id: string }[]>`
        insert into "order" (store_id, state, payment_state, currency, number, placed_at, subtotal_amount, shipping_amount, total_amount, payment_method, email)
        values (${storeId}, 'placed', 'paid', ${currency}, ${number}, now(), ${total}, 0, ${total}, 'cod', 'asha@example.com') returning id`)[0]?.id ?? ''
    const use = async (id: string, orderId: string, amount: number, currency = 'INR') =>
      db.sql`insert into promotion_usage (promotion_id, store_id, order_id, customer_email, discount_amount, currency) values (${id}, ${t.storeA1}, ${orderId}, 'asha@example.com', ${amount}, ${currency})`
    await use(insta, await order(t.storeA1, 'A-1', 90000), 10000)
    await use(insta, await order(t.storeA1, 'A-2', 45001), 5000)
    await use(insta, await order(t.storeA1, 'A-3', 2000, 'USD'), 200, 'USD')
    const results = (await gql(`{ offerResults(id: "${insta}") { uses discountGiven { amount currency } salesWithOffer { amount currency } averageOrder { amount currency } byDay { day uses } } }`, 'staff')).data?.['offerResults']
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
    expect(results).toEqual({
      uses: 3,
      discountGiven: [{ amount: '15000', currency: 'INR' }, { amount: '200', currency: 'USD' }],
      salesWithOffer: [{ amount: '135001', currency: 'INR' }, { amount: '2000', currency: 'USD' }],
      averageOrder: [{ amount: '67501', currency: 'INR' }, { amount: '2000', currency: 'USD' }],
      byDay: [{ day: today, uses: 3 }],
    })
  })

  it('is behind the plan’s results switch, and keeps each store and every supplier out', async () => {
    expect((await gql(`{ offerResults(id: "${insta}") { uses } }`, 'other')).code).toBe('NOT_FOUND')
    expect((await gql(`{ offerResults(id: "${insta}") { uses } }`, 'supplier')).code).toBe('FORBIDDEN')
    await subscribe(t.storeA1, plans.small)
    try {
      const refused = await gql(`{ offerResults(id: "${insta}") { uses } }`, 'owner')
      expect([refused.code, refused.extensions?.['key']]).toEqual(['PLAN_LIMIT', 'offer_results'])
    } finally {
      await subscribe(t.storeA1, plans.full)
    }
  })
})
