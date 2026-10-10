import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog } from '#auth/activity'
import type { SecretBox } from '#auth/secretBox'
import { logEvent } from '#core/log'
import { isCardProvider, PaymentRefused, PaymentUnavailable, type CardProvider, type PaymentGateways, type PaymentOutcome, type WebhookDelivery, type WebhookReading } from '#core/payments'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { cancelOrder, lockPlacedOrder, releaseStock, reserveLine, selectUnpaidOrders } from '#db/scoped/orders'
import { queueOrderUpdate } from '#db/scoped/orderUpdates'
import { queueStoreEvent } from '#db/scoped/storeEvents'
import {
  deferUnpaid,
  forgetStripeAccount,
  holdForMerchant,
  lockPaymentByRef,
  markOrderPaid,
  markPaymentCaptured,
  markPaymentFailed,
  markStockReserved,
  selectAccountById,
  selectLatestPayment,
  selectLinesToHold,
  selectStoreByStripeAccount,
  setLineWarehouse,
  type PaymentToSettleRow,
} from '#db/scoped/payments'
import { isManual, openAccount, providerLabels } from './providers'

// A card payment settled from the webhook, the shopper's return or the sweep, each reading the provider back under the
// payment's lock, so a replay changes nothing (PLATFORM-PROMPT §5.4; DATA-MODEL §7.6).

export const paymentAudit = {
  paid: 'order.paid',
  oversold: 'order.oversold',
  paidAfterCancel: 'order.paid_after_cancel',
  amountMismatch: 'payment.amount_mismatch',
  paidTwice: 'order.paid_twice',
  cancelled: 'order.cancelled',
  stripeDisconnected: 'payment_method.disconnected',
} as const

export interface SettleDeps {
  sql: postgres.Sql
  activity: ActivityLog
  gateways: PaymentGateways
  secrets: SecretBox | null
  now: () => Date
}

/** paid now; already paid; failed; still waiting; paid a different amount; or not a payment of ours. */
export type Settled = 'paid' | 'already' | 'failed' | 'pending' | 'mismatch' | 'unknown'

const providerEntry = (p: { partner_id: string; store_id: string }, provider: string, action: string, target: { type: string; id: string; label: string }, reason: string | null, result: 'success' | 'failed' = 'success'): ActivityEntry => ({
  category: 'system',
  action,
  result,
  actorKind: 'provider',
  actorId: provider,
  actorLabel: isCardProvider(provider) ? providerLabels[provider] : provider,
  partnerId: p.partner_id,
  storeId: p.store_id,
  target,
  reason,
  api: 'system',
  visibility: 'store',
  requestId: null,
  ip: null,
  userAgent: null,
})

/** Held when paid (PLATFORM-PROMPT §5.4), even past what is free since the money is taken; answers whether it was short. */
const holdStock = async (tx: ScopedSql, p: PaymentToSettleRow): Promise<boolean> => {
  let short = false
  for (const line of await selectLinesToHold(tx, p.store_id, p.order_id)) {
    if (!line.track_stock) continue
    const held = await reserveLine(tx, p.store_id, line.version_id, line.quantity, true)
    if (held?.warehouseId) await setLineWarehouse(tx, line.id, held.warehouseId)
    short ||= held?.short ?? true
  }
  await markStockReserved(tx, p.store_id, p.order_id)
  return short
}

/** Applies what the provider says, under the payment's and the order's locks. */
export const applyOutcome = (deps: Pick<SettleDeps, 'sql' | 'activity' | 'now'>, provider: CardProvider, providerRef: string, outcome: PaymentOutcome): Promise<Settled> =>
  withSystemScope(deps.sql, async (tx): Promise<Settled> => {
    const p = await lockPaymentByRef(tx, provider, providerRef)
    if (!p) return 'unknown'
    if (p.state === 'captured' || p.state === 'refunded') return 'already'
    if (p.state === 'mismatch') return 'mismatch'
    if (outcome.state === 'pending') return 'pending'
    const at = deps.now()
    const order = { type: 'order', id: p.order_id, label: p.order_number }
    if (outcome.state === 'failed') {
      await markPaymentFailed(tx, p.id, at)
      return 'failed'
    }
    if (outcome.amount.amount !== BigInt(p.amount) || outcome.amount.currency !== p.currency) {
      // Logged once: the payment is marked, and a replay stops at the check above.
      await deps.activity.record(tx, providerEntry(p, provider, paymentAudit.amountMismatch, order, `${outcome.amount.currency} ${outcome.amount.amount}`, 'failed'))
      await holdForMerchant(tx, p.store_id, p.order_id, p.id, at)
      return 'mismatch'
    }
    await markPaymentCaptured(tx, p.id, at)
    if (p.order_payment_state === 'paid') {
      // An earlier attempt paid too: kept as captured and logged for the merchant to refund.
      await deps.activity.record(tx, providerEntry(p, provider, paymentAudit.paidTwice, order, null))
      return 'already'
    }
    await markOrderPaid(tx, p.store_id, p.order_id, at)
    if (p.order_state === 'cancelled') {
      // Paid after the order was let go: the merchant refunds it or takes it back (LOGGING §3).
      await deps.activity.record(tx, providerEntry(p, provider, paymentAudit.paidAfterCancel, order, null))
      return 'paid'
    }
    // A test payment on a preview storefront never holds real stock (storefront ARCHITECTURE §4.1).
    if (p.mode === 'live' && !p.stock_reserved && (await holdStock(tx, p))) await deps.activity.record(tx, providerEntry(p, provider, paymentAudit.oversold, order, null))
    await deps.activity.record(tx, providerEntry(p, provider, paymentAudit.paid, order, p.mode === 'test' ? 'test' : null))
    if (p.mode === 'live') await queueOrderUpdate(tx, p.store_id, { event: 'confirmed', orderId: p.order_id }, `confirmed:${p.order_id}`)
    if (p.mode === 'live') await queueStoreEvent(tx, p.store_id, 'order.paid', { object: 'order', id: p.order_id, number: p.order_number }, p.order_id, at)
    return 'paid'
  })

