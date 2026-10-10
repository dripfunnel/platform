import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withScope, withSystemScope } from '#db/scoped/index'
import { StripeRefused, type StoreBillingStripe, type StripeApi, type StripeInvoice, type StripeSubscription } from '#integrations/stripe/index'
import type { ActivityLog } from '#auth/activity'
import { activityLog } from '#saas/activity/index'
import { en } from '#saas/email/index'
import { handleStripeEvent } from '#saas/billing/index'
import { endTrials, suspendOverdueStores } from '#saas/storeBilling/index'
import { resolveShopper, shopKeyHeader } from '#auth/shopCaller'
import { catalogExportDeliverer } from '#jobs/queues/deliverers/catalogExport'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #329 (SAPI 19): the store's Billing — the partner's plans, a plan change with its proration, the card, the
// details on invoices, the invoices, usage; past due from Stripe, read-only and paid again; 14 days unpaid suspends.

let db: TestDatabase
let t: Tenants
let clock = new Date('2026-10-10T00:00:00Z')
const day = 86_400_000
const periodStart = new Date('2026-10-01T00:00:00Z')
const periodEnd = new Date('2026-10-31T00:00:00Z')
type Who = 'owner' | 'manager' | 'staff' | 'supplier' | 'trialOwner' | 'otherOwner'
const people = {} as Record<Who, string>
const cookies = {} as Record<Who, string>
const plans = { free: '', starter: '', growth: '', business: '', otherPartner: '' }

// ---- Stripe, as far as billing reads and writes it: each idempotency key answers as it first did, as Stripe does ----

const s = (n: number) => Math.floor(n / 1000)
const subs = new Map<string, StripeSubscription>()
const invoices = new Map<string, StripeInvoice>()
// The full list of an invoice's lines, where Stripe embedded only its first page.
const allLines = new Map<string, NonNullable<StripeInvoice['lines']>['data']>()
const keys = new Map<string, unknown>()
const calls: string[] = []
let declineNext = false
let slowCharge: Promise<void> | null = null
// Stripe keeps a refusal under its key too, so the same key never charges after it either.
const once = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
  if (!keys.has(key)) keys.set(key, work())
  return keys.get(key) as Promise<T>
}
const subscriptionOf = (id: string, customer: string, amount: number, metadata: Record<string, string>, status: StripeSubscription['status'] = 'active'): StripeSubscription => ({
  id,
  customer,
  status,
  metadata,
  current_period_start: s(periodStart.getTime()),
  current_period_end: s(periodEnd.getTime()),
  schedule: null,
  latest_invoice: null,
  items: { data: [{ id: `si_${id}`, price: { id: `price_${amount}`, currency: 'usd', unit_amount: amount } }] },
})
const missing = async (): Promise<never> => {
  throw new StripeRefused('resource_missing')
}
const stripe: StripeApi & StoreBillingStripe = {
  createAccount: async () => ({ id: 'acct_x' }),
  addBankAccount: async () => ({ id: 'ba', last4: '0000', status: 'new' }),
  createCustomer: async () => ({ id: 'cus_partner' }),
  attachCard: async (_c, pm) => {
    if (pm === 'pm_declined1') throw new StripeRefused('card_declined')
    return { id: pm, card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2029 } }
  },
  charge: missing,
  refunds: async () => [],
  invoice: async (id) => invoices.get(id) ?? missing(),
  invoiceLines: async (id) => allLines.get(id) ?? missing(),
  payout: missing,
  account: missing,
  subscription: async (id) => subs.get(id) ?? missing(),
  createStoreCustomer: ({ storeId }) => once(`store-customer:${storeId}`, async () => ({ id: `cus_${storeId.slice(0, 8)}` })),
  updateCustomer: async () => {
    calls.push('updateCustomer')
  },
  ensurePlanProduct: async ({ id }) => `dfplan_${id.replaceAll('-', '')}`,
  createSubscription: ({ customer, price, metadata }, key) =>
    once(key, async () => {
      calls.push(`create:${price.amount}`)
      if (declineNext) throw new StripeRefused('card_declined')
      const made = subscriptionOf(`sub_${subs.size + 1}x`, customer, price.amount, metadata)
      subs.set(made.id, made)
      return made
    }),
  changeSubscription: (current, { price, metadata }, key) =>
    once(key, async () => {
      calls.push(`change:${price.amount}`)
      if (slowCharge) await slowCharge
      if (declineNext) throw new StripeRefused('card_declined')
      const changed = subscriptionOf(current.id, current.customer, price.amount, metadata)
      subs.set(current.id, changed)
      return changed
    }),
  scheduleChange: (current, { metadata }, key) =>
    once(key, async () => {
      calls.push(`schedule:${metadata['plan_id'] ?? ''}`)
      subs.set(current.id, { ...current, schedule: 'sub_sched_1' })
      return 'sub_sched_1'
    }),
  releaseSchedule: async () => {
    calls.push('release')
  },
  cancelAtPeriodEnd: (id, key) =>
    once(key, async () => {
      calls.push(`cancel:${id}`)
      const current = subs.get(id) ?? (await missing())
      const cancelled = { ...current, cancel_at_period_end: true }
      subs.set(id, cancelled)
      return cancelled
    }),
  payInvoice: (id, key) =>
    once(key, async () => {
      calls.push(`pay:${id}`)
      return invoices.get(id) ?? missing()
    }),
}

// A plan change's entry that fails once: its transaction rolls back after Stripe has answered, as a lost commit would.
let failPlanEntry = false
const activity: ActivityLog = {
  record: async (tx, entry) => {
    if (failPlanEntry && entry.action === 'billing.plan_changed') {
      failPlanEntry = false
      throw new Error('test: the commit is lost')
    }
    return activityLog.record(tx, entry)
  },
  recordAll: (tx, entries) => activityLog.recordAll(tx, entries),
}

// ---- The world ----

const user = async (partnerId: string, email: string) => (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`)[0]?.id ?? ''

const plan = async (partnerId: string, name: string, monthly: number | null, yearly: number | null, products: number) => {
  const [row] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${name}, 'live') returning id`
  const id = row?.id ?? ''
  await db.sql`insert into plan_price (plan_id, partner_id, version, currency, monthly_amount, yearly_amount) values (${id}, ${partnerId}, 1, 'USD', ${monthly}, ${yearly})`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${id}, ${partnerId}, 1, 'products', ${products}), (${id}, ${partnerId}, 1, 'staff', 2147483647)`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) values (${id}, ${partnerId}, 1, 'offers', ${monthly !== 0})`
  return id
}

