import type postgres from 'postgres'
import type { ActivityLog } from '#auth/activity'
import { logEvent } from '#core/log'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  insertBillingEvent,
  saveBillingAccount,
  selectBillingAccount,
  selectContractCurrency,
  selectPartnerByAccount,
  deleteBillingEvent,
  selectPartnerByCustomer,
  selectPartnerByStoreCustomer,
  selectPeriodCarried,
  selectPeriodTotals,
  selectStoreByCustomer,
  setEventPartner,
  touchBillingFeed,
  upsertCharge,
  upsertPartnerInvoice,
  upsertPayout,
} from '#db/scoped/partnerBilling'
import { upsertStoreInvoice, type InvoiceUpsert } from '#db/scoped/storeBilling'
import { StripeUnavailable, type StripeAccount, type StripeApi, type StripeCharge, type StripeEvent, type StripeInvoice, type StripePayout, type StripeRefund, type StripeSubscription } from '#integrations/stripe/index'
import { queueSideEffect } from '#saas/outbox/index'
import { applyStoreSubscription } from '#saas/storeBilling/index'
import { payoutStatusOf } from './partner'

// The Stripe webhook's work (SAAS §7.2; #201). Every event is answered by reading the object as
// Stripe has it now, so a replay changes nothing and an old event arriving late can't undo a
// newer one; the event id goes into billing_event in the same transaction as what it changed.

// Stripe delivers again only after a non-2xx answer. `mismatch` (money in a currency the partner's
// contract doesn't pay out in) is answered 503 and not kept, so it comes again once the contract is
// fixed, and marks the feed stale. `unplaced` (no partner holds its account, customer or store) is
// never ours: the partner's Stripe ids are committed before the calls that make Stripe send events
// about them (saas/billing/partner.ts), so retrying it would only risk Stripe disabling the endpoint.
// It and `ignored` (a kind of event nothing here reads) are answered 200.
export type EventOutcome = 'handled' | 'duplicate' | 'ignored' | 'unplaced' | 'mismatch'

/** What the hook answers 503 to, so Stripe delivers it again. */
export const retriedOutcomes: readonly EventOutcome[] = ['mismatch']

/** The partner an event was placed with, or why its money couldn't be. */
type Placed = { partnerId: string; mismatch: boolean } | null
const placed = (partnerId: string): Placed => ({ partnerId, mismatch: false })
const mismatched = (partnerId: string): Placed => ({ partnerId, mismatch: true })

/** What one event is about, read back from Stripe before anything is written. */
type Subject =
  | { kind: 'invoice'; invoice: StripeInvoice; refunds: StripeRefund[] }
  | { kind: 'charge'; invoice: StripeInvoice | null; refunds: StripeRefund[] }
  | { kind: 'payout'; accountId: string; payout: StripePayout }
  | { kind: 'account'; account: StripeAccount }
  | { kind: 'subscription'; subscription: StripeSubscription }
  | { kind: 'none' }

const seconds = (s: number) => new Date(s * 1000)
const upper = (c: string) => c.toUpperCase()

/** `value × part / total` in integers, rounded half up. */
const share = (value: number, part: number, total: number): number => (total === 0 ? 0 : Number((BigInt(value) * BigInt(part) * 2n + BigInt(total)) / (2n * BigInt(total))))

const chargeOf = (invoice: StripeInvoice): StripeCharge | null => (invoice.charge && typeof invoice.charge === 'object' ? invoice.charge : null)

/** The paying charge's refunds, read through Stripe's paged list, only when it has any. */
const refundsOf = async (stripe: StripeApi, invoice: StripeInvoice | null): Promise<StripeRefund[]> => {
  const charge = invoice ? chargeOf(invoice) : null
  return charge && (charge.amount_refunded ?? 0) > 0 ? stripe.refunds(charge.id) : []
}

const fetchSubject = async (stripe: StripeApi, event: StripeEvent): Promise<Subject> => {
  const object = event.data.object
  if (event.type.startsWith('invoice.')) {
    const invoice = await stripe.invoice(object.id)
    return { kind: 'invoice', invoice, refunds: await refundsOf(stripe, invoice) }
  }
  if (event.type.startsWith('charge.')) {
    const charge = await stripe.charge(object.id)
    const invoice = charge.invoice ? await stripe.invoice(charge.invoice) : null
    return { kind: 'charge', invoice, refunds: await refundsOf(stripe, invoice) }
  }
  // A store's plan (#329): its status and period, and a scheduled change taking effect.
  if (event.type.startsWith('customer.subscription.') && !event.account) return { kind: 'subscription', subscription: await stripe.subscription(object.id) }
  if (event.type.startsWith('payout.') && event.account) return { kind: 'payout', accountId: event.account, payout: await stripe.payout(event.account, object.id) }
  if (event.type.startsWith('account.')) {
    const accountId = event.account ?? (object.object === 'account' ? object.id : null)
    if (accountId) return { kind: 'account', account: await stripe.account(accountId) }
  }
  return { kind: 'none' }
}

