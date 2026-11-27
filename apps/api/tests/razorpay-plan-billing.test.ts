import { createHmac } from 'node:crypto'
import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { PaymentRefused } from '#core/payments'
import { withSystemScope } from '#db/scoped/index'
import { razorpayBilling, type RazorpayBilling, type RazorpayInvoice, type RazorpayPayment, type RazorpaySubscription } from '#integrations/payments/index'
import { activityLog } from '#saas/activity/index'
import { createPartnerRazorpayService } from '#saas/billing/index'
import { handleRazorpayBillingHook } from '#hooks/razorpayBilling'
import { followEndedSubscriptions, queueRenewalReminders, settleFromRazorpayWebhook } from '#saas/storeBilling/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1744 (SAAS §7.4): a merchant pays its partner for its plan through Razorpay Subscriptions on the partner's own
// account. The partner connects its keys; the Owner's first payment in Checkout starts the subscription and its mandate;
// Razorpay renews it, and the platform follows it, read back from Razorpay.

let db: TestDatabase
let t: Tenants
let secrets: SecretBox
let clock = new Date('2026-11-10T00:00:00Z')
const day = 86_400_000
const facts = { requestId: 'r', ip: null, userAgent: null }
const plans = { free: '', growth: '', big: '', other: '' }
const people = { owner: '', trialOwner: '', otherOwner: '' }
const cookies = { owner: '', trialOwner: '', otherOwner: '' }
type Who = keyof typeof people
const keys = { keyId: 'rzp_test_AbCdEf123456', keySecret: 'secret_test_value', webhookSecret: 'hook_secret_value' }

// ---- Razorpay Subscriptions, as far as plan billing reads and writes it ----

let n = 0
const seconds = (d: Date) => Math.floor(d.getTime() / 1000)
const rz = {
  plans: new Map<string, { amount: number; interval: string }>(),
  subs: new Map<string, RazorpaySubscription>(),
  addons: new Map<string, number>(),
  invoices: new Map<string, RazorpayInvoice[]>(),
  payments: new Map<string, RazorpayPayment>(),
  calls: [] as string[],
  refuseKeys: false,
  otherAccount: false,
}
const id = (prefix: string) => `${prefix}_T${String((n += 1)).padStart(6, '0')}`
const subOf = (subscriptionId: string): RazorpaySubscription => {
  const s = rz.subs.get(subscriptionId)
  if (!s) throw new PaymentRefused('answered 404')
  return s
}
const real = razorpayBilling({ fetchImpl: () => Promise.reject(new Error('test: no network')) })
const fake: RazorpayBilling = {
  ...real,
  verify: async () => {
    if (rz.refuseKeys) throw new PaymentRefused('answered 401')
  },
  createPlan: async (_k, p) => {
    const planId = id('plan')
    rz.plans.set(planId, { amount: p.amount, interval: p.interval })
    return planId
  },
  createSubscription: async (_k, s) => {
    const sub: RazorpaySubscription = { id: id('sub'), status: 'created', plan_id: s.razorpayPlanId, customer_id: null, current_start: null, current_end: null, start_at: s.startAt ? seconds(s.startAt) : null, paid_count: 0, notes: { df_store_id: s.storeId } }
    rz.subs.set(sub.id, sub)
    if (s.addon) rz.addons.set(sub.id, s.addon.amount)
    return sub
  },
  subscription: async (k, subscriptionId) => {
    if (k.keyId !== keys.keyId && rz.otherAccount) throw new PaymentRefused('answered 400')
    return { ...subOf(subscriptionId) }
  },
  cancelAtCycleEnd: async (_k, subscriptionId) => {
    rz.calls.push(`cancel_at_cycle_end:${subscriptionId}`)
    return { ...subOf(subscriptionId) }
  },
  cancelNow: async (_k, subscriptionId) => {
    rz.calls.push(`cancel_now:${subscriptionId}`)
    const s = subOf(subscriptionId)
    s.status = 'cancelled'
    return { ...s }
  },
  invoices: async (_k, subscriptionId) => rz.invoices.get(subscriptionId) ?? [],
  payment: async (_k, paymentId) => {
    const p = rz.payments.get(paymentId)
    if (!p) throw new PaymentRefused('answered 404')
    return p
  },
}

