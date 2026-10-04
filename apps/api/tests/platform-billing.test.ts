import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { handleStripeHook } from '#hooks/stripe'
import { signPayload, StripeRefused, StripeUnavailable, type StripeAccount, type StripeApi, type StripeCharge, type StripeInvoice, type StripePayout, type StripeRefund } from '#integrations/stripe/index'
import { activityLog } from '#saas/activity/index'
import { createPartnerBillingService, retryAttempts } from '#saas/billing/index'
import { createPartnerConsoleService } from '#saas/partnerConsole/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #201: billing on the Platform API with Stripe answered in memory (THIRD-PARTY-ACCESS §2.7:
// no account yet). The webhook is driven through its real handler with signed bodies.

let db: TestDatabase
const start = new Date('2026-10-04T09:00:00Z')
let clock = start
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }
const signingSecret = 'whsec_testsecret'
const ids = { ns: '', bz: '', store: '', bzStore: '' }
const unix = (d: Date) => Math.floor(d.getTime() / 1000)
const cardNumber = '4242424242424242'

// Stripe as it is now: the webhook reads these back, whatever the event said.
const now = { invoices: new Map<string, StripeInvoice>(), charges: new Map<string, StripeCharge>(), refunds: new Map<string, StripeRefund[]>(), payouts: new Map<string, StripePayout>(), accounts: new Map<string, StripeAccount>() }
let down = false
const got = <T>(map: Map<string, T>, id: string): T => {
  if (down) throw new StripeUnavailable('test: down')
  const found = map.get(id)
  if (!found) throw new StripeRefused('resource_missing')
  return found
}
const bankStatus: 'new' | 'verified' | 'verification_failed' = 'new'
const stripe: StripeApi = {
  createAccount: async () => ({ id: 'acct_northstar' }),
  addBankAccount: async (_account, token) => {
    if (token === 'btok_refused') throw new StripeRefused('account_number_invalid')
    return { id: 'ba_1', bank_name: 'Chase', last4: '1180', status: bankStatus }
  },
  createCustomer: async () => ({ id: 'cus_northstar' }),
  attachCard: async (_customer, pm) => ({ id: pm, card: { brand: 'visa', last4: '3009', exp_month: 12, exp_year: 2028 } }),
  charge: async (id) => got(now.charges, id),
  refunds: async (id) => got(now.refunds, id),
  invoice: async (id) => got(now.invoices, id),
  payout: async (_account, id) => got(now.payouts, id),
  account: async (id) => got(now.accounts, id),
}