// The merchant's own copy for its Billing screen (DATA-MODEL §7.9): Stripe's lines, a proration's credit below zero.
const storeInvoiceOf = (storeId: string, invoice: StripeInvoice, refunds: StripeRefund[]): InvoiceUpsert => {
  const refunded = refunds.filter((r) => r.status === 'succeeded').reduce((sum, r) => sum + r.amount, 0)
  const paidAt = invoice.status_transitions?.paid_at
  return {
    storeId,
    stripeInvoiceId: invoice.id,
    number: invoice.number ?? null,
    kind: invoice.billing_reason === 'subscription_update' ? 'proration' : 'subscription',
    status: invoice.status === 'paid' ? (invoice.amount_paid > 0 && refunded >= invoice.amount_paid ? 'refunded' : 'paid') : invoice.status === 'open' ? 'open' : 'void',
    amount: invoice.status === 'paid' ? invoice.amount_paid : invoice.amount_due,
    taxAmount: invoice.tax ?? 0,
    currency: upper(invoice.currency),
    issuedAt: seconds(invoice.status_transitions?.finalized_at ?? invoice.created),
    paidAt: paidAt ? seconds(paidAt) : null,
    lines: (invoice.lines?.data ?? []).slice(0, 20).map((l) => ({
      label: (l.description ?? '').slice(0, 300),
      amount: l.amount ?? 0,
      kind: l.proration ? ((l.amount ?? 0) < 0 ? 'proration_credit' : 'proration_charge') : 'plan',
      periodStart: l.period ? seconds(l.period.start) : null,
      periodEnd: l.period ? seconds(l.period.end) : null,
    })),
  }
}

const metadataOf = (invoice: StripeInvoice) => ({ ...(invoice.subscription_details?.metadata ?? {}), ...invoice.metadata })
// A merchant's subscription invoice is one merchant_charge row, whichever of its retries paid it.
const applyMerchantInvoice = async (tx: ScopedSql, invoice: StripeInvoice, refunds: StripeRefund[]): Promise<Placed> => {
  const storeId = metadataOf(invoice)['store_id']
  if (!storeId || !/^[0-9a-f-]{36}$/i.test(storeId)) return null
  const store = await selectStoreByCustomer(tx, storeId, invoice.customer)
  if (!store) return null
  if (invoice.status === 'draft' || (invoice.status === 'open' && invoice.attempt_count === 0)) return placed(store.partner_id)
  await upsertStoreInvoice(tx, storeInvoiceOf(store.store_id, invoice, refunds))
  const payoutCurrency = await selectContractCurrency(tx, store.partner_id)
  if (!payoutCurrency) return mismatched(store.partner_id)

  const charge = chargeOf(invoice)
  const paid = invoice.status === 'paid'
  const amount = paid ? invoice.amount_paid : invoice.amount_due
  const appFee = invoice.application_fee_amount ?? 0
  let gross = 0
  let fee = 0
  if (paid) {
    const transfer = charge?.transfer && typeof charge.transfer === 'object' ? charge.transfer : null
    if (transfer) {
      // Stripe converted the partner's part into the payout currency; DripFunnel's fee converts at the same rate.
      if (upper(transfer.currency) !== payoutCurrency) return mismatched(store.partner_id)
      fee = share(appFee, transfer.amount, Math.max(amount - appFee, 0))
      gross = transfer.amount + fee
    } else if (upper(invoice.currency) === payoutCurrency) {
      fee = appFee
      gross = amount
    } else return mismatched(store.partner_id)
  }

  await upsertCharge(tx, {
    stripeRef: invoice.id,
    partnerId: store.partner_id,
    storeId: store.store_id,
    kind: invoice.billing_reason === 'subscription_update' ? 'proration' : 'subscription',
    status: paid ? (invoice.attempt_count > 1 ? 'recovered' : 'paid') : 'failed',
    amount,
    currency: upper(invoice.currency),
    payoutCurrency,
    payoutGross: gross,
    fee,
    cardLast4: charge?.payment_method_details?.card?.last4 ?? null,
    failureReason: paid ? null : (charge?.failure_message ?? null),
    invoiceId: invoice.id,
    // Billing stops retrying an uncollectible or void invoice; an open one says when it tries next.
    retryAt: !paid && invoice.status === 'open' && invoice.next_payment_attempt ? seconds(invoice.next_payment_attempt) : null,
    // Kept once retries stop too, so an older read can't take the count back (db/scoped/partnerBilling).
    attempt: paid ? null : Math.max(invoice.attempt_count, 1),
    chargedAt: seconds(invoice.status_transitions?.paid_at ?? invoice.created),
  })

  // Each refund its own row, its payout part in proportion (migration 0019: refunds subtract).
  for (const refund of refunds) {
    if (refund.status !== 'succeeded') continue
    await upsertCharge(tx, {
      stripeRef: refund.id,
      partnerId: store.partner_id,
      storeId: store.store_id,
      kind: 'refund',
      status: 'refunded',
      amount: refund.amount,
      currency: upper(invoice.currency),
      payoutCurrency,
      payoutGross: share(gross, refund.amount, amount),
      fee: share(fee, refund.amount, amount),
      cardLast4: null,
      failureReason: null,
      invoiceId: invoice.id,
      retryAt: null,
      attempt: null,
      chargedAt: seconds(refund.created),
    })
  }
  return placed(store.partner_id)
}