/**
 * The Owner pays in Checkout, and Checkout signs the answer. A subscription starting now is active for its first period; one
 * starting later (a plan change) is only authenticated, its add-on or Razorpay's authorisation paid today.
 */
const authorise = (subscriptionId: string, payment: Partial<RazorpayPayment> = {}) => {
  const s = subOf(subscriptionId)
  const later = !!s.start_at
  const p: RazorpayPayment = { id: id('pay'), status: 'captured', amount: later ? (rz.addons.get(s.id) ?? 500) : (rz.plans.get(s.plan_id)?.amount ?? 0), currency: 'INR', method: 'card', card: { last4: '1111', network: 'Visa' }, ...payment }
  rz.payments.set(p.id, p)
  Object.assign(s, later ? { status: 'authenticated', customer_id: 'cust_T0OWNER1' } : { status: 'active', customer_id: 'cust_T0OWNER1', current_start: seconds(clock), current_end: seconds(new Date(clock.getTime() + 30 * day)), paid_count: 1 })
  return { p: p.id, s: subscriptionId, g: createHmac('sha256', keys.keySecret).update(`${p.id}|${subscriptionId}`).digest('hex') }
}
/** Razorpay charges the next period on its own. */
const renew = (subscriptionId: string, start: Date, end: Date, planId?: string) => {
  const s = subOf(subscriptionId)
  const pay = id('pay')
  Object.assign(s, { status: 'active', current_start: seconds(start), current_end: seconds(end), paid_count: s.paid_count + 1, ...(planId ? { plan_id: planId } : {}) })
  rz.invoices.set(subscriptionId, [{ id: id('inv'), status: 'paid', payment_id: pay, billing_start: seconds(start), billing_end: seconds(end) }, ...(rz.invoices.get(subscriptionId) ?? [])])
}
const webhook = (subscriptionId: string, secret = keys.webhookSecret) => {
  const body = JSON.stringify({ event: 'subscription.charged', payload: { subscription: { entity: { id: subscriptionId } } } })
  return { body, signature: createHmac('sha256', secret).update(body).digest('hex') }
}

// ---- The world ----