const callerOf = (partnerId: string, role: PartnerRole, staff: PartnerCaller['staff'] = null): PartnerCaller => ({
  role,
  user: { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example' },
  staff,
  partner: { id: partnerId, name: partnerId === ids.ns ? 'Northstar Commerce' : 'Bazaar Cloud', product: 'Shops', host: null, state: 'live' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}, connected = true) => {
  const deps = { sql: db.sql, caller, facts, activity: activityLog, now: () => clock }
  const contextValue = { caller, console: createPartnerConsoleService(deps), billing: createPartnerBillingService({ ...deps, stripe: connected ? stripe : null }) }
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const deliver = async (event: { id: string; type: string; account?: string; object: { id: string; object: string; customer?: string } }, secret = signingSecret) => {
  const body = JSON.stringify({ id: event.id, type: event.type, account: event.account ?? null, data: { object: event.object } })
  const t = unix(clock)
  const request = new Request('https://hooks.test/stripe', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${await signPayload(secret, t, body)}` } })
  return (await handleStripeHook(request, { sql: db.sql, stripe, signingSecret, now: () => clock })).status
}

const q = {
  payments: `{ merchantPayments { failedMore failed { id storeId storeName amount { amount currency } why cardLast4 retryAt attempt attempts } items { id storeId status kind amount { amount currency } note } pageInfo { hasNextPage } } }`,
  badges: `{ navBadges { billingFailedPayments } }`,
  payouts: `{ payouts { items { month collected { amount } fee { amount } adjustment { amount { amount } } payout { amount currency } status toLast4 } } }`,
  next: `{ nextPayout { state date soFar { amount currency } toLast4 } }`,
  settings: `{ billingSettings { mode asOf staleSince payoutAccount { bank last4 status } } }`,
  account: `{ payoutAccount { bank last4 status failure } }`,
  card: `{ paymentMethod { brand last4 expires status } }`,
  invoices: `{ partnerInvoices { items { id number what amount { amount currency } status } } }`,
  download: `query($id: ID!) { downloadInvoice(id: $id) { ok reason url } }`,
  mode: `mutation($m: String!) { setBillingMode(mode: $m) { ok reason } }`,
  payout: `mutation($t: String!) { setPayoutAccount(token: $t) { ok reason } }`,
  pay: `mutation($t: String!) { setPaymentMethod(token: $t) { ok reason } }`,
}

type Payments = { merchantPayments: { failed: { storeId: string; why: string | null; cardLast4: string | null; retryAt: string | null; attempt: number; attempts: number; amount: { amount: number } }[]; items: { storeId: string; status: string; kind: string; amount: { amount: number } }[] } }

const merchantInvoice = (o: Partial<StripeInvoice> & { id: string }): StripeInvoice => ({
  number: null,
  customer: 'cus_store1',
  status: 'open',
  billing_reason: 'subscription_cycle',
  description: null,
  amount_due: 4900,
  amount_paid: 0,
  currency: 'usd',
  attempt_count: 1,
  next_payment_attempt: unix(new Date(start.getTime() + 3 * 86_400_000)),
  application_fee_amount: 490,
  created: unix(start),
  due_date: null,
  status_transitions: null,
  invoice_pdf: null,
  metadata: {},
  subscription_details: { metadata: { store_id: ids.store } },
  lines: null,
  charge: { id: 'ch_fail1', amount: 4900, currency: 'usd', failure_message: 'Your card was declined.', payment_method_details: { card: { last4: '1881' } }, transfer: null, amount_refunded: 0, invoice: o.id },
  ...o,
})

const chargeRows = (ref: string) => db.sql<{ status: string; amount: string; payout_gross: string; fee_amount: string; partner_amount: string; retry_at: Date | null; kind: string }[]>`select status, amount::text, payout_gross::text, fee_amount::text, partner_amount::text, retry_at, kind from merchant_charge where stripe_ref = ${ref}`

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, start)
  ids.ns = (await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`)[0]?.id ?? ''
  ids.bz = (await db.sql<{ id: string }[]>`select id from partner where name = 'Bazaar Cloud'`)[0]?.id ?? ''
  ids.store = (await db.sql<{ id: string }[]>`select s.id from store s join store_subscription x on x.store_id = s.id where s.partner_id = ${ids.ns} order by s.name limit 1`)[0]?.id ?? ''
  ids.bzStore = (await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.bz} order by name limit 1`)[0]?.id ?? ''
  await db.sql`update store_subscription set stripe_customer_id = 'cus_store1' where store_id = ${ids.store}`
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the Stripe webhook', () => {
  it('refuses a body whose signature is wrong, and records nothing', async () => {
    now.invoices.set('in_fail1', merchantInvoice({ id: 'in_fail1' }))
    expect(await deliver({ id: 'evt_bad', type: 'invoice.payment_failed', object: { id: 'in_fail1', object: 'invoice' } }, 'whsec_wrong')).toBe(400)
    expect(await db.sql`select 1 from billing_event where id = 'evt_bad'`).toHaveLength(0)
  })

  it("shows a failed merchant payment with Billing's retry, and counts it on the Billing badge", async () => {
    expect(await deliver({ id: 'evt_fail1', type: 'invoice.payment_failed', object: { id: 'in_fail1', object: 'invoice' } })).toBe(200)
    const owner = callerOf(ids.ns, 'partner-owner')
    const { failed } = (await run<Payments>(q.payments, owner)).data?.merchantPayments ?? { failed: [] }
    expect(failed).toEqual([expect.objectContaining({ storeId: ids.store, why: 'Your card was declined.', cardLast4: '1881', attempt: 1, attempts: retryAttempts, amount: { amount: 4900, currency: 'USD' } })])
    expect((await run<{ navBadges: { billingFailedPayments: number } }>(q.badges, owner)).data?.navBadges.billingFailedPayments).toBe(1)
  })

  it('changes nothing twice for a replayed event, even when Stripe has moved on since', async () => {
    now.invoices.set('in_fail1', merchantInvoice({ id: 'in_fail1', status: 'paid', amount_paid: 4900, attempt_count: 2, next_payment_attempt: null }))
    expect(await deliver({ id: 'evt_fail1', type: 'invoice.payment_failed', object: { id: 'in_fail1', object: 'invoice' } })).toBe(200)
    expect((await chargeRows('in_fail1')).map((r) => r.status)).toEqual(['failed'])
    expect(await db.sql`select 1 from billing_event where id = 'evt_fail1'`).toHaveLength(1)
  })

  it('reads Stripe as it is now, so an old event arriving late undoes nothing', async () => {
    now.invoices.set(
      'in_fail1',
      merchantInvoice({
        id: 'in_fail1',
        status: 'paid',
        amount_paid: 4900,
        attempt_count: 2,
        next_payment_attempt: null,
        status_transitions: { paid_at: unix(start), finalized_at: null },
        charge: { id: 'ch_ok1', amount: 4900, currency: 'usd', failure_message: null, payment_method_details: { card: { last4: '1881' } }, transfer: { amount: 4410, currency: 'usd' }, amount_refunded: 0, invoice: 'in_fail1' },
      }),
    )
    expect(await deliver({ id: 'evt_paid1', type: 'invoice.paid', object: { id: 'in_fail1', object: 'invoice' } })).toBe(200)
    // The failure Stripe sent before the payment, delivered after it.
    expect(await deliver({ id: 'evt_fail1late', type: 'invoice.payment_failed', object: { id: 'in_fail1', object: 'invoice' } })).toBe(200)
    expect(await chargeRows('in_fail1')).toEqual([{ status: 'recovered', amount: '4900', payout_gross: '4900', fee_amount: '490', partner_amount: '4410', retry_at: null, kind: 'subscription' }])
    expect((await run<Payments>(q.payments, callerOf(ids.ns, 'partner-owner'))).data?.merchantPayments.failed).toEqual([])
  })

  it('never takes a paid payment back to failed, whichever read commits last', async () => {
    const paid = now.invoices.get('in_fail1')
    if (!paid) throw new Error('setup')
    // A read made before the payment, landing after it: Stripe's paid is final, so it is ignored.
    now.invoices.set('in_fail1', merchantInvoice({ id: 'in_fail1' }))
    expect(await deliver({ id: 'evt_stale1', type: 'invoice.payment_failed', object: { id: 'in_fail1', object: 'invoice' } })).toBe(200)
    expect((await chargeRows('in_fail1')).map((r) => r.status)).toEqual(['recovered'])
    now.invoices.set('in_fail1', paid)
  })

  it("never takes Billing's attempt count back, whichever failed read commits last", async () => {
    const third = merchantInvoice({ id: 'in_fail2', attempt_count: 3, next_payment_attempt: unix(new Date(start.getTime() + 5 * 86_400_000)) })
    now.invoices.set('in_fail2', third)
    expect(await deliver({ id: 'evt_f2a3', type: 'invoice.payment_failed', object: { id: 'in_fail2', object: 'invoice' } })).toBe(200)
    now.invoices.set('in_fail2', merchantInvoice({ id: 'in_fail2', attempt_count: 2 }))
    expect(await deliver({ id: 'evt_f2a2', type: 'invoice.payment_failed', object: { id: 'in_fail2', object: 'invoice' } })).toBe(200)
    expect((await db.sql<{ attempt: number }[]>`select attempt from merchant_charge where stripe_ref = 'in_fail2'`)[0]?.attempt).toBe(3)
    now.invoices.set('in_fail2', { ...third, status: 'void', next_payment_attempt: null })
    expect(await deliver({ id: 'evt_f2void', type: 'invoice.voided', object: { id: 'in_fail2', object: 'invoice' } })).toBe(200)
  })

  it('records a refund as its own row, its payout share in proportion', async () => {
    const paid = now.invoices.get('in_fail1')
    const charge = paid?.charge && typeof paid.charge === 'object' ? paid.charge : null
    if (!paid || !charge) throw new Error('setup')
    const refunded = { ...charge, amount_refunded: 980 }
    now.charges.set('ch_ok1', refunded)
    now.refunds.set('ch_ok1', [{ id: 're_1', amount: 980, status: 'succeeded', created: unix(start) }])
    now.invoices.set('in_fail1', { ...paid, charge: refunded })
    expect(await deliver({ id: 'evt_refund1', type: 'charge.refunded', object: { id: 'ch_ok1', object: 'charge' } })).toBe(200)
    expect(await chargeRows('re_1')).toEqual([expect.objectContaining({ kind: 'refund', status: 'refunded', amount: '980', payout_gross: '980', fee_amount: '98' })])
  })

  it('answers 503 and records nothing while Stripe is slow, and says since when', async () => {
    await db.sql`insert into partner_billing_account (partner_id, stripe_account_id) values (${ids.ns}, 'acct_northstar')`
    now.payouts.set('po_1', { id: 'po_1', amount: 250_000, currency: 'usd', arrival_date: unix(new Date('2026-10-01T00:00:00Z')), status: 'paid', failure_message: null, destination: { last4: '1180' } })
    down = true
    clock = new Date(start.getTime() + 60_000)
    expect(await deliver({ id: 'evt_po1', type: 'payout.paid', account: 'acct_northstar', object: { id: 'po_1', object: 'payout' } })).toBe(503)
    expect(await db.sql`select 1 from billing_event where id = 'evt_po1'`).toHaveLength(0)
    const owner = callerOf(ids.ns, 'partner-owner')
    expect((await run<{ billingSettings: { staleSince: string | null } }>(q.settings, owner)).data?.billingSettings.staleSince).toBe(clock.toISOString())

    down = false
    clock = new Date(start.getTime() + 120_000)
    expect(await deliver({ id: 'evt_po1', type: 'payout.paid', account: 'acct_northstar', object: { id: 'po_1', object: 'payout' } })).toBe(200)
    expect((await run<{ billingSettings: { staleSince: string | null; asOf: string | null } }>(q.settings, owner)).data?.billingSettings).toMatchObject({ staleSince: null, asOf: clock.toISOString() })
    const payouts = (await run<{ payouts: { items: { month: string; status: string; payout: { amount: number }; toLast4: string | null; collected: { amount: number }; fee: { amount: number }; adjustment: { amount: { amount: number } } | null }[] } }>(q.payouts, owner)).data?.payouts.items ?? []
    const september = payouts.find((p) => p.month === '2026-09' && p.payout.amount === 250_000)
    expect(september).toMatchObject({ status: 'paid', payout: { amount: 250_000 }, toLast4: '1180' })
    // Whatever the month's charges don't explain is the adjustment, so the row always adds up.
    expect((september?.collected.amount ?? 0) - (september?.fee.amount ?? 0) + (september?.adjustment?.amount.amount ?? 0)).toBe(250_000)
  })
  it('marks the feed stale for a merchant invoice too, found by its customer', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    down = true
    clock = new Date(start.getTime() + 150_000)
    expect(await deliver({ id: 'evt_slowinv', type: 'invoice.payment_failed', object: { id: 'in_fail1', object: 'invoice', customer: 'cus_store1' } })).toBe(503)
    expect((await run<{ billingSettings: { staleSince: string | null } }>(q.settings, owner)).data?.billingSettings.staleSince).toBe(clock.toISOString())
    down = false
    expect(await deliver({ id: 'evt_slowinv', type: 'invoice.payment_failed', object: { id: 'in_fail1', object: 'invoice', customer: 'cus_store1' } })).toBe(200)
    expect((await run<{ billingSettings: { staleSince: string | null } }>(q.settings, owner)).data?.billingSettings.staleSince).toBeNull()
  })

  it('keeps two payouts in one month apart, each as Stripe made it', async () => {
    const arrival = unix(new Date('2026-10-02T00:00:00Z'))
    now.payouts.set('po_2', { id: 'po_2', amount: 1_000, currency: 'usd', arrival_date: arrival, status: 'failed', failure_message: 'Account closed', destination: { last4: '1180' } })
    now.payouts.set('po_3', { id: 'po_3', amount: 1_000, currency: 'usd', arrival_date: arrival, status: 'paid', failure_message: null, destination: { last4: '1180' } })
    expect(await deliver({ id: 'evt_po2', type: 'payout.failed', account: 'acct_northstar', object: { id: 'po_2', object: 'payout' } })).toBe(200)
    expect(await deliver({ id: 'evt_po3', type: 'payout.paid', account: 'acct_northstar', object: { id: 'po_3', object: 'payout' } })).toBe(200)
    expect(await db.sql`select stripe_payout_id, status, amount::text from partner_payout where stripe_payout_id in ('po_2', 'po_3') order by stripe_payout_id`).toEqual([
      { stripe_payout_id: 'po_2', status: 'failed', amount: '1000' },
      { stripe_payout_id: 'po_3', status: 'paid', amount: '1000' },
    ])
    // September's charges are counted once: po_1 carries them, the failed po_2 and the later po_3 carry none.
    const carried = await db.sql<{ stripe_payout_id: string; gross: string; stores: number }[]>`select stripe_payout_id, gross::text, stores from partner_payout where stripe_payout_id is not null order by stripe_payout_id`
    expect(carried.find((r) => r.stripe_payout_id === 'po_1')?.gross).not.toBe('0')
    expect(carried.filter((r) => r.stripe_payout_id !== 'po_1')).toEqual([
      { stripe_payout_id: 'po_2', gross: '0', stores: 0 },
      { stripe_payout_id: 'po_3', gross: '0', stores: 0 },
    ])
  })

  it('never records money in a currency the contract does not pay out in as handled', async () => {
    now.payouts.set('po_eur', { id: 'po_eur', amount: 5_000, currency: 'eur', arrival_date: unix(new Date('2026-10-03T00:00:00Z')), status: 'paid', failure_message: null, destination: null })
    expect(await deliver({ id: 'evt_eur', type: 'payout.paid', account: 'acct_northstar', object: { id: 'po_eur', object: 'payout' } })).toBe(200)
    expect(await db.sql`select 1 from billing_event where id = 'evt_eur'`).toHaveLength(0)
    expect(await db.sql`select 1 from partner_payout where stripe_payout_id = 'po_eur'`).toHaveLength(0)
  })

  it("doesn't keep an event it can't place yet, so a later delivery is handled", async () => {
    now.accounts.set('acct_later', { id: 'acct_later', external_accounts: { data: [{ id: 'ba_9', bank_name: 'Chase', last4: '7777', status: 'verified' }] } })
    expect(await deliver({ id: 'evt_early', type: 'account.updated', account: 'acct_later', object: { id: 'acct_later', object: 'account' } })).toBe(200)
    expect(await db.sql`select 1 from billing_event where id = 'evt_early'`).toHaveLength(0)
    await db.sql`insert into partner_billing_account (partner_id, stripe_account_id) values (${ids.bz}, 'acct_later')`
    expect(await deliver({ id: 'evt_early', type: 'account.updated', account: 'acct_later', object: { id: 'acct_later', object: 'account' } })).toBe(200)
    expect((await db.sql<{ payout_status: string }[]>`select payout_status from partner_billing_account where partner_id = ${ids.bz}`)[0]?.payout_status).toBe('verified')
    await db.sql`delete from partner_billing_account where partner_id = ${ids.bz}`
  })
})

describe('payout account and card', () => {
  it('hold the next payout until there is an account to pay', async () => {
    expect((await run<{ nextPayout: { state: string } }>(q.next, callerOf(ids.ns, 'partner-owner'))).data?.nextPayout.state).toBe('heldNoAccount')
  })

  it('refuse Admin, Support and Read-only, and never a staff session', async () => {
    for (const role of ['partner-admin', 'partner-support', 'partner-read-only'] as const) {
      expect((await run(q.payout, callerOf(ids.ns, role), { t: 'btok_good123' })).code).toBe('FORBIDDEN')
      expect((await run(q.pay, callerOf(ids.ns, role), { t: 'pm_good1234' })).code).toBe('FORBIDDEN')
    }
    const impersonating = callerOf(ids.ns, 'partner-owner', { id: crypto.randomUUID(), name: 'Arjun', email: 'arjun@dripfunnel.com', session: { kind: 'impersonation', id: crypto.randomUUID(), expiresAt: new Date(start.getTime() + 1_800_000) } })
    expect((await run(q.pay, impersonating, { t: 'pm_good1234' })).code).toBe('BLOCKED_WHILE_IMPERSONATING')
    expect((await run(q.payout, { ...impersonating, user: null, staff: { ...(impersonating.staff ?? { id: '', name: '', email: '', expiresAt: start }), session: { kind: 'setup', id: crypto.randomUUID(), expiresAt: start } } }, { t: 'btok_good123' })).code).toBe('PARTNER_ENTERS_THIS_ITSELF')
  })

  it('refuse a card or account number, which then appears nowhere', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    expect((await run<{ setPaymentMethod: { reason: string } }>(q.pay, owner, { t: cardNumber })).data?.setPaymentMethod.reason).toBe('INVALID_INPUT')
    expect((await run<{ setPayoutAccount: { reason: string } }>(q.payout, owner, { t: '000123456789' })).data?.setPayoutAccount.reason).toBe('INVALID_INPUT')
    const leaks = await db.sql`
      select 1 from activity_log where coalesce(changes::text, '') like ${'%' + cardNumber + '%'} or coalesce(reason, '') like ${'%' + cardNumber + '%'}
      union all select 1 from partner_billing_account where coalesce(card_last4, '') || coalesce(payout_last4, '') like '%4242424242%'
    `
    expect(leaks).toHaveLength(0)
  })

  it('answer NOT_CONNECTED until the Stripe keys are Worker secrets', async () => {
    expect((await run<{ setPayoutAccount: { reason: string } }>(q.payout, callerOf(ids.ns, 'partner-finance'), { t: 'btok_good123' }, false)).data?.setPayoutAccount.reason).toBe('NOT_CONNECTED')
  })

  it('takes a bank token from Finance, shows the last four only, and follows the test deposit', async () => {
    const finance = callerOf(ids.ns, 'partner-finance')
    expect((await run<{ setPayoutAccount: { ok: boolean } }>(q.payout, finance, { t: 'btok_good123' })).data?.setPayoutAccount.ok).toBe(true)
    expect((await run<{ payoutAccount: unknown }>(q.account, finance)).data?.payoutAccount).toEqual({ bank: 'Chase', last4: '1180', status: 'verifying', failure: null })
    expect(await db.sql`select 1 from activity_log where action = 'partner.payout_account_set' and partner_id = ${ids.ns}`).toHaveLength(1)
    expect((await run<{ nextPayout: { state: string } }>(q.next, finance)).data?.nextPayout.state).toBe('heldVerifying')

    now.accounts.set('acct_northstar', { id: 'acct_northstar', external_accounts: { data: [{ id: 'ba_1', bank_name: 'Chase', last4: '1180', status: 'verification_failed' }] } })
    expect(await deliver({ id: 'evt_acct1', type: 'account.external_account.updated', account: 'acct_northstar', object: { id: 'ba_1', object: 'bank_account' } })).toBe(200)
    expect((await run<{ payoutAccount: { status: string } }>(q.account, finance)).data?.payoutAccount.status).toBe('failed')
    expect((await run<{ nextPayout: { state: string } }>(q.next, finance)).data?.nextPayout.state).toBe('heldVerification')
    expect(await db.sql`select 1 from outbox where partner_id = ${ids.ns} and payload->>'template' = 'partner-payout-account-failed'`).toHaveLength(1)

    now.accounts.set('acct_northstar', { id: 'acct_northstar', external_accounts: { data: [{ id: 'ba_1', bank_name: 'Chase', last4: '1180', status: 'verified' }] } })
    expect(await deliver({ id: 'evt_acct2', type: 'account.updated', account: 'acct_northstar', object: { id: 'acct_northstar', object: 'account' } })).toBe(200)
    expect((await run<{ nextPayout: unknown }>(q.next, finance)).data?.nextPayout).toEqual({ state: 'scheduled', date: '2026-11-01', soFar: expect.objectContaining({ currency: 'USD' }), toLast4: '1180' })
    // A read made before the test deposit landed, committing after it, leaves it verified.
    now.accounts.set('acct_northstar', { id: 'acct_northstar', external_accounts: { data: [{ id: 'ba_1', bank_name: 'Chase', last4: '1180', status: 'new' }] } })
    expect(await deliver({ id: 'evt_acct3', type: 'account.updated', account: 'acct_northstar', object: { id: 'acct_northstar', object: 'account' } })).toBe(200)
    expect((await run<{ payoutAccount: { status: string } }>(q.account, finance)).data?.payoutAccount.status).toBe('verified')
  })

  it("says why Stripe refused a token", async () => {
    expect((await run<{ setPayoutAccount: { reason: string } }>(q.payout, callerOf(ids.ns, 'partner-owner'), { t: 'btok_refused' })).data?.setPayoutAccount.reason).toBe('TOKEN_REFUSED')
  })

  it("keeps the card Stripe's hosted field made, and follows DripFunnel's invoices to the partner", async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    expect((await run<{ setPaymentMethod: { ok: boolean } }>(q.pay, owner, { t: 'pm_good1234' })).data?.setPaymentMethod.ok).toBe(true)
    expect((await run<{ paymentMethod: unknown }>(q.card, owner)).data?.paymentMethod).toEqual({ brand: 'visa', last4: '3009', expires: '2028-12', status: 'on_file' })

    const invoice: StripeInvoice = {
      ...merchantInvoice({ id: 'in_partner1' }),
      customer: 'cus_northstar',
      number: 'DF-0042',
      description: 'Priority support · September',
      amount_due: 19_900,
      attempt_count: 1,
      due_date: unix(new Date(start.getTime() - 86_400_000)),
      subscription_details: null,
      invoice_pdf: 'https://pay.stripe.com/invoice/acct_1/test_pdf',
      charge: null,
    }
    now.invoices.set('in_partner1', invoice)
    expect(await deliver({ id: 'evt_pinv1', type: 'invoice.payment_failed', object: { id: 'in_partner1', object: 'invoice' } })).toBe(200)
    const listed = (await run<{ partnerInvoices: { items: { id: string; number: string; what: string; status: string; amount: { amount: number } }[] } }>(q.invoices, owner)).data?.partnerInvoices.items ?? []
    expect(listed).toEqual([expect.objectContaining({ number: 'DF-0042', what: 'Priority support · September', status: 'overdue', amount: { amount: 19_900, currency: 'USD' } })])
    expect((await run<{ paymentMethod: { status: string } }>(q.card, owner)).data?.paymentMethod.status).toBe('declined')

    now.invoices.set('in_partner1', { ...invoice, status: 'paid', amount_paid: 19_900, status_transitions: { paid_at: unix(start), finalized_at: unix(start) } })
    expect(await deliver({ id: 'evt_pinv2', type: 'invoice.paid', object: { id: 'in_partner1', object: 'invoice' } })).toBe(200)
    expect((await run<{ paymentMethod: { status: string } }>(q.card, owner)).data?.paymentMethod.status).toBe('on_file')
    const id = listed[0]?.id ?? ''
    expect((await run<{ downloadInvoice: unknown }>(q.download, owner, { id })).data?.downloadInvoice).toEqual({ ok: true, reason: null, url: 'https://pay.stripe.com/invoice/acct_1/test_pdf' })
  })
})

describe('who bills, and one partner never another', () => {
  it('lets Owner and Finance choose who bills, audited, and drops the badge when the partner bills itself', async () => {
    expect((await run(q.mode, callerOf(ids.ns, 'partner-admin'), { m: 'own' })).code).toBe('FORBIDDEN')
    expect((await run(q.mode, callerOf(ids.ns, 'partner-read-only'), { m: 'own' })).code).toBe('FORBIDDEN')
    const finance = callerOf(ids.ns, 'partner-finance')
    expect((await run<{ setBillingMode: { reason: string } }>(q.mode, finance, { m: 'stripe' })).data?.setBillingMode.reason).toBe('INVALID_INPUT')
    expect((await run<{ setBillingMode: { ok: boolean } }>(q.mode, finance, { m: 'own' })).data?.setBillingMode.ok).toBe(true)
    expect((await run<{ billingSettings: { mode: string } }>(q.settings, finance)).data?.billingSettings.mode).toBe('own')
    expect(await db.sql`select 1 from activity_log where action = 'partner.billing_mode_set' and partner_id = ${ids.ns}`).toHaveLength(1)
    expect((await run<{ setBillingMode: { ok: boolean } }>(q.mode, finance, { m: 'dripfunnel' })).data?.setBillingMode.ok).toBe(true)
  })

  it("shows Bazaar Cloud none of Northstar's payments, payouts, invoices or account", async () => {
    const bazaar = callerOf(ids.bz, 'partner-owner')
    const payments = (await run<Payments>(q.payments, bazaar)).data?.merchantPayments
    const northstarStores = new Set((await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns}`).map((r) => r.id))
    expect(payments?.items.some((p) => northstarStores.has(p.storeId))).toBe(false)
    expect(payments?.failed).toEqual([])
    expect((await run<{ partnerInvoices: { items: unknown[] } }>(q.invoices, bazaar)).data?.partnerInvoices.items).toEqual([])
    expect((await run<{ payoutAccount: { last4: string | null } }>(q.account, bazaar)).data?.payoutAccount.last4).toBeNull()
    const northstarInvoice = (await db.sql<{ id: string }[]>`select id from partner_invoice where partner_id = ${ids.ns}`)[0]?.id ?? ''
    expect((await run<{ downloadInvoice: { reason: string } }>(q.download, bazaar, { id: northstarInvoice })).data?.downloadInvoice.reason).toBe('NOT_FOUND')
  })
})