// DripFunnel's invoice to the partner (§11.3), and what its payment says about the card.
const applyPartnerInvoice = async (tx: ScopedSql, invoice: StripeInvoice, type: string, at: Date): Promise<Placed> => {
  const partnerId = await selectPartnerByCustomer(tx, invoice.customer)
  if (!partnerId) return null
  if (invoice.status !== 'draft') {
    await upsertPartnerInvoice(tx, {
      partnerId,
      stripeInvoiceId: invoice.id,
      number: invoice.number ?? null,
      what: (invoice.description ?? invoice.lines?.data[0]?.description ?? 'DripFunnel invoice').slice(0, 300),
      amount: invoice.amount_due,
      currency: upper(invoice.currency),
      status: invoice.status === 'paid' ? 'paid' : invoice.status === 'void' ? 'void' : 'open',
      issuedAt: seconds(invoice.status_transitions?.finalized_at ?? invoice.created),
      dueAt: invoice.due_date ? seconds(invoice.due_date) : null,
      paidAt: invoice.status_transitions?.paid_at ? seconds(invoice.status_transitions.paid_at) : null,
    })
  }
  const account = await selectBillingAccount(tx, partnerId)
  if (account?.card_status === 'on_file' && type === 'invoice.payment_failed' && invoice.status === 'open') {
    await saveBillingAccount(tx, partnerId, { card_status: 'declined' }, at)
    await queueSideEffect(tx, { kind: 'email', idempotencyKey: `partner-card-declined:${invoice.id}:${invoice.attempt_count}`, payload: { template: 'partner-card-declined', invoiceId: invoice.id }, partnerId, storeId: null })
  } else if (account?.card_status === 'declined' && invoice.status === 'paid') {
    await saveBillingAccount(tx, partnerId, { card_status: 'on_file' }, at)
  }
  return placed(partnerId)
}

// A Connect payout pays the month before it arrives (§14.3: "on the 1st of each month"). When a month
// has more than one (a retry after a failure, a manual payout), its totals are counted once: each
// payout carries what the month's other live payouts don't, and a failed one carries none.
const applyPayout = async (tx: ScopedSql, accountId: string, payout: StripePayout): Promise<Placed> => {
  const partnerId = await selectPartnerByAccount(tx, accountId)
  if (!partnerId) return null
  const currency = await selectContractCurrency(tx, partnerId)
  if (!currency || upper(payout.currency) !== currency) return mismatched(partnerId)
  const arrival = seconds(payout.arrival_date)
  const periodEnd = new Date(Date.UTC(arrival.getUTCFullYear(), arrival.getUTCMonth(), 1))
  const periodStart = new Date(Date.UTC(arrival.getUTCFullYear(), arrival.getUTCMonth() - 1, 1))
  const status = payout.status === 'paid' ? 'paid' : payout.status === 'failed' || payout.status === 'canceled' ? 'failed' : 'scheduled'
  const month = await selectPeriodTotals(tx, partnerId, periodStart, periodEnd)
  const carried = await selectPeriodCarried(tx, partnerId, periodStart, payout.id)
  const live = status !== 'failed'
  await upsertPayout(tx, {
    stripePayoutId: payout.id,
    partnerId,
    periodStart,
    periodEnd,
    currency,
    gross: live ? Math.max(month.gross - carried.gross, 0) : 0,
    fee: live ? Math.max(month.fee - carried.fee, 0) : 0,
    amount: payout.amount,
    stores: live && carried.stores === 0 ? month.stores : 0,
    status,
    scheduledFor: arrival,
    paidAt: status === 'paid' ? arrival : null,
    toLast4: payout.destination && typeof payout.destination === 'object' ? payout.destination.last4 : null,
    failureReason: payout.failure_message ?? null,
  })
  return placed(partnerId)
}