const subscribe = async (storeId: string, partnerId: string, planId: string, status: 'trial' | 'active', amount: number, stripeIds: { customer: string; subscription: string } | null) => {
  await db.sql`update store set plan_id = ${planId}, status = ${status} where id = ${storeId}`
  await db.sql`
    insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end, trial_ends_at, stripe_customer_id, stripe_subscription_id, payment_method_brand, payment_method_last4)
    values (${storeId}, ${partnerId}, ${planId}, 1, ${status}, 'month', 'USD', ${amount}, ${periodStart}, ${periodEnd}, ${status === 'trial' ? periodEnd : null}, ${stripeIds?.customer ?? null}, ${stripeIds?.subscription ?? null},
      ${stripeIds ? 'visa' : null}, ${stripeIds ? '1111' : null})
    on conflict (store_id) do update set plan_id = excluded.plan_id, plan_version = 1, status = excluded.status, amount = excluded.amount, interval = 'month',
      period_start = excluded.period_start, period_end = excluded.period_end, trial_ends_at = excluded.trial_ends_at, stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id, next_plan_id = null, next_plan_version = null, next_interval = null, change_at = null, cancel_at = null,
      payment_method_brand = excluded.payment_method_brand, payment_method_last4 = excluded.payment_method_last4, payment_method_expires = null, billing_claim = null, billing_claim_until = null
  `
}

// Store A1 pays monthly for Growth on Stripe; A2 is in its trial on Business; B1 is another partner's.
const reset = async () => {
  subs.clear()
  invoices.clear()
  allLines.clear()
  keys.clear()
  calls.length = 0
  declineNext = false
  failPlanEntry = false
  slowCharge = null
  clock = new Date('2026-10-10T00:00:00Z')
  await db.sql`update partner set billing_mode = 'dripfunnel'`
  await db.sql`update plan set status = 'live' where id = ${plans.free}`
  await db.sql`update product set hidden_by = null where store_id = ${t.storeA2} and hidden_by = 'plan'`
  await db.sql`delete from invoice`
  await db.sql`delete from store_billing_details`
  await db.sql`update store set status = 'active', past_due_since = null, suspended_at = null, suspended_reason = null, suspended_by_label = null, suspended_previous_status = null where id in (${t.storeA1}, ${t.storeA2}, ${t.storeB1})`
  await subscribe(t.storeA1, t.partnerA, plans.growth, 'active', 3000, { customer: 'cus_a1', subscription: 'sub_a1' })
  subs.set('sub_a1', subscriptionOf('sub_a1', 'cus_a1', 3000, { store_id: t.storeA1, plan_id: plans.growth, plan_version: '1', interval: 'month' }))
  await subscribe(t.storeA2, t.partnerA, plans.business, 'trial', 6000, null)
  await db.sql`update store set status = 'trial' where id = ${t.storeA2}`
  await subscribe(t.storeB1, t.partnerB, plans.otherPartner, 'active', 500, { customer: 'cus_b1', subscription: 'sub_b1' })
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`insert into partner_contract (partner_id, fee_currency) values (${t.partnerA}, 'USD'), (${t.partnerB}, 'USD')`
  plans.free = await plan(t.partnerA, 'Free', 0, 0, 2)
  plans.starter = await plan(t.partnerA, 'Starter', 1000, 10000, 100)
  plans.growth = await plan(t.partnerA, 'Growth', 3000, 30000, 1000)
  plans.business = await plan(t.partnerA, 'Business', 6000, null, 5000)
  plans.otherPartner = await plan(t.partnerB, 'Other', 500, null, 50)
  people.owner = await user(t.partnerA, 'owner@a1.example')
  people.manager = await user(t.partnerA, 'manager@a1.example')
  people.staff = await user(t.partnerA, 'staff@a1.example')
  people.supplier = await user(t.partnerA, 'supplier@a1.example')
  people.trialOwner = await user(t.partnerA, 'owner@a2.example')
  people.otherOwner = await user(t.partnerB, 'owner@b1.example')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values
    (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.manager}, ${t.storeA1}, 'manager', 'active'), (${people.staff}, ${t.storeA1}, 'staff', 'active'),
    (${people.trialOwner}, ${t.storeA2}, 'owner', 'active'), (${people.otherOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active')`
  for (const who of Object.keys(people) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'otherOwner' ? t.partnerB : t.partnerA }, clock))
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(reset)

