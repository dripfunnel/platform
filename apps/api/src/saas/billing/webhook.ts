import type postgres from 'postgres'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  insertBillingEvent,
  saveBillingAccount,
  selectBillingAccount,
  selectChargeByRef,
  selectContractCurrency,
  selectPartnerByAccount,
  deleteBillingEvent,
  selectPartnerByCustomer,
  selectPartnerByStoreCustomer,
  selectPeriodTotals,
  selectStoreByCustomer,
  setEventPartner,
  touchBillingFeed,
  upsertCharge,
  upsertPartnerInvoice,
  upsertPayout,
} from '#db/scoped/partnerBilling'
import { StripeUnavailable, type StripeAccount, type StripeApi, type StripeCharge, type StripeEvent, type StripeInvoice, type StripePayout } from '#integrations/stripe/index'
import { queueSideEffect } from '#saas/outbox/index'
import { payoutStatusOf } from './partner'

// The Stripe webhook's work (SAAS §7.2; #201). Every event is answered by reading the object as
// Stripe has it now, so a replay changes nothing and an old event arriving late can't undo a
// newer one; the event id goes into billing_event in the same transaction as what it changed.

export type EventOutcome = 'handled' | 'duplicate' | 'ignored'

/** What one event is about, read back from Stripe before anything is written. */
type Subject =
  | { kind: 'invoice'; invoice: StripeInvoice }
  | { kind: 'charge'; charge: StripeCharge; invoice: StripeInvoice | null }
  | { kind: 'payout'; accountId: string; payout: StripePayout }
  | { kind: 'account'; account: StripeAccount }
  | { kind: 'none' }

const seconds = (s: number) => new Date(s * 1000)
const upper = (c: string) => c.toUpperCase()

/** `value × part / total` in integers, rounded half up. */
const share = (value: number, part: number, total: number): number => (total === 0 ? 0 : Number((BigInt(value) * BigInt(part) * 2n + BigInt(total)) / (2n * BigInt(total))))

const fetchSubject = async (stripe: StripeApi, event: StripeEvent): Promise<Subject> => {
  const object = event.data.object
  if (event.type.startsWith('invoice.')) return { kind: 'invoice', invoice: await stripe.invoice(object.id) }
  if (event.type.startsWith('charge.')) {
    const charge = await stripe.charge(object.id)
    return { kind: 'charge', charge, invoice: charge.invoice ? await stripe.invoice(charge.invoice) : null }
  }
  if (event.type.startsWith('payout.') && event.account) return { kind: 'payout', accountId: event.account, payout: await stripe.payout(event.account, object.id) }
  if (event.type.startsWith('account.')) {
    const accountId = event.account ?? (object.object === 'account' ? object.id : null)
    if (accountId) return { kind: 'account', account: await stripe.account(accountId) }
  }
  return { kind: 'none' }
}

const metadataOf = (invoice: StripeInvoice) => ({ ...(invoice.subscription_details?.metadata ?? {}), ...invoice.metadata })
const chargeOf = (invoice: StripeInvoice): StripeCharge | null => (invoice.charge && typeof invoice.charge === 'object' ? invoice.charge : null)

// A merchant's subscription invoice is one merchant_charge row, whichever of its retries paid it.
const applyMerchantInvoice = async (tx: ScopedSql, invoice: StripeInvoice): Promise<string | null> => {
  const storeId = metadataOf(invoice)['store_id']
  if (!storeId || !/^[0-9a-f-]{36}$/i.test(storeId)) return null
  const store = await selectStoreByCustomer(tx, storeId, invoice.customer)
  if (!store) return null
  if (invoice.status === 'draft' || (invoice.status === 'open' && invoice.attempt_count === 0)) return store.partner_id
  const payoutCurrency = await selectContractCurrency(tx, store.partner_id)
  if (!payoutCurrency) return store.partner_id

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
      if (upper(transfer.currency) !== payoutCurrency) return store.partner_id
      fee = share(appFee, transfer.amount, Math.max(amount - appFee, 0))
      gross = transfer.amount + fee
    } else if (upper(invoice.currency) === payoutCurrency) {
      fee = appFee
      gross = amount
    } else return store.partner_id
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
    attempt: !paid && invoice.status === 'open' && invoice.next_payment_attempt ? Math.max(invoice.attempt_count, 1) : null,
    chargedAt: seconds(invoice.status_transitions?.paid_at ?? invoice.created),
  })

  // Each refund its own row, its payout part in proportion (migration 0019: refunds subtract).
  for (const refund of charge?.refunds?.data ?? []) {
    if (refund.status !== 'succeeded') continue
    const original = await selectChargeByRef(tx, invoice.id)
    if (!original) continue
    await upsertCharge(tx, {
      stripeRef: refund.id,
      partnerId: store.partner_id,
      storeId: store.store_id,
      kind: 'refund',
      status: 'refunded',
      amount: refund.amount,
      currency: upper(invoice.currency),
      payoutCurrency,
      payoutGross: share(original.payout_gross, refund.amount, original.amount),
      fee: share(original.fee_amount, refund.amount, original.amount),
      cardLast4: null,
      failureReason: null,
      invoiceId: invoice.id,
      retryAt: null,
      attempt: null,
      chargedAt: seconds(refund.created),
    })
  }
  return store.partner_id
}