const user = async (partnerId: string, email: string) => (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, 'Owner', 'active') returning id`)[0]?.id ?? ''
const plan = async (partnerId: string, name: string, monthly: number) => {
  const pid = (await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${name}, 'live') returning id`)[0]?.id ?? ''
  await db.sql`insert into plan_price (plan_id, partner_id, version, currency, monthly_amount, yearly_amount) values (${pid}, ${partnerId}, 1, 'INR', ${monthly}, ${monthly * 10})`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${pid}, ${partnerId}, 1, 'products', 1000), (${pid}, ${partnerId}, 1, 'staff', 2147483647)`
  return pid
}
const subscribe = async (storeId: string, partnerId: string, planId: string, status: 'trial' | 'active', amount: number, periodStart: Date, periodEnd: Date) => {
  await db.sql`update store set plan_id = ${planId}, status = ${status}, past_due_since = null where id = ${storeId}`
  await db.sql`
    insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end, trial_ends_at)
    values (${storeId}, ${partnerId}, ${planId}, 1, ${status}, 'month', 'INR', ${amount}, ${periodStart}, ${periodEnd}, ${status === 'trial' ? periodEnd : null})
    on conflict (store_id) do update set plan_id = excluded.plan_id, plan_version = 1, status = excluded.status, amount = excluded.amount, interval = 'month',
      period_start = excluded.period_start, period_end = excluded.period_end, trial_ends_at = excluded.trial_ends_at, next_plan_id = null, next_plan_version = null,
      next_interval = null, change_at = null, cancel_at = null, razorpay_subscription_id = null, razorpay_customer_id = null, razorpay_mode = null, payment_method_label = null,
      payment_method_brand = null, payment_method_last4 = null, payment_method_expires = null, billing_claim = null, billing_claim_until = null`
}

const callerOf = (partnerId: string, role: PartnerRole, staff: PartnerCaller['staff'] = null): PartnerCaller => ({
  role,
  user: { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@a.example' },
  staff,
  partner: { id: partnerId, name: partnerId === t.partnerA ? 'Northstar Commerce' : 'Bazaar Cloud', product: 'Shops', host: null, state: 'live' },
})
const platform = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const razorpay = createPartnerRazorpayService({ sql: db.sql, caller, facts, activity: activityLog, secrets, api: fake, hooksHost: 'hooks.example', now: () => clock })
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue: { caller, razorpay } })
  return { data: (result.data ?? null) as T | null, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const connect = (partnerId: string, role: PartnerRole = 'partner-finance', k = keys, mode = 'test') =>
  platform<{ connectRazorpay: { ok: boolean; reason: string | null } }>(
    'mutation C($m: String!, $k: String!, $s: String!, $w: String!) { connectRazorpay(mode: $m, keyId: $k, keySecret: $s, webhookSecret: $w) { ok reason } }',
    callerOf(partnerId, role),
    { m: mode, k: k.keyId, s: k.keySecret, w: k.webhookSecret },
  )

const disconnectAll = async () => {
  for (const m of ['live', 'test']) await platform('mutation D($m: String!) { disconnectRazorpay(mode: $m) { ok } }', callerOf(t.partnerA, 'partner-owner'), { m })
}

const storeOf = (who: Who) => (who === 'trialOwner' ? t.storeA2 : who === 'otherOwner' ? t.storeB1 : t.storeA1)
const store = async (source: string, who: Who, variables: Record<string, unknown> = {}) => {
  const partnerId = who === 'otherOwner' ? t.partnerB : t.partnerA
  const headers = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeOf(who) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, clock, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, secrets, razorpayBilling: fake, now: () => clock }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const q = {
  start: 'mutation S($p: ID!, $w: PlanChangeWhen) { startPlanPayment(planId: $p, interval: MONTH, when: $w) { keyId subscriptionId amount { amount currency } mode upi } }',
  confirm: 'mutation C($p: String!, $s: String!, $g: String!) { confirmPlanPayment(paymentId: $p, subscriptionId: $s, signature: $g) { outcome subscription { status plan { id } upiAutoPay card { brand last4 } } } }',
  change: 'mutation P($p: ID!, $w: PlanChangeWhen!) { changePlan(planId: $p, interval: MONTH, when: $w) { status plan { id } scheduled { plan { id } } } }',
  payments: '{ planPayments { available mode subscribed } }',
  close: 'mutation { cancelStore { cancelAt } }',
}
type Checkout = { keyId: string; subscriptionId: string; amount: { amount: string; currency: string }; mode: string; upi: boolean }
const deps = () => ({ sql: db.sql, api: fake, secrets, activity: activityLog, now: () => clock })

/** The Owner picks a plan and pays it in Checkout: the store is on it, with its subscription. */
const subscribeVia = async (who: Who, planId: string, w?: 'NOW' | 'PERIOD_END') => {
  const started = (await store(q.start, who, { p: planId, w })).data?.['startPlanPayment'] as Checkout
  const answer = authorise(started.subscriptionId)
  await store(q.confirm, who, answer)
  return started.subscriptionId
}
const subRow = async (storeId: string) =>
  (await db.sql<{ status: string; plan_id: string; period_start: Date; period_end: Date; razorpay_subscription_id: string | null; razorpay_customer_id: string | null; payment_method_label: string | null; next_plan_id: string | null; cancel_at: Date | null }[]>`
    select status, plan_id, period_start, period_end, razorpay_subscription_id, razorpay_customer_id, payment_method_label, next_plan_id, cancel_at from store_subscription where store_id = ${storeId}`)[0]
const storeStatus = async (storeId: string) => (await db.sql<{ status: string }[]>`select status from store where id = ${storeId}`)[0]?.status
const entries = async (storeId: string, action: string) => (await db.sql`select 1 from activity_log where store_id = ${storeId} and action = ${action}`).length

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(Buffer.alloc(32, 7).toString('base64'))
  plans.free = await plan(t.partnerA, 'Free', 0)
  plans.growth = await plan(t.partnerA, 'Growth', 99_900)
  plans.big = await plan(t.partnerA, 'Big', 2_000_000)
  plans.other = await plan(t.partnerB, 'Other', 50_000)
  people.owner = await user(t.partnerA, 'owner@a1.example')
  people.trialOwner = await user(t.partnerA, 'owner@a2.example')
  people.otherOwner = await user(t.partnerB, 'owner@b1.example')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.trialOwner}, ${t.storeA2}, 'owner', 'active'), (${people.otherOwner}, ${t.storeB1}, 'owner', 'active')`
  for (const who of Object.keys(people) as Who[]) cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'otherOwner' ? t.partnerB : t.partnerA }, clock))
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(async () => {
  clock = new Date('2026-11-10T00:00:00Z')
  Object.assign(rz, { plans: new Map(), subs: new Map(), addons: new Map(), invoices: new Map(), payments: new Map(), calls: [], refuseKeys: false, otherAccount: false })
  await db.sql`delete from outbox where payload->>'template' = 'plan-renewal-reminder'`
  await db.sql`delete from store_plan_charge`
  await db.sql`delete from razorpay_plan`
  await db.sql`delete from partner_credential where kind = 'billing'`
  await db.sql`update partner set billing_mode = 'own'`
  await subscribe(t.storeA1, t.partnerA, plans.growth, 'trial', 99_900, new Date('2026-11-01T00:00:00Z'), new Date('2026-11-15T00:00:00Z'))
  await subscribe(t.storeA2, t.partnerA, plans.growth, 'trial', 99_900, new Date('2026-11-01T00:00:00Z'), new Date('2026-11-15T00:00:00Z'))
  await subscribe(t.storeB1, t.partnerB, plans.other, 'active', 50_000, new Date('2026-10-12T00:00:00Z'), new Date('2026-11-12T00:00:00Z'))
})