/** Reads a payment back from its provider and applies it. Throws PaymentUnavailable when the provider can't be read. */
export const settlePayment = async (deps: SettleDeps, payment: Pick<PaymentToSettleRow, 'provider' | 'provider_ref' | 'provider_account_id' | 'mode' | 'state'>): Promise<Settled> => {
  const provider = payment.provider
  if (!isCardProvider(provider) || !payment.provider_ref || !payment.provider_account_id) return 'unknown'
  if (payment.state === 'captured' || payment.state === 'refunded') return 'already'
  if (payment.state === 'mismatch') return 'mismatch'
  const gateway = deps.gateways[provider]
  const accountId = payment.provider_account_id
  const row = await withSystemScope(deps.sql, (tx) => selectAccountById(tx, accountId))
  const account = row ? await openAccount(row, payment.mode, deps.secrets) : null
  // Disconnected since: nothing can read it now, and the sweep lets the order go.
  if (!gateway || !account) return 'pending'
  let outcome: PaymentOutcome
  try {
    outcome = await gateway.outcome(account, payment.provider_ref)
  } catch (error) {
    // The account's keys or grant are gone: unreadable, so it waits and the sweep lets it go.
    if (!(error instanceof PaymentRefused)) throw error
    logEvent({ event: 'payment_unreadable', api: 'system', code: provider })
    return 'pending'
  }
  return applyOutcome(deps, provider, payment.provider_ref, outcome)
}

/**
 * Closes the order's latest attempt at its provider before anything replaces or cancels it: `open` when the provider
 * won't (a payment still processing), `paid` when it was paid meanwhile, `closed` otherwise or where it can't close one.
 */
export const closeLatestAttempt = async (deps: SettleDeps, storeId: string, orderId: string): Promise<'closed' | 'paid' | 'open'> => {
  const latest = await withSystemScope(deps.sql, (tx) => selectLatestPayment(tx, storeId, orderId))
  const provider = latest?.provider
  if (!latest?.provider_ref || !latest.provider_account_id || !provider || !isCardProvider(provider)) return 'closed'
  const gateway = deps.gateways[provider]
  const accountId = latest.provider_account_id
  const row = await withSystemScope(deps.sql, (tx) => selectAccountById(tx, accountId))
  const account = row ? await openAccount(row, latest.mode, deps.secrets) : null
  if (!gateway?.cancel || !account) return 'closed'
  try {
    await gateway.cancel(account, latest.provider_ref)
    return 'closed'
  } catch (error) {
    if (!(error instanceof PaymentRefused)) throw error
    const settled = await settlePayment(deps, latest)
    return settled === 'paid' || settled === 'already' ? 'paid' : 'open'
  }
}

/** The order's latest card payment, settled: what the shopper's return and the sweep both do. */
export const settleOrder = async (deps: SettleDeps, storeId: string, orderId: string): Promise<Settled> => {
  const latest = await withSystemScope(deps.sql, (tx) => selectLatestPayment(tx, storeId, orderId))
  return latest ? settlePayment(deps, latest) : 'unknown'
}