const storeOf = (who: Who) => (who === 'trialOwner' ? t.storeA2 : who === 'otherOwner' ? t.storeB1 : t.storeA1)
const contextFor = async (who: Who, as: 'person' | 'support' | 'impersonation' = 'person'): Promise<StoreContext> => {
  const partnerId = who === 'otherOwner' ? t.partnerB : t.partnerA
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeOf(who), ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}) }
  let standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, clock, activityLog, facts)
  if (as !== 'person' && standing.kind === 'acting') {
    const caller = as === 'support' ? { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: 'write' as const } : { kind: 'impersonation' as const, impersonationId: crypto.randomUUID(), staffId: crypto.randomUUID(), userId: people[who] }
    standing = { ...standing, caller: { ...standing.caller, context: { ...standing.caller.context, caller } } }
  }
  return { standing, partnerId, sql: db.sql, activity, facts, billing: stripe, now: () => clock }
}
const gql = async (source: string, who: Who, variables: Record<string, unknown> = {}, as: 'person' | 'support' | 'impersonation' = 'person') => {
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue: await contextFor(who, as), variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const SUB = 'plan { id name } status interval price { amount currency } periodEnd scheduled { plan { name } interval at } card { brand last4 expires } collectedBy partnerName'
const q = {
  subscription: `{ subscription { ${SUB} } }`,
  catalogue: '{ planCatalogue { id name current monthly { amount currency } yearly { amount } values { key kind enabled amount unlimited } } }',
  usage: '{ usage { key used limit unlimited monthly } }',
  details: '{ billingDetails { legalName email address { line1 city country } taxId taxIdKind } }',
  invoices: '{ invoices(first: 10) { nodes { id number kind status amount { amount currency } lines { label amount { amount currency } kind } } pageInfo { hasNextPage } } }',
  quote: 'query Q($p: ID!, $i: BillingInterval!, $w: PlanChangeWhen!) { planChangeQuote(planId: $p, interval: $i, when: $w) { offered charge { amount } credit { amount } today { amount currency } from nextPrice { amount } } }',
  download: 'query D($id: ID!) { downloadInvoice(id: $id) }',
  change: `mutation C($p: ID!, $i: BillingInterval!, $w: PlanChangeWhen!) { changePlan(planId: $p, interval: $i, when: $w) { ${SUB} } }`,
  card: `mutation P($t: String!) { setPaymentMethod(token: $t) { ${SUB} } }`,
  save: 'mutation S($input: BillingDetailsInput!) { saveBillingDetails(input: $input) { legalName taxId taxIdKind } }',
}
const details = { legalName: 'X', email: 'x@x.example', address: { line1: 'a', city: 'b', postal: 'c', country: 'US' } }
const change = (who: Who, planId: string, when: 'NOW' | 'PERIOD_END', interval: 'MONTH' | 'YEAR' = 'MONTH', as: 'person' | 'support' | 'impersonation' = 'person') => gql(q.change, who, { p: planId, i: interval, w: when }, as)
const storeRow = async (id: string) => (await db.sql<{ status: string; plan_id: string; past_due_since: Date | null; suspended_by_label: string | null }[]>`select status, plan_id, past_due_since, suspended_by_label from store where id = ${id}`)[0]
const entries = (storeId: string, action: string) => db.sql<{ actor_kind: string; reason: string | null }[]>`select actor_kind, reason from activity_log where store_id = ${storeId} and action = ${action}`
const event = (id: string, type: string, objectId: string, object = 'subscription') => handleStripeEvent({ sql: db.sql, stripe, event: { id, type, data: { object: { id: objectId, object } } }, activity: activityLog, now: () => clock })
const invoiceOf = (id: string, over: Partial<StripeInvoice> = {}): StripeInvoice => ({
  id,
  number: `INV-${id}`,
  customer: 'cus_a1',
  status: 'paid',
  billing_reason: 'subscription_update',
  amount_due: 1000,
  amount_paid: 1000,
  currency: 'usd',
  attempt_count: 1,
  created: s(clock.getTime()),
  metadata: { store_id: t.storeA1 },
  invoice_pdf: 'https://pay.stripe.com/invoice/acct_1/pdf',
  status_transitions: { paid_at: s(clock.getTime()), finalized_at: s(clock.getTime()) },
  lines: {
    data: [
      { description: 'Remaining time on Business', amount: 2000, proration: true, period: { start: s(clock.getTime()), end: s(periodEnd.getTime()) } },
      { description: 'Unused time on Growth', amount: -1000, proration: true, period: { start: s(clock.getTime()), end: s(periodEnd.getTime()) } },
    ],
  },
  ...over,
})

describe('who may see and change billing (ACCESS §5.1 `billing`, §11)', () => {
  const reads = [q.subscription, q.catalogue, q.usage, q.details, q.invoices] as const

  it('is the Owner’s: a Manager, Staff and a supplier are refused every query and mutation', async () => {
    for (const who of ['manager', 'staff', 'supplier'] as const) {
      for (const source of reads) expect((await gql(source, who)).code, `${who} ${source}`).toBe('FORBIDDEN')
      expect((await gql(q.quote, who, { p: plans.business, i: 'MONTH', w: 'NOW' })).code).toBe('FORBIDDEN')
      expect((await gql(q.download, who, { id: crypto.randomUUID() })).code).toBe('FORBIDDEN')
      expect((await change(who, plans.business, 'NOW')).code).toBe('FORBIDDEN')
      expect((await gql(q.card, who, { t: 'pm_card12345' })).code).toBe('FORBIDDEN')
      expect((await gql(q.save, who, { input: details })).code).toBe('FORBIDDEN')
    }
    expect(calls).toEqual([])
  })

  it('keeps each store to its own: plans of its own partner, its own invoices, never another store’s by id', async () => {
    invoices.set('in_a1', invoiceOf('in_a1'))
    expect(await event('evt_inv1', 'invoice.paid', 'in_a1', 'invoice')).toBe('handled')
    const own = (await gql(q.invoices, 'owner')).data?.['invoices'] as { nodes: { id: string }[] }
    expect(own.nodes).toHaveLength(1)
    expect(((await gql(q.invoices, 'otherOwner')).data?.['invoices'] as { nodes: unknown[] }).nodes).toEqual([])
    expect((await gql(q.download, 'otherOwner', { id: own.nodes[0]?.id })).code).toBe('NOT_FOUND')
    const theirs = (await gql(q.catalogue, 'otherOwner')).data?.['planCatalogue'] as { name: string }[]
    expect(theirs.map((p) => p.name)).toEqual(['Other'])
    expect((await gql(q.quote, 'otherOwner', { p: plans.business, i: 'MONTH', w: 'NOW' })).code).toBe('PLAN_NOT_LIVE')
    expect((await change('otherOwner', plans.business, 'NOW')).code).toBe('PLAN_NOT_LIVE')
    expect((await gql(q.subscription, 'otherOwner')).data?.['subscription']).toMatchObject({ plan: { name: 'Other' }, partnerName: 'Partner B' })
  })

  it('never lets a support session or an impersonation change the plan, the card or the details', async () => {
    for (const as of ['support', 'impersonation'] as const) {
      expect((await change('owner', plans.business, 'NOW', 'MONTH', as)).code).toBe('FORBIDDEN')
      expect((await gql(q.card, 'owner', { t: 'pm_card12345' }, as)).code).toBe('FORBIDDEN')
      expect((await gql(q.save, 'owner', { input: details }, as)).code).toBe('FORBIDDEN')
    }
    expect(calls).toEqual([])
  })

  it('holds the details and invoices to the store asking at the database: never another store’s, never a supplier’s', async () => {
    await db.sql`insert into store_billing_details (store_id, legal_name, address, email) values (${t.storeB1}, 'B1 Ltd', '{}', 'b@b.example') on conflict do nothing`
    invoices.set('in_b1', invoiceOf('in_b1', { customer: 'cus_b1', metadata: { store_id: t.storeB1 } }))
    await event('evt_b1', 'invoice.paid', 'in_b1', 'invoice')
    const read = (storeId: string, sellerScope: { kind: 'all' } | { kind: 'seller'; sellerId: string }) =>
      withScope(db.sql, { caller: { kind: 'person', userId: people.owner, sessionId: 's' }, partnerId: t.partnerA, storeId, sellerScope, subscription: 'active' }, async (tx) =>
        [...(await tx<{ store_id: string }[]>`select store_id from store_billing_details`), ...(await tx<{ store_id: string }[]>`select store_id from invoice`), ...(await tx<{ store_id: string }[]>`select store_id from invoice_line`)].map((r) => r.store_id),
      )
    expect(await read(t.storeA1, { kind: 'all' })).not.toContain(t.storeB1)
    // A supplier's role holds no grant on them at all.
    await expect(read(t.storeA1, { kind: 'seller', sellerId: t.sellerA1First })).rejects.toThrow(/permission denied/)
    expect(new Set(await read(t.storeB1, { kind: 'all' }))).toEqual(new Set([t.storeB1]))
  })
})

describe('the partner’s plans and this month’s usage', () => {
  it('lists the partner’s Live plans in the store’s currency with what each includes, Unlimited as such', async () => {
    const catalogue = (await gql(q.catalogue, 'owner')).data?.['planCatalogue'] as { name: string; current: boolean; monthly: { amount: string } | null; yearly: { amount: string } | null; values: { key: string; amount: number | null; unlimited: boolean }[] }[]
    expect(catalogue.map((p) => [p.name, p.current, p.monthly?.amount ?? null, p.yearly?.amount ?? null])).toEqual([
      ['Business', false, '6000', null],
      ['Free', false, '0', '0'],
      ['Growth', true, '3000', '30000'],
      ['Starter', false, '1000', '10000'],
    ])
    expect(catalogue[2]?.values.find((v) => v.key === 'staff')).toMatchObject({ amount: null, unlimited: true })
    expect(catalogue[2]?.values.find((v) => v.key === 'products')).toMatchObject({ amount: 1000, unlimited: false })
  })

  it('counts products, staff and suppliers against the plan, Unlimited with no limit', async () => {
    const usage = (await gql(q.usage, 'owner')).data?.['usage'] as { key: string; used: number; limit: number | null; unlimited: boolean }[]
    expect(usage.map((u) => u.key)).toEqual(['products', 'staff', 'suppliers', 'ai_prompts', 'publish_now'])
    expect(usage.find((u) => u.key === 'staff')).toMatchObject({ used: 2, limit: null, unlimited: true })
    expect(usage.find((u) => u.key === 'products')).toMatchObject({ used: 0, limit: 1000, unlimited: false })
    expect(usage.find((u) => u.key === 'suppliers')).toMatchObject({ used: 2 })
  })
})

describe('choosing a plan out of the trial', () => {
  it('needs the card first, takes only Stripe’s token, then starts the first period now', async () => {
    expect((await change('trialOwner', plans.starter, 'NOW')).code).toBe('NO_CARD')
    expect((await gql(q.card, 'trialOwner', { t: '4242424242424242' })).code).toBe('INVALID_INPUT')
    expect((await gql(q.card, 'trialOwner', { t: 'pm_declined1' })).code).toBe('CARD_REFUSED')
    const carded = await gql(q.card, 'trialOwner', { t: 'pm_card12345' })
    expect((carded.data?.['setPaymentMethod'] as { card: unknown }).card).toEqual({ brand: 'visa', last4: '4242', expires: '2029-12' })
    expect((await gql(q.quote, 'trialOwner', { p: plans.starter, i: 'MONTH', w: 'NOW' })).data?.['planChangeQuote']).toMatchObject({ offered: ['NOW'], today: { amount: '1000', currency: 'USD' } })
    expect((await change('trialOwner', plans.starter, 'PERIOD_END')).code).toBe('AT_PERIOD_END_ONLY')
    expect((await change('trialOwner', plans.starter, 'NOW')).data?.['changePlan']).toMatchObject({ plan: { name: 'Starter' }, status: 'active', price: { amount: '1000' }, collectedBy: 'dripfunnel' })
    expect(calls).toEqual(['create:1000'])
    expect(await storeRow(t.storeA2)).toMatchObject({ plan_id: plans.starter, status: 'active' })
    expect(await entries(t.storeA2, 'billing.plan_changed')).toHaveLength(1)
    expect(await entries(t.storeA2, 'billing.payment_method_set')).toHaveLength(1)
  })

  it('moves to Free with no card and nothing on Stripe', async () => {
    expect((await change('trialOwner', plans.free, 'NOW')).data?.['changePlan']).toMatchObject({ plan: { name: 'Free' }, status: 'active' })
    expect(await storeRow(t.storeA2)).toMatchObject({ plan_id: plans.free, status: 'active' })
    expect(calls).toEqual([])
  })

  it('refuses a plan or a card when the partner bills its merchants itself', async () => {
    await db.sql`update partner set billing_mode = 'own' where id = ${t.partnerA}`
    expect((await change('trialOwner', plans.starter, 'NOW')).code).toBe('BILLED_BY_PARTNER')
    expect((await gql(q.card, 'trialOwner', { t: 'pm_card12345' })).code).toBe('BILLED_BY_PARTNER')
    expect((await gql(q.subscription, 'trialOwner')).data?.['subscription']).toMatchObject({ collectedBy: 'partner' })
  })
})

describe('changing a paid plan', () => {
  it('prorates an upgrade now on Stripe and moves the plan at once', async () => {
    // 21 of 30 days left: 6000 × 0.7 = 4200 charged, 3000 × 0.7 = 2100 credited.
    expect((await gql(q.quote, 'owner', { p: plans.business, i: 'MONTH', w: 'NOW' })).data?.['planChangeQuote']).toMatchObject({ offered: ['NOW', 'PERIOD_END'], charge: { amount: '4200' }, credit: { amount: '2100' }, today: { amount: '2100' } })
    expect((await change('owner', plans.business, 'NOW')).data?.['changePlan']).toMatchObject({ plan: { name: 'Business' }, price: { amount: '6000' }, scheduled: null })
    expect(calls).toEqual(['change:6000'])
    expect(await storeRow(t.storeA1)).toMatchObject({ plan_id: plans.business })
  })

  it('leaves the plan as it was when the card is declined, and lets the next try through', async () => {
    declineNext = true
    expect((await change('owner', plans.business, 'NOW')).code).toBe('PAYMENT_FAILED')
    expect(await storeRow(t.storeA1)).toMatchObject({ plan_id: plans.growth })
    declineNext = false
    expect((await change('owner', plans.business, 'NOW')).data?.['changePlan']).toMatchObject({ plan: { name: 'Business' } })
  })

  it('charges once when two changes race: the second waits its turn instead of charging again', async () => {
    let release = (): void => undefined
    slowCharge = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = change('owner', plans.business, 'NOW')
    for (let i = 0; i < 200 && !calls.includes('change:6000'); i++) await new Promise((r) => setTimeout(r, 10))
    const second = await change('owner', plans.business, 'NOW')
    release()
    expect(second.code).toBe('CHANGE_IN_PROGRESS')
    expect((await first).data?.['changePlan']).toMatchObject({ plan: { name: 'Business' } })
    expect(calls.filter((c) => c.startsWith('change:'))).toHaveLength(1)
    expect((await change('owner', plans.business, 'NOW')).code).toBe('SAME_PLAN')
  })

  it('charges once when the commit after Stripe is lost and the Owner tries again', async () => {
    failPlanEntry = true
    expect((await change('owner', plans.business, 'NOW')).data?.['changePlan'] ?? null).toBeNull()
    expect(await storeRow(t.storeA1)).toMatchObject({ plan_id: plans.growth })
    expect((await change('owner', plans.business, 'NOW')).data?.['changePlan']).toMatchObject({ plan: { name: 'Business' } })
    expect(calls.filter((c) => c.startsWith('change:'))).toHaveLength(1)
    await gql(q.card, 'trialOwner', { t: 'pm_card12345' })
    failPlanEntry = true
    expect((await change('trialOwner', plans.starter, 'NOW')).data?.['changePlan'] ?? null).toBeNull()
    expect((await change('trialOwner', plans.starter, 'NOW')).data?.['changePlan']).toMatchObject({ plan: { name: 'Starter' } })
    expect(calls.filter((c) => c.startsWith('create:'))).toHaveLength(1)
  })

  it('schedules a downgrade for the period’s end, applies it when Stripe moves, and can be called off', async () => {
    expect((await change('owner', plans.starter, 'NOW')).code).toBe('AT_PERIOD_END_ONLY')
    const scheduled = (await change('owner', plans.starter, 'PERIOD_END')).data?.['changePlan']
    expect(scheduled).toMatchObject({ plan: { name: 'Growth' }, scheduled: { plan: { name: 'Starter' }, interval: 'MONTH', at: periodEnd.toISOString() } })
    expect(calls).toEqual([`schedule:${plans.starter}`])
    expect(await storeRow(t.storeA1)).toMatchObject({ plan_id: plans.growth })
    // Called off: back to the plan it has, the schedule released.
    expect((await change('owner', plans.growth, 'PERIOD_END')).data?.['changePlan']).toMatchObject({ scheduled: null })
    expect(calls).toContain('release')
    expect(await entries(t.storeA1, 'billing.change_cancelled')).toHaveLength(1)
    // Scheduled again, and the period ends: Stripe's phase names the plan, which the webhook applies.
    await change('owner', plans.starter, 'PERIOD_END')
    subs.set('sub_a1', subscriptionOf('sub_a1', 'cus_a1', 1000, { store_id: t.storeA1, plan_id: plans.starter, plan_version: '1', interval: 'month' }))
    const byStripe = async () => (await entries(t.storeA1, 'billing.plan_changed')).filter((e) => e.actor_kind === 'provider')
    expect(await byStripe()).toEqual([])
    expect(await event('evt_sched', 'customer.subscription.updated', 'sub_a1')).toBe('handled')
    // The move itself is in the log, by Stripe as provider.
    expect(await byStripe()).toEqual([{ actor_kind: 'provider', reason: 'scheduled' }])
    expect((await gql(q.subscription, 'owner')).data?.['subscription']).toMatchObject({ plan: { name: 'Starter' }, price: { amount: '1000' }, scheduled: null })
  })

  it('drops a scheduled downgrade with Stripe’s when an upgrade asked for in its place is declined', async () => {
    await change('owner', plans.starter, 'PERIOD_END')
    const before = (await entries(t.storeA1, 'billing.change_cancelled')).length
    declineNext = true
    expect((await change('owner', plans.business, 'NOW')).code).toBe('PAYMENT_FAILED')
    expect(calls).toContain('release')
    expect((await gql(q.subscription, 'owner')).data?.['subscription']).toMatchObject({ plan: { name: 'Growth' }, scheduled: null })
    expect(await entries(t.storeA1, 'billing.change_cancelled')).toHaveLength(before + 1)
  })

  it('moves monthly to yearly now, and yearly back to monthly only at the year’s end', async () => {
    expect((await gql(q.quote, 'owner', { p: plans.growth, i: 'YEAR', w: 'NOW' })).data?.['planChangeQuote']).toMatchObject({ charge: { amount: '30000' }, credit: { amount: '2100' }, today: { amount: '27900' } })
    expect((await change('owner', plans.growth, 'NOW', 'YEAR')).data?.['changePlan']).toMatchObject({ interval: 'YEAR', price: { amount: '30000' } })
    expect((await change('owner', plans.growth, 'NOW', 'MONTH')).code).toBe('AT_PERIOD_END_ONLY')
  })
})

describe('past due, paid again, and 14 days unpaid (SAAS §4.2, §7.3)', () => {
  const pastDue = async (id: string) => {
    subs.set('sub_a1', { ...(subs.get('sub_a1') as StripeSubscription), status: 'past_due', latest_invoice: 'in_due' })
    invoices.set('in_due', invoiceOf('in_due', { status: 'open', billing_reason: 'subscription_cycle', amount_paid: 0, amount_due: 3000, attempt_count: 1, status_transitions: { finalized_at: s(clock.getTime()) } }))
    return event(id, 'customer.subscription.updated', 'sub_a1')
  }
  const paid = () => subs.set('sub_a1', { ...(subs.get('sub_a1') as StripeSubscription), status: 'active' })

  it('makes the portal read-only while the Owner can still pay with a new card, and active once Stripe says so', async () => {
    expect(await pastDue('evt_pd1')).toBe('handled')
    expect(await pastDue('evt_pd1')).toBe('duplicate')
    expect(await storeRow(t.storeA1)).toMatchObject({ status: 'past_due' })
    expect(await entries(t.storeA1, 'store.past_due')).toEqual([{ actor_kind: 'provider', reason: 'past_due' }])
    expect((await change('owner', plans.business, 'NOW')).code).toBe('READ_ONLY')
    expect((await gql(q.save, 'owner', { input: details })).code).toBe('READ_ONLY')
    expect((await gql(q.subscription, 'owner')).data?.['subscription']).toMatchObject({ status: 'past_due' })
    expect((await gql(q.card, 'owner', { t: 'pm_newcard123' })).code).toBeUndefined()
    expect(calls).toContain('pay:in_due')
    paid()
    expect(await event('evt_pd2', 'customer.subscription.updated', 'sub_a1')).toBe('handled')
    expect(await storeRow(t.storeA1)).toMatchObject({ status: 'active', past_due_since: null })
  })

  it('suspends a store 14 days past due, not 13, and a later payment restores it; a person’s suspension stays', async () => {
    await pastDue('evt_pd3')
    clock = new Date(clock.getTime() + 13 * day)
    expect(await suspendOverdueStores(db.sql, activityLog, clock)).toBe(0)
    clock = new Date(clock.getTime() + day + 1000)
    expect(await suspendOverdueStores(db.sql, activityLog, clock)).toBe(1)
    expect(await suspendOverdueStores(db.sql, activityLog, clock)).toBe(0)
    expect(await storeRow(t.storeA1)).toMatchObject({ status: 'suspended', suspended_by_label: 'Billing' })
    expect(await entries(t.storeA1, 'store.suspended')).toEqual([{ actor_kind: 'job', reason: 'unpaid' }])
    expect(await db.sql`select 1 from outbox where store_id = ${t.storeA1} and payload->>'template' = 'store-suspended' and payload->>'contact' = 'partner-support'`).toHaveLength(1)
    // A suspended store can't pay in the portal (SAAS §4.2), so the reason points to the partner's support, never a payment there.
    expect((await db.sql<{ suspended_reason: string }[]>`select suspended_reason from store where id = ${t.storeA1}`)[0]?.suspended_reason).toBe(en.storeSuspended.unpaid)
    const signedInBefore = cookies.owner
    cookies.owner = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people.owner, partnerId: t.partnerA }, clock))
    expect((await gql(q.subscription, 'owner')).code).toBe('STORE_SUSPENDED')
    expect((await gql(q.card, 'owner', { t: 'pm_newcard123' })).code).toBe('STORE_SUSPENDED')
    cookies.owner = signedInBefore
    paid()
    await event('evt_paidlate', 'customer.subscription.updated', 'sub_a1')
    expect(await storeRow(t.storeA1)).toMatchObject({ status: 'active', suspended_by_label: null })

    await db.sql`update store set status = 'suspended', suspended_at = now(), suspended_reason = 'Fraud check', suspended_by_label = 'Admin', suspended_previous_status = 'active' where id = ${t.storeA1}`
    await event('evt_paidagain', 'customer.subscription.updated', 'sub_a1')
    expect(await storeRow(t.storeA1)).toMatchObject({ status: 'suspended', suspended_by_label: 'Admin' })
  })

  it('ignores a subscription no store holds, or one naming another store', async () => {
    subs.set('sub_stray', subscriptionOf('sub_stray', 'cus_a1', 100, { store_id: t.storeB1 }))
    expect(await event('evt_stray', 'customer.subscription.updated', 'sub_stray')).toBe('unplaced')
    expect(await storeRow(t.storeB1)).toMatchObject({ status: 'active' })
  })
})