describe('the partner’s Razorpay account', () => {
  it('lets Owner and Finance connect keys Razorpay accepts, sealed, shown only as the mode and last four, and logged', async () => {
    expect((await connect(t.partnerA)).data?.connectRazorpay).toEqual({ ok: true, reason: null })
    const account = (await platform<{ razorpayAccount: { webhookUrl: string; modes: { mode: string; connected: boolean; keyHint: string | null }[] } }>('{ razorpayAccount { webhookUrl modes { mode connected keyHint } } }', callerOf(t.partnerA, 'partner-read-only'))).data?.razorpayAccount
    expect(account?.webhookUrl).toBe(`https://hooks.example/razorpay/partner/${t.partnerA}`)
    expect(account?.modes).toEqual([{ mode: 'live', connected: false, keyHint: null }, { mode: 'test', connected: true, keyHint: 'rzp_test_••••3456' }])
    const [row] = await db.sql<{ key_enc: string }[]>`select key_enc from partner_credential where partner_id = ${t.partnerA} and kind = 'billing'`
    expect(row?.key_enc).not.toContain(keys.keySecret)
    expect(JSON.stringify(account)).not.toContain(keys.keySecret)
    expect(await db.sql`select 1 from activity_log where partner_id = ${t.partnerA} and action = 'partner.razorpay_connected'`).toHaveLength(1)
  })

  it('refuses keys of the other mode, keys Razorpay refuses, and everyone but Owner and Finance', async () => {
    expect((await connect(t.partnerA, 'partner-finance', keys, 'live')).data?.connectRazorpay.reason).toBe('INVALID_INPUT')
    rz.refuseKeys = true
    expect((await connect(t.partnerA)).data?.connectRazorpay.reason).toBe('KEY_REJECTED')
    rz.refuseKeys = false
    for (const role of ['partner-admin', 'partner-read-only', 'partner-support'] as const) expect((await connect(t.partnerA, role)).code).toBe('FORBIDDEN')
    expect(await db.sql`select 1 from partner_credential where kind = 'billing'`).toHaveLength(0)
  })

  it('holds live and test keys side by side, and keeps the stores’ subscriptions when the keys are rotated on the same account', async () => {
    const live = { keyId: 'rzp_live_AbCdEf654321', keySecret: 'secret_live_value', webhookSecret: 'hook_live_value' }
    await connect(t.partnerA)
    expect((await connect(t.partnerA, 'partner-finance', live, 'live')).data?.connectRazorpay).toEqual({ ok: true, reason: null })
    await disconnectAll()
    await connect(t.partnerA)
    const subscriptionId = await subscribeVia('owner', plans.growth)
    const rotated = { ...keys, keyId: 'rzp_test_RotAted9999', keySecret: 'rotated_secret' }
    await connect(t.partnerA, 'partner-finance', rotated)
    expect((await subRow(t.storeA1))?.razorpay_subscription_id).toBe(subscriptionId)
    // Another account's keys can't read the subscription: the store subscribes again on it.
    rz.otherAccount = true
    await connect(t.partnerA, 'partner-finance', { ...keys, keyId: 'rzp_test_OthEr0000001', keySecret: 'other_secret' })
    expect((await subRow(t.storeA1))?.razorpay_subscription_id).toBeNull()
  })

  it('shows one partner nothing of another’s, and disconnects only its own', async () => {
    await connect(t.partnerA)
    const theirs = (await platform<{ razorpayAccount: { modes: { connected: boolean }[] } }>('{ razorpayAccount { modes { connected } } }', callerOf(t.partnerB, 'partner-owner'))).data?.razorpayAccount
    expect(theirs?.modes.every((m) => !m.connected)).toBe(true)
    const off = 'mutation D($m: String!) { disconnectRazorpay(mode: $m) { ok reason } }'
    expect((await platform<{ disconnectRazorpay: { reason: string } }>(off, callerOf(t.partnerB, 'partner-owner'), { m: 'test' })).data?.disconnectRazorpay.reason).toBe('NOT_FOUND')
    expect((await platform<{ disconnectRazorpay: { ok: boolean } }>(off, callerOf(t.partnerA, 'partner-owner'), { m: 'test' })).data?.disconnectRazorpay.ok).toBe(true)
    expect(await db.sql`select 1 from partner_credential where partner_id = ${t.partnerA} and kind = 'billing'`).toHaveLength(0)
  })

  it('forgets the stores’ subscriptions when the keys are disconnected, so a paid plan after is a first payment', async () => {
    await connect(t.partnerA)
    await subscribeVia('owner', plans.growth)
    await disconnectAll()
    expect((await subRow(t.storeA1))?.razorpay_subscription_id).toBeNull()
  })
})