/** The cron cancels orders unpaid past `payment_due_by` (FIRST-RELEASE §19), a card one only once its provider says unpaid. */
export const releaseUnpaidOrders = async (deps: SettleDeps, now: Date): Promise<number> => {
  const due = await withSystemScope(deps.sql, (tx) => selectUnpaidOrders(tx, now, 100))
  let cancelled = 0
  for (const candidate of due) {
    if (candidate.payment_method && !isManual(candidate.payment_method)) {
      try {
        const settled = await settleOrder(deps, candidate.store_id, candidate.id)
        if (settled === 'paid' || settled === 'already' || settled === 'mismatch') continue
        // Closed at the provider first, so a payment still processing is never left open on a cancelled order.
        const closed = await closeLatestAttempt(deps, candidate.store_id, candidate.id)
        if (closed === 'paid') continue
        if (closed === 'open') {
          await withSystemScope(deps.sql, (tx) => deferUnpaid(tx, candidate.store_id, candidate.id, new Date(now.getTime() + 3_600_000)))
          continue
        }
      } catch (error) {
        if (!(error instanceof PaymentUnavailable)) throw error
        // The provider is down: asked again in an hour, behind newer due orders, never cancelled on a guess.
        await withSystemScope(deps.sql, (tx) => deferUnpaid(tx, candidate.store_id, candidate.id, new Date(now.getTime() + 3_600_000)))
        continue
      }
    }
    const reason = candidate.payment_method === 'bank_transfer' ? 'unpaid_transfer' : 'unpaid'
    const done = await withSystemScope(deps.sql, async (tx) => {
      const order = await lockPlacedOrder(tx, candidate.store_id, candidate.id)
      if (!order || order.state !== 'placed' || order.payment_state !== 'pending') return false
      await releaseStock(tx, candidate.store_id, candidate.id)
      await cancelOrder(tx, candidate.store_id, candidate.id, reason, now)
      await deps.activity.record(tx, {
        category: 'system',
        action: paymentAudit.cancelled,
        result: 'success',
        actorKind: 'job',
        actorId: null,
        actorLabel: reason === 'unpaid_transfer' ? 'Unpaid transfer' : 'Unpaid order',
        partnerId: candidate.partner_id,
        storeId: candidate.store_id,
        target: { type: 'order', id: candidate.id, label: candidate.number },
        reason,
        api: null,
        visibility: 'store',
        requestId: null,
        ip: null,
        userAgent: null,
      })
      return true
    })
    if (done) cancelled += 1
  }
  return cancelled
}

export type MerchantEventOutcome = 'handled' | 'ignored' | 'unplaced'

/** A merchant account's event on the one Stripe endpoint (THIRD-PARTY-ACCESS §3.1); null when no store holds the account. */
export const handleMerchantStripeEvent = async (deps: SettleDeps, event: { type: string; account: string; objectId: string }): Promise<MerchantEventOutcome | null> => {
  const store = await withSystemScope(deps.sql, (tx) => selectStoreByStripeAccount(tx, event.account))
  // A merchant's kind of event from an account no store holds (disconnected since): answered, never billing's.
  if (!store) return event.type.startsWith('payment_intent.') || event.type === 'account.application.deauthorized' ? 'unplaced' : null
  if (event.type === 'account.application.deauthorized') {
    await withSystemScope(deps.sql, async (tx) => {
      if ((await forgetStripeAccount(tx, event.account, deps.now())) > 0) {
        await deps.activity.record(tx, providerEntry(store, 'stripe', paymentAudit.stripeDisconnected, { type: 'payment_method', id: 'stripe', label: 'Stripe' }, 'deauthorized'))
      }
    })
    return 'handled'
  }
  if (!event.type.startsWith('payment_intent.')) return 'ignored'
  const payment = await withSystemScope(deps.sql, async (tx) => (await lockPaymentByRef(tx, 'stripe', event.objectId)) ?? null)
  // Not one of ours, or another store's: a payment the merchant took outside DripFunnel.
  if (!payment || payment.store_id !== store.store_id) return 'unplaced'
  await settlePayment(deps, payment)
  return 'handled'
}

export type KeyedWebhookOutcome = 'handled' | 'ignored' | 'invalid' | 'unknown'

/**
 * A webhook on a store's own address (hooks/payments.ts): checked with that account's own secret, then the payment it
 * names is read back and settled, if it is one this account started. Throws PaymentUnavailable for the hook to answer 503.
 */
export const settleFromWebhook = async (deps: SettleDeps, provider: CardProvider, accountRowId: string, delivery: WebhookDelivery): Promise<KeyedWebhookOutcome> => {
  const row = await withSystemScope(deps.sql, (tx) => selectAccountById(tx, accountRowId))
  const gateway = deps.gateways[provider]
  if (!row || row.provider !== provider || !gateway?.webhook) return 'unknown'
  const account = await openAccount(row, row.mode, deps.secrets)
  if (!account) return 'unknown'
  let reading: WebhookReading
  try {
    reading = await gateway.webhook(account, delivery)
  } catch (error) {
    // The provider refused its check (PayPal's, on forged headers) or the keys are gone: not a webhook we take.
    if (error instanceof PaymentRefused) return 'invalid'
    throw error
  }
  if (!reading.valid) return 'invalid'
  if (!reading.providerRef) return 'ignored'
  const providerRef = reading.providerRef
  const payment = await withSystemScope(deps.sql, (tx) => lockPaymentByRef(tx, provider, providerRef))
  // Started outside DripFunnel, or through another of the store's accounts: not this address's to settle.
  if (!payment || payment.provider_account_id !== row.id) return 'ignored'
  await settlePayment(deps, payment)
  return 'handled'
}