// §14.3 "Verifying · Verified · Verification failed": the test deposit's outcome.
const applyAccount = async (tx: ScopedSql, account: StripeAccount, at: Date): Promise<Placed> => {
  const partnerId = await selectPartnerByAccount(tx, account.id)
  if (!partnerId) return null
  const bank = account.external_accounts?.data[0]
  if (!bank) return placed(partnerId)
  const before = await selectBillingAccount(tx, partnerId)
  const status = payoutStatusOf(bank.status)
  // The test deposit's outcome is final for that account: a read made before it never undoes it.
  if (before?.payout_last4 === bank.last4 && (before.payout_status === 'verified' || before.payout_status === 'failed') && status === 'verifying') return placed(partnerId)
  await saveBillingAccount(tx, partnerId, { payout_bank: bank.bank_name ?? null, payout_last4: bank.last4, payout_status: status, payout_failure: status === 'failed' ? bank.status : null }, at)
  if (status === 'failed' && before?.payout_status !== 'failed') {
    await queueSideEffect(tx, { kind: 'email', idempotencyKey: `partner-payout-failed:${account.id}:${bank.last4}`, payload: { template: 'partner-payout-account-failed' }, partnerId, storeId: null })
  }
  return placed(partnerId)
}

const apply = async (tx: ScopedSql, subject: Subject, type: string, at: Date, activity: ActivityLog): Promise<Placed> => {
  switch (subject.kind) {
    case 'invoice':
      return (await selectPartnerByCustomer(tx, subject.invoice.customer)) ? applyPartnerInvoice(tx, subject.invoice, type, at) : applyMerchantInvoice(tx, subject.invoice, subject.refunds)
    case 'charge':
      return subject.invoice ? applyMerchantInvoice(tx, subject.invoice, subject.refunds) : null
    case 'payout':
      return applyPayout(tx, subject.accountId, subject.payout)
    case 'account':
      return applyAccount(tx, subject.account, at)
    case 'subscription': {
      const partnerId = await applyStoreSubscription(tx, subject.subscription, activity, at)
      return partnerId ? placed(partnerId) : null
    }
    case 'none':
      return null
  }
}

/** Which partner an event is about, from the ids it names, for the stale strip when Stripe is slow. */
const partnerNamed = async (tx: ScopedSql, event: StripeEvent): Promise<string | null> => {
  if (event.account) return selectPartnerByAccount(tx, event.account)
  const customer = event.data.object.customer
  if (!customer) return null
  return (await selectPartnerByCustomer(tx, customer)) ?? (await selectPartnerByStoreCustomer(tx, customer))
}

/**
 * Handles one verified event. Throws StripeUnavailable when Stripe can't be read back, so the hook
 * answers 503 and Stripe delivers it again; nothing is recorded for it until then.
 */
export const handleStripeEvent = async ({ sql, stripe, event, activity, now }: { sql: postgres.Sql; stripe: StripeApi; event: StripeEvent; activity: ActivityLog; now: () => Date }): Promise<EventOutcome> => {
  let subject: Subject
  try {
    subject = await fetchSubject(stripe, event)
  } catch (error) {
    if (error instanceof StripeUnavailable) {
      await withSystemScope(sql, async (tx) => {
        const partnerId = await partnerNamed(tx, event)
        if (partnerId) await touchBillingFeed(tx, partnerId, now(), true)
      })
    }
    throw error
  }
  return withSystemScope(sql, async (tx) => {
    const at = now()
    if (!(await insertBillingEvent(tx, { id: event.id, type: event.type, partnerId: null, storeId: null, at }))) return 'duplicate'
    if (subject.kind === 'none') return 'ignored'
    const result = await apply(tx, subject, event.type, at, activity)
    if (!result) {
      await deleteBillingEvent(tx, event.id)
      return 'unplaced'
    }
    if (result.mismatch) {
      await deleteBillingEvent(tx, event.id)
      await touchBillingFeed(tx, result.partnerId, at, true)
      logEvent({ event: 'stripe_event', api: 'hooks', partnerId: result.partnerId, code: 'currency_mismatch' })
      return 'mismatch'
    }
    const { partnerId } = result
    await setEventPartner(tx, event.id, partnerId)
    await touchBillingFeed(tx, partnerId, at, false)
    return 'handled'
  })
}