describe('the first payment', () => {
  it('is refused while the partner has no Razorpay, and says so', async () => {
    expect((await store(q.payments, 'owner')).data?.['planPayments']).toEqual({ available: false, mode: null, subscribed: false })
    expect((await store(q.start, 'owner', { p: plans.growth })).code).toBe('BILLED_BY_PARTNER')
  })

  it('starts a Razorpay subscription on the plan’s own price; paid in Checkout, the store is on the plan with its method saved', async () => {
    await connect(t.partnerA)
    const started = (await store(q.start, 'trialOwner', { p: plans.growth })).data?.['startPlanPayment'] as Checkout
    expect(started).toMatchObject({ keyId: keys.keyId, mode: 'test', upi: true, amount: { amount: '99900', currency: 'INR' } })
    expect(JSON.stringify(started)).not.toContain(keys.keySecret)
    expect(await storeStatus(t.storeA2)).toBe('trial')
    const answer = authorise(started.subscriptionId, { method: 'upi', vpa: 'jenna@okhdfc', card: null })
    const confirmed = await store(q.confirm, 'trialOwner', answer)
    expect(confirmed.data?.['confirmPlanPayment']).toMatchObject({ outcome: 'captured', subscription: { status: 'active', plan: { id: plans.growth }, upiAutoPay: 'je••••@okhdfc', card: null } })
    expect(await subRow(t.storeA2)).toMatchObject({ razorpay_subscription_id: started.subscriptionId, razorpay_customer_id: 'cust_T0OWNER1', period_start: clock })
    expect(await storeStatus(t.storeA2)).toBe('active')
    expect((await store(q.payments, 'trialOwner')).data?.['planPayments']).toEqual({ available: true, mode: 'test', subscribed: true })
    expect((await store(q.start, 'trialOwner', { p: plans.growth })).code).toBe('SAME_PLAN')
  })

  it('makes each plan and price on Razorpay once, and offers UPI only under ₹15,000', async () => {
    await connect(t.partnerA)
    await store(q.start, 'owner', { p: plans.growth })
    await store(q.start, 'trialOwner', { p: plans.growth })
    expect(rz.plans.size).toBe(1)
    expect(((await store(q.start, 'owner', { p: plans.big })).data?.['startPlanPayment'] as Checkout).upi).toBe(false)
  })

  it('takes a store its partner billed by hand to a paid plan as a first payment, from today, even a cheaper one', async () => {
    await connect(t.partnerA)
    await subscribe(t.storeA1, t.partnerA, plans.big, 'active', 2_000_000, new Date('2026-11-01T00:00:00Z'), new Date('2026-12-01T00:00:00Z'))
    const started = (await store(q.start, 'owner', { p: plans.growth })).data?.['startPlanPayment'] as Checkout
    expect(started.amount.amount).toBe('99900')
    await store(q.confirm, 'owner', authorise(started.subscriptionId))
    expect(await subRow(t.storeA1)).toMatchObject({ plan_id: plans.growth, period_start: clock, razorpay_subscription_id: started.subscriptionId })
  })

  it('settles a payment whose Checkout answer never arrived from Razorpay’s webhook, read back the same way', async () => {
    await connect(t.partnerA)
    const started = (await store(q.start, 'owner', { p: plans.growth })).data?.['startPlanPayment'] as Checkout
    authorise(started.subscriptionId)
    const hook = webhook(started.subscriptionId)
    expect(await settleFromRazorpayWebhook(deps(), t.partnerA, hook.body, hook.signature)).toBe('settled')
    expect(await subRow(t.storeA1)).toMatchObject({ plan_id: plans.growth, razorpay_subscription_id: started.subscriptionId })
    expect(await storeStatus(t.storeA1)).toBe('active')
  })

  it('takes one billing change at a time: a confirm while another change holds the store is refused, and saves nothing', async () => {
    await connect(t.partnerA)
    const started = (await store(q.start, 'owner', { p: plans.growth })).data?.['startPlanPayment'] as Checkout
    const answer = authorise(started.subscriptionId)
    await db.sql`update store_subscription set billing_claim = gen_random_uuid(), billing_claim_until = ${new Date(clock.getTime() + 60_000)} where store_id = ${t.storeA1}`
    expect((await store(q.confirm, 'owner', answer)).code).toBe('CHANGE_IN_PROGRESS')
    expect((await subRow(t.storeA1))?.razorpay_subscription_id).toBeNull()
    await db.sql`update store_subscription set billing_claim = null, billing_claim_until = null where store_id = ${t.storeA1}`
    expect((await store(q.confirm, 'owner', answer)).data?.['confirmPlanPayment']).toMatchObject({ outcome: 'captured' })
  })

  it('takes nothing the browser claims: a wrong signature, or another store’s subscription, saves nothing', async () => {
    await connect(t.partnerA)
    const started = (await store(q.start, 'owner', { p: plans.growth })).data?.['startPlanPayment'] as Checkout
    const answer = authorise(started.subscriptionId)
    expect((await store(q.confirm, 'owner', { ...answer, g: 'f'.repeat(64) })).code).toBe('PAYMENT_FAILED')
    expect((await store(q.confirm, 'trialOwner', answer)).code).toBe('NOT_FOUND')
    expect((await subRow(t.storeA1))?.razorpay_subscription_id).toBeNull()
    expect(await storeStatus(t.storeA1)).toBe('trial')
  })
})