describe('invoices and the details on them', () => {
  it('keeps a plan change’s invoice once, with its charge and credit lines, never taken back to open', async () => {
    invoices.set('in_pr', invoiceOf('in_pr'))
    expect(await event('evt_i1', 'invoice.paid', 'in_pr', 'invoice')).toBe('handled')
    invoices.set('in_pr', invoiceOf('in_pr', { status: 'open', amount_paid: 0 }))
    expect(await event('evt_i2', 'invoice.payment_failed', 'in_pr', 'invoice')).toBe('handled')
    const page = (await gql(q.invoices, 'owner')).data?.['invoices'] as { nodes: { id: string; kind: string; status: string; amount: { amount: string }; lines: { amount: { amount: string }; kind: string }[] }[] }
    expect(page.nodes).toHaveLength(1)
    expect(page.nodes[0]).toMatchObject({ kind: 'proration', status: 'paid', amount: { amount: '1000', currency: 'USD' }, lines: [{ amount: { amount: '2000', currency: 'USD' }, kind: 'proration_charge' }, { amount: { amount: '-1000', currency: 'USD' }, kind: 'proration_credit' }] })
    expect((await gql(q.download, 'owner', { id: page.nodes[0]?.id })).data?.['downloadInvoice']).toBe('https://pay.stripe.com/invoice/acct_1/pdf')
  })

  it('keeps every line of an invoice whose list Stripe embedded only in part', async () => {
    const line = (n: number) => ({ id: `il_${n}`, description: `Line ${n}`, amount: 500, proration: false, period: null })
    invoices.set('in_long', invoiceOf('in_long', { amount_paid: 1500, amount_due: 1500, billing_reason: 'subscription_cycle', lines: { data: [line(1)], has_more: true } }))
    allLines.set('in_long', [line(1), line(2), line(3)])
    expect(await event('evt_long', 'invoice.paid', 'in_long', 'invoice')).toBe('handled')
    expect((await db.sql<{ n: string }[]>`select sum(l.amount)::text as n from invoice_line l join invoice i on i.id = l.invoice_id where i.stripe_invoice_id = 'in_long'`)[0]?.n).toBe('1500')
  })

  it('saves the details with a valid tax number, and an issued invoice keeps the details it was issued with', async () => {
    const input = { legalName: 'A1 Retail Pvt Ltd', email: 'accounts@a1.example', address: { line1: '12 MI Road', city: 'Jaipur', postal: '302001', country: 'IN' }, taxId: '08AAKCD1234Q1Z2' }
    expect((await gql(q.save, 'owner', { input: { ...input, taxId: 'DE312345678' } })).code).toBe('INVALID_INPUT')
    expect((await gql(q.save, 'owner', { input })).data?.['saveBillingDetails']).toEqual({ legalName: 'A1 Retail Pvt Ltd', taxId: '08AAKCD1234Q1Z2', taxIdKind: 'gstin' })
    expect(calls).toContain('updateCustomer')
    invoices.set('in_snap', invoiceOf('in_snap'))
    await event('evt_snap', 'invoice.paid', 'in_snap', 'invoice')
    await gql(q.save, 'owner', { input: { ...input, legalName: 'Renamed Ltd' } })
    await event('evt_snap2', 'invoice.updated', 'in_snap', 'invoice')
    expect((await db.sql<{ name: string }[]>`select billing_details->>'legal_name' as name from invoice where stripe_invoice_id = 'in_snap'`)[0]?.name).toBe('A1 Retail Pvt Ltd')
    expect((await gql(q.details, 'owner')).data?.['billingDetails']).toMatchObject({ legalName: 'Renamed Ltd', address: { city: 'Jaipur', country: 'IN' } })
  })
})