// DripFunnel's invoice to the partner (§11.3), and what its payment says about the card.
const applyPartnerInvoice = async (tx: ScopedSql, invoice: StripeInvoice, type: string, at: Date): Promise<string | null> => {
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
  return partnerId
}

// A Connect payout pays the month before it arrives (§14.3: "on the 1st of each month").
const applyPayout = async (tx: ScopedSql, accountId: string, payout: StripePayout): Promise<string | null> => {
  const partnerId = await selectPartnerByAccount(tx, accountId)
  if (!partnerId) return null
  const currency = await selectContractCurrency(tx, partnerId)
  if (!currency || upper(payout.currency) !== currency) return partnerId
  const arrival = seconds(payout.arrival_date)
  const periodEnd = new Date(Date.UTC(arrival.getUTCFullYear(), arrival.getUTCMonth(), 1))
  const periodStart = new Date(Date.UTC(arrival.getUTCFullYear(), arrival.getUTCMonth() - 1, 1))
  const totals = await selectPeriodTotals(tx, partnerId, periodStart, periodEnd)
  const status = payout.status === 'paid' ? 'paid' : payout.status === 'failed' || payout.status === 'canceled' ? 'failed' : 'scheduled'
  await upsertPayout(tx, {
    stripePayoutId: payout.id,
    partnerId,
    periodStart,
    periodEnd,
    currency,
    gross: totals.gross,
    fee: totals.fee,
    amount: payout.amount,
    stores: totals.stores,
    status,
    scheduledFor: arrival,
    paidAt: status === 'paid' ? arrival : null,
    toLast4: payout.destination && typeof payout.destination === 'object' ? payout.destination.last4 : null,
    failureReason: payout.failure_message ?? null,
  })
  return partnerId
}

// §14.3 "Verifying · Verified · Verification failed": the test deposit's outcome.
const applyAccount = async (tx: ScopedSql, account: StripeAccount, at: Date): Promise<string | null> => {
  const partnerId = await selectPartnerByAccount(tx, account.id)
  if (!partnerId) return null
  const bank = account.external_accounts?.data[0]
  if (!bank) return partnerId
  const before = await selectBillingAccount(tx, partnerId)
  const status = payoutStatusOf(bank.status)
  await saveBillingAccount(tx, partnerId, { payout_bank: bank.bank_name ?? null, payout_last4: bank.last4, payout_status: status, payout_failure: status === 'failed' ? bank.status : null }, at)
  if (status === 'failed' && before?.payout_status !== 'failed') {
    await queueSideEffect(tx, { kind: 'email', idempotencyKey: `partner-payout-failed:${account.id}:${bank.last4}`, payload: { template: 'partner-payout-account-failed' }, partnerId, storeId: null })
  }
  return partnerId
}

const apply = async (tx: ScopedSql, subject: Subject, type: string, at: Date): Promise<string | null> => {
  switch (subject.kind) {
    case 'invoice':
      return (await selectPartnerByCustomer(tx, subject.invoice.customer)) ? applyPartnerInvoice(tx, subject.invoice, type, at) : applyMerchantInvoice(tx, subject.invoice)
    case 'charge':
      return subject.invoice ? applyMerchantInvoice(tx, subject.invoice) : null
    case 'payout':
      return applyPayout(tx, subject.accountId, subject.payout)
    case 'account':
      return applyAccount(tx, subject.account, at)
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
export const handleStripeEvent = async ({ sql, stripe, event, now }: { sql: postgres.Sql; stripe: StripeApi; event: StripeEvent; now: () => Date }): Promise<EventOutcome> => {
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
    const partnerId = await apply(tx, subject, event.type, at)
    if (!partnerId) {
      await deleteBillingEvent(tx, event.id)
      return 'ignored'
    }
    await setEventPartner(tx, event.id, partnerId)
    await touchBillingFeed(tx, partnerId, at, false)
    return 'handled'
  })
}