describe('following Razorpay', () => {
  it('moves the period on when Razorpay renews, once however often it is told, by webhook or the hourly backstop', async () => {
    await connect(t.partnerA)
    const subscriptionId = await subscribeVia('owner', plans.growth)
    const before = await entries(t.storeA1, 'billing.renewed')
    const next = { start: new Date('2026-12-10T00:00:00Z'), end: new Date('2027-01-10T00:00:00Z') }
    renew(subscriptionId, next.start, next.end)
    const hook = webhook(subscriptionId)
    expect(await settleFromRazorpayWebhook(deps(), t.partnerA, hook.body, hook.signature)).toBe('settled')
    expect(await settleFromRazorpayWebhook(deps(), t.partnerA, hook.body, hook.signature)).toBe('settled')
    expect(await subRow(t.storeA1)).toMatchObject({ status: 'active', period_start: next.start, period_end: next.end })
    expect(await entries(t.storeA1, 'billing.renewed')).toBe(before + 1)
    // A webhook that never came: the hourly run reads the store back once its period has ended.
    clock = new Date('2027-01-10T01:00:00Z')
    renew(subscriptionId, new Date('2027-01-10T00:00:00Z'), new Date('2027-02-10T00:00:00Z'))
    expect(await followEndedSubscriptions(deps())).toBe(1)
    expect((await subRow(t.storeA1))?.period_end).toEqual(new Date('2027-02-10T00:00:00Z'))
  })

  it('makes the store past due while Razorpay retries a failed renewal, and active again once it is paid', async () => {
    await connect(t.partnerA)
    const subscriptionId = await subscribeVia('owner', plans.growth)
    subOf(subscriptionId).status = 'pending'
    const hook = webhook(subscriptionId)
    await settleFromRazorpayWebhook(deps(), t.partnerA, hook.body, hook.signature)
    expect(await storeStatus(t.storeA1)).toBe('past_due')
    renew(subscriptionId, new Date('2026-12-10T00:00:00Z'), new Date('2027-01-10T00:00:00Z'))
    await settleFromRazorpayWebhook(deps(), t.partnerA, hook.body, hook.signature)
    expect(await storeStatus(t.storeA1)).toBe('active')
  })

  it('answers a signed webhook for a subscription Razorpay refuses with 200, so Razorpay stops sending it', async () => {
    await connect(t.partnerA)
    const hook = webhook('sub_T0UNKNOWN')
    const request = new Request(`https://hooks.example/razorpay/partner/${t.partnerA}`, { method: 'POST', body: hook.body, headers: { 'x-razorpay-signature': hook.signature } })
    expect((await handleRazorpayBillingHook(request, { partnerId: t.partnerA }, deps(), async () => true)).status).toBe(200)
  })

  it('settles a webhook only when the partner’s own secret signed it, and never another partner’s store', async () => {
    await connect(t.partnerA)
    const subscriptionId = await subscribeVia('owner', plans.growth)
    const forged = webhook(subscriptionId, 'not-the-secret')
    expect(await settleFromRazorpayWebhook(deps(), t.partnerA, forged.body, forged.signature)).toBe('invalid')
    const hook = webhook(subscriptionId)
    expect(await settleFromRazorpayWebhook(deps(), t.partnerB, hook.body, hook.signature)).toBe('invalid')
    expect((await store(q.payments, 'otherOwner')).data?.['planPayments']).toEqual({ available: false, mode: null, subscribed: false })
  })
})