// ---- Part 2: Choose what to keep, close the store, take its data, and the trials that end ----

const kept = { waiting: '', second: '', third: '', fourth: '' }
const productIn = async (storeId: string, name: string) => {
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, ${name}, ${name.toLowerCase().replaceAll(' ', '-')}, 'visible') returning id`
  const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position) values (${storeId}, ${p?.id ?? ''}, ${name.replaceAll(' ', '-')}, 0) returning id`
  return { id: p?.id ?? '', version: v?.id ?? '' }
}
const orderOf = async (storeId: string, line: { id: string; version: string }, quantity: number, fulfilled: boolean, number: string) => {
  const [o] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, payment_state, fulfilment_state, currency, number, placed_at, total_amount, payment_method, shipping_option, stock_reserved, email, shipping_address)
    values (${storeId}, 'placed', 'paid', ${fulfilled ? 'fulfilled' : 'unfulfilled'}, 'USD', ${number}, now(), 1000, 'cod', 'courier', false, 'priya@example.com',
      ${db.sql.json({ name: 'Priya', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '73301', country: 'US', phone: null })})
    returning id`
  await db.sql`insert into order_line (order_id, store_id, version_id, product_id, name, sku, quantity, fulfilled_quantity, unit_amount, line_total_amount, position)
    values (${o?.id ?? ''}, ${storeId}, ${line.version}, ${line.id}, 'Item', 'IT-1', ${quantity}, ${fulfilled ? quantity : 0}, 500, ${500 * quantity}, 0)`
}
const pausedIn = async (storeId: string) => (await db.sql<{ id: string }[]>`select id from product where store_id = ${storeId} and hidden_by = 'plan' order by id`).map((r) => r.id).sort()
const KEEP = 'plan { name } limit from products paused kept waiting'

describe('choose what to keep (SAAS §6.2, PortalKeep)', () => {
  beforeAll(async () => {
    // A2 (in its trial) sells four products: one with an order waiting to ship, one its best seller.
    const a = await productIn(t.storeA2, 'Waiting Kurta')
    const b = await productIn(t.storeA2, 'Second Kurta')
    const c = await productIn(t.storeA2, 'Third Kurta')
    const d = await productIn(t.storeA2, 'Fourth Kurta')
    Object.assign(kept, { waiting: a.id, second: b.id, third: c.id, fourth: d.id })
    await orderOf(t.storeA2, a, 1, false, 'A2-1001')
    await orderOf(t.storeA2, d, 9, true, 'A2-1002')
  })

  it('shows what the free plan would keep when the trial ends: the waiting order’s product always, then the best seller', async () => {
    const k = (await gql(`{ planKeep { ${KEEP} } }`, 'trialOwner')).data?.['planKeep'] as { plan: { name: string }; limit: number; from: string; products: number; paused: number; kept: string[]; waiting: string[] }
    expect(k).toMatchObject({ plan: { name: 'Free' }, limit: 2, from: periodEnd.toISOString(), products: 4, paused: 2, waiting: [kept.waiting] })
    expect(new Set(k.kept)).toEqual(new Set([kept.waiting, kept.fourth]))
    expect(await pausedIn(t.storeA2)).toEqual([])
  })

  it('takes the Owner’s picks within the limit, only the store’s own products, and keeps them for the trial’s end', async () => {
    const keep = (ids: string[], who: Who = 'trialOwner') => gql(`mutation K($ids: [ID!]!) { keepProducts(ids: $ids) { ${KEEP} } }`, who, { ids })
    expect((await keep([kept.second, kept.third, kept.fourth])).code).toBe('TOO_MANY')
    const other = await productIn(t.storeB1, 'Elsewhere')
    expect((await keep([other.id])).code).toBe('NOT_FOUND')
    expect((await keep(['not-an-id'])).code).toBe('INVALID_INPUT')
    expect((await keep([kept.third], 'owner')).code).toBe('NOTHING_TO_KEEP')
    for (const who of ['manager', 'staff', 'supplier'] as const) expect((await keep([kept.third], who)).code).toBe('FORBIDDEN')
    expect((await keep([kept.third])).data?.['keepProducts']).toMatchObject({ kept: expect.arrayContaining([kept.waiting, kept.third]) })
    expect(await pausedIn(t.storeA2)).toEqual([])

    // The trial ends with no plan chosen: Free, with the picks, and nothing deleted.
    clock = new Date(periodEnd.getTime() + 60_000)
    expect(await endTrials(db.sql, activityLog, clock)).toBe(1)
    expect(await endTrials(db.sql, activityLog, clock)).toBe(0)
    expect(await storeRow(t.storeA2)).toMatchObject({ status: 'active', plan_id: plans.free })
    expect(await pausedIn(t.storeA2)).toEqual([kept.second, kept.fourth].sort())
    expect(await entries(t.storeA2, 'store.trial_ended')).toEqual([{ actor_kind: 'job', reason: 'free_plan' }])
    expect(await db.sql`select 1 from product where store_id = ${t.storeA2} and deleted_at is not null`).toHaveLength(0)
  })

  it('applies picks at once on the plan the store is on, and brings everything back on a bigger plan', async () => {
    await db.sql`update store_subscription set status = 'active', trial_ends_at = null, plan_id = ${plans.free}, amount = 0 where store_id = ${t.storeA2}`
    await db.sql`update store set status = 'active', plan_id = ${plans.free} where id = ${t.storeA2}`
    const keep = (ids: string[]) => gql(`mutation K($ids: [ID!]!) { keepProducts(ids: $ids) { ${KEEP} } }`, 'trialOwner', { ids })
    expect((await keep([kept.second])).data?.['keepProducts']).toMatchObject({ from: null, paused: 2 })
    expect(await pausedIn(t.storeA2)).toEqual([kept.third, kept.fourth].sort())
    await gql(q.card, 'trialOwner', { t: 'pm_card12345' })
    expect((await change('trialOwner', plans.starter, 'NOW')).data?.['changePlan']).toMatchObject({ plan: { name: 'Starter' } })
    expect(await pausedIn(t.storeA2)).toEqual([])
  })

  it('leaves a trial with no free plan owing one: read-only, and choosing a plan is how it pays', async () => {
    await db.sql`update plan set status = 'retired' where id = ${plans.free}`
    clock = new Date(periodEnd.getTime() + 60_000)
    expect(await endTrials(db.sql, activityLog, clock)).toBe(1)
    expect(await storeRow(t.storeA2)).toMatchObject({ status: 'past_due' })
    expect(await entries(t.storeA2, 'store.trial_ended')).toContainEqual({ actor_kind: 'job', reason: 'no_free_plan' })
    cookies.trialOwner = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people.trialOwner, partnerId: t.partnerA }, clock))
    expect((await gql(q.save, 'trialOwner', { input: details })).code).toBe('READ_ONLY')
    await gql(q.card, 'trialOwner', { t: 'pm_card12345' })
    expect((await change('trialOwner', plans.starter, 'NOW')).data?.['changePlan']).toMatchObject({ plan: { name: 'Starter' }, status: 'active' })
    expect(await storeRow(t.storeA2)).toMatchObject({ status: 'active' })
  })
})

describe('closing the store (SAAS §4.2)', () => {
  const close = (who: Who, as: 'person' | 'support' | 'impersonation' = 'person') => gql(`mutation { cancelStore { ${SUB} cancelAt } }`, who, {}, as)
  const shopAvailable = async (storeId: string) => {
    const [row] = await db.sql<{ key: string }[]>`select public_store_key as key from storefront where store_id = ${storeId}`
    await db.sql`update store set pricing_currency = 'USD' where id = ${storeId}`
    const found = await resolveShopper(db.sql, new Request('https://api.example/shop-api', { headers: { [shopKeyHeader]: row?.key ?? '' } }), 'api.example')
    return found.kind === 'found' ? found.shopper.available : null
  }

  it('is the Owner’s own act', async () => {
    for (const who of ['manager', 'staff', 'supplier'] as const) expect((await close(who)).code).toBe('FORBIDDEN')
    for (const as of ['support', 'impersonation'] as const) expect((await close('owner', as)).code).toBe('FORBIDDEN')
    expect(await storeRow(t.storeA1)).toMatchObject({ status: 'active' })
  })

  it('ends a paid plan at its period’s end: read-only now, the storefront selling until then, once', async () => {
    const closed = (await close('owner')).data?.['cancelStore']
    expect(closed).toMatchObject({ cancelAt: periodEnd.toISOString() })
    expect(calls).toEqual(['cancel:sub_a1'])
    expect(await storeRow(t.storeA1)).toMatchObject({ status: 'cancelled' })
    expect(await entries(t.storeA1, 'store.cancelled')).toContainEqual({ actor_kind: 'person', reason: null })
    expect(await db.sql`select 1 from outbox where store_id = ${t.storeA1} and payload->>'template' = 'store-cancelled'`).toHaveLength(1)
    expect(await shopAvailable(t.storeA1)).toBe(true)
    expect((await close('owner')).code).toBe('CANCELLED')
    expect((await change('owner', plans.business, 'NOW')).code).toBe('CANCELLED')
    expect((await gql(q.save, 'owner', { input: details })).code).toBe('READ_ONLY')
    // The period ends: Stripe deletes the subscription, and the storefront stops.
    subs.set('sub_a1', { ...(subs.get('sub_a1') as StripeSubscription), status: 'canceled' })
    expect(await event('evt_ended', 'customer.subscription.deleted', 'sub_a1')).toBe('handled')
    await db.sql`update store_subscription set cancel_at = ${new Date(Date.now() - 1000)} where store_id = ${t.storeA1}`
    expect(await shopAvailable(t.storeA1)).toBe(false)
  })

  it('ends a trial at once, with nothing on Stripe', async () => {
    expect((await close('trialOwner')).data?.['cancelStore']).toMatchObject({ status: 'cancelled' })
    expect(calls).toEqual([])
    expect(await storeRow(t.storeA2)).toMatchObject({ status: 'cancelled' })
  })
})

describe('the store’s data (`store.export`)', () => {
  const ask = (who: Who, as: 'person' | 'support' | 'impersonation' = 'person') => gql('mutation { exportStoreData }', who, {}, as)
  const parts = (who: Who, id: string) => gql('query E($id: ID!) { storeDataExport(id: $id) { kind state rows csv } }', who, { id })

  it('is the Owner’s alone, never a Manager’s, Staff’s, supplier’s or a support session’s', async () => {
    for (const who of ['manager', 'staff', 'supplier'] as const) expect((await ask(who)).code).toBe('FORBIDDEN')
    for (const as of ['support', 'impersonation'] as const) expect((await ask('owner', as)).code).toBe('FORBIDDEN')
    expect((await parts('manager', crypto.randomUUID())).code).toBe('FORBIDDEN')
  })

  it('makes the products, orders and customers, read back together by its Owner only, even read-only', async () => {
    await db.sql`update store set status = 'cancelled', cancelled_at = now() where id = ${t.storeA2}`
    const bundle = (await ask('trialOwner')).data?.['exportStoreData'] as string
    expect(bundle).toMatch(/^[0-9a-f-]{36}$/)
    const queued = (await parts('trialOwner', bundle)).data?.['storeDataExport'] as { kind: string; state: string }[]
    expect(queued.map((p) => [p.kind, p.state])).toEqual([['customers', 'queued'], ['orders', 'queued'], ['products', 'queued']])
    const deliver = catalogExportDeliverer(db.sql)
    for (const row of await db.sql<{ id: string; payload: Record<string, unknown> }[]>`select id, payload from outbox where kind = 'export.catalog' and store_id = ${t.storeA2}`) {
      await deliver.deliver({ id: row.id, kind: 'export.catalog', payload: row.payload, attempt: 1 } as Parameters<typeof deliver.deliver>[0], new AbortController().signal)
    }
    const done = (await parts('trialOwner', bundle)).data?.['storeDataExport'] as { kind: string; state: string; rows: number; csv: string }[]
    expect(done.map((p) => p.state)).toEqual(['done', 'done', 'done'])
    expect(done.find((p) => p.kind === 'products')?.csv).toContain('Waiting Kurta')
    expect(((await parts('otherOwner', bundle)).data?.['storeDataExport'] as unknown[])).toEqual([])
    expect(((await parts('owner', bundle)).data?.['storeDataExport'] as unknown[])).toEqual([])
    expect(await entries(t.storeA2, 'store.data_exported')).toHaveLength(1)
  })
})