describe('changes on a running subscription', () => {
  // Razorpay changes no plan on a card mandate, so each change is a new subscription from the period's end, approved in Checkout.
  it('upgrades now: today’s prorated part is an add-on, the store is on the new plan at once, and the old subscription ends', async () => {
    await connect(t.partnerA)
    const old = await subscribeVia('owner', plans.growth)
    const { period_start, period_end } = (await subRow(t.storeA1)) ?? { period_start: clock, period_end: clock }
    expect((await store(q.change, 'owner', { p: plans.big, w: 'NOW' })).code).toBe('NO_CARD')
    const started = (await store(q.start, 'owner', { p: plans.big, w: 'NOW' })).data?.['startPlanPayment'] as Checkout
    const today = Number(started.amount.amount)
    expect(today).toBeGreaterThan(0)
    expect(today).toBeLessThan(2_000_000)
    expect(rz.addons.get(started.subscriptionId)).toBe(today)
    expect(subOf(started.subscriptionId).start_at).toBe(seconds(period_end))
    // Nothing changes until Checkout's answer is confirmed.
    expect((await subRow(t.storeA1))?.plan_id).toBe(plans.growth)
    const answer = authorise(started.subscriptionId)
    expect((await store(q.confirm, 'owner', answer)).data?.['confirmPlanPayment']).toMatchObject({ subscription: { plan: { id: plans.big } } })
    expect(await subRow(t.storeA1)).toMatchObject({ plan_id: plans.big, period_start, period_end, razorpay_subscription_id: started.subscriptionId })
    expect(rz.calls).toContain(`cancel_now:${old}`)
    // The old subscription's end is not the store's: it stays active.
    const hook = webhook(old)
    expect(await settleFromRazorpayWebhook(deps(), t.partnerA, hook.body, hook.signature)).toBe('ignored')
    expect(await storeStatus(t.storeA1)).toBe('active')
  })

  it('downgrades at the period’s end: only authorised today, scheduled, and taken when the new subscription first charges', async () => {
    await connect(t.partnerA)
    const old = await subscribeVia('owner', plans.big)
    const started = (await store(q.start, 'owner', { p: plans.growth, w: 'PERIOD_END' })).data?.['startPlanPayment'] as Checkout
    expect(started.amount.amount).toBe('0')
    expect(rz.addons.has(started.subscriptionId)).toBe(false)
    await store(q.confirm, 'owner', authorise(started.subscriptionId))
    expect(await subRow(t.storeA1)).toMatchObject({ plan_id: plans.big, next_plan_id: plans.growth, razorpay_subscription_id: started.subscriptionId })
    expect(rz.calls).toContain(`cancel_now:${old}`)
    const end = (await subRow(t.storeA1))?.period_end ?? clock
    renew(started.subscriptionId, end, new Date(end.getTime() + 31 * day))
    const hook = webhook(started.subscriptionId)
    await settleFromRazorpayWebhook(deps(), t.partnerA, hook.body, hook.signature)
    expect(await subRow(t.storeA1)).toMatchObject({ plan_id: plans.growth, next_plan_id: null, period_start: end })
  })

  it('keeps the plan after a scheduled downgrade with another subscription on it, ending the downgrade’s', async () => {
    await connect(t.partnerA)
    await subscribeVia('owner', plans.big)
    const down = await subscribeVia('owner', plans.growth, 'PERIOD_END')
    const keep = await subscribeVia('owner', plans.big, 'NOW')
    expect(subOf(keep).start_at).toBe(subOf(down).start_at)
    expect(await subRow(t.storeA1)).toMatchObject({ plan_id: plans.big, next_plan_id: null, razorpay_subscription_id: keep })
    expect(rz.calls).toContain(`cancel_now:${down}`)
  })

  it('moves to a free plan at the period’s end by ending the subscription with it; a paid plan after is a first payment', async () => {
    await connect(t.partnerA)
    const subscriptionId = await subscribeVia('owner', plans.growth)
    expect((await store(q.change, 'owner', { p: plans.free, w: 'PERIOD_END' })).data?.['changePlan']).toMatchObject({ scheduled: { plan: { id: plans.free } } })
    expect(rz.calls).toContain(`cancel_at_cycle_end:${subscriptionId}`)
    const end = (await subRow(t.storeA1))?.period_end ?? clock
    clock = new Date(end.getTime() + 60_000)
    subOf(subscriptionId).status = 'cancelled'
    expect(await followEndedSubscriptions(deps())).toBe(1)
    expect(await subRow(t.storeA1)).toMatchObject({ plan_id: plans.free, razorpay_subscription_id: null })
    expect(await storeStatus(t.storeA1)).toBe('active')
  })

  it('never applies a paid plan for nothing: a scheduled downgrade whose subscriptions both ended makes the store past due', async () => {
    await connect(t.partnerA)
    await subscribeVia('owner', plans.big)
    const down = await subscribeVia('owner', plans.growth, 'PERIOD_END')
    const end = (await subRow(t.storeA1))?.period_end ?? clock
    clock = new Date(end.getTime() + 60_000)
    subOf(down).status = 'cancelled'
    const hook = webhook(down)
    await settleFromRazorpayWebhook(deps(), t.partnerA, hook.body, hook.signature)
    expect(await subRow(t.storeA1)).toMatchObject({ plan_id: plans.big, razorpay_subscription_id: down })
    expect(await storeStatus(t.storeA1)).toBe('past_due')
  })

  it('cancels the subscription at the cycle’s end when the store closes', async () => {
    await connect(t.partnerA)
    const subscriptionId = await subscribeVia('owner', plans.growth)
    await store(q.close, 'owner')
    expect(rz.calls).toContain(`cancel_at_cycle_end:${subscriptionId}`)
    expect((await subRow(t.storeA1))?.cancel_at).toEqual(new Date(clock.getTime() + 30 * day))
  })
})

describe('the reminder a day before', () => {
  it('emails the amount, plan, date and method once for the period, and nothing for a period ending sooner', async () => {
    await connect(t.partnerA)
    await subscribeVia('owner', plans.growth)
    const end = (await subRow(t.storeA1))?.period_end ?? clock
    clock = new Date(end.getTime() - 1.5 * day)
    expect(await queueRenewalReminders(db.sql, clock)).toBe(1)
    expect(await queueRenewalReminders(db.sql, clock)).toBe(1)
    const sent = await db.sql<{ payload: Record<string, unknown> }[]>`select payload from outbox where kind = 'email' and store_id = ${t.storeA1} and payload->>'template' = 'plan-renewal-reminder'`
    expect(sent).toHaveLength(1)
    expect(sent[0]?.payload).toMatchObject({ amount: '99900', currency: 'INR', plan: 'Growth', method: { kind: 'card', brand: 'visa', last4: '1111' }, at: end.toISOString() })
    clock = new Date(end.getTime() - 0.5 * day)
    expect(await queueRenewalReminders(db.sql, clock)).toBe(0)
  })
})
