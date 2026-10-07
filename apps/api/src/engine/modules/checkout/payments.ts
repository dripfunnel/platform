import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog } from '#auth/activity'
import type { SecretBox } from '#auth/secretBox'
import { isCardProvider, PaymentUnavailable, type CardProvider, type PaymentGateways, type PaymentOutcome } from '#core/payments'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { cancelOrder, lockPlacedOrder, releaseStock, reserveLine, selectUnpaidOrders } from '#db/scoped/orders'
import {
  forgetStripeAccount,
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

// A card payment's outcome, from whichever arrives first: the provider's webhook, the shopper coming back, or the sweep
// (PLATFORM-PROMPT §5.4 Payments). Each reads the payment as the provider has it now and applies it under the payment's
// lock, so a replay or a late event changes nothing twice (webhooks idempotent, THIRD-PARTY-ACCESS §3.1).

export const paymentAudit = {
  paid: 'order.paid',
  oversold: 'order.oversold',
  paidAfterCancel: 'order.paid_after_cancel',
  amountMismatch: 'payment.amount_mismatch',
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

/**
 * Holds a paid order's stock where it is (PLATFORM-PROMPT §5.4: reserved when paid). The money is taken, so it holds even
 * when too little is left, and says so for the merchant to sort out (decided on #309; refunds are SAPI 11's).
 */
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
    if (outcome.state === 'pending') return 'pending'
    const at = deps.now()
    const order = { type: 'order', id: p.order_id, label: p.order_number }
    if (outcome.state === 'failed') {
      await markPaymentFailed(tx, p.id, at)
      return 'failed'
    }
    if (outcome.amount.amount !== BigInt(p.amount) || outcome.amount.currency !== p.currency) {
      await deps.activity.record(tx, providerEntry(p, provider, paymentAudit.amountMismatch, order, `${outcome.amount.currency} ${outcome.amount.amount}`, 'failed'))
      return 'mismatch'
    }
    await markPaymentCaptured(tx, p.id, at)
    await markOrderPaid(tx, p.store_id, p.order_id, at)
    if (p.order_state === 'cancelled') {
      // Paid after the order was let go: the merchant refunds it or takes it back (LOGGING §3).
      await deps.activity.record(tx, providerEntry(p, provider, paymentAudit.paidAfterCancel, order, null))
      return 'paid'
    }
    // A test payment on a preview storefront never holds real stock (storefront ARCHITECTURE §4.1).
    if (p.mode === 'live' && !p.stock_reserved && (await holdStock(tx, p))) await deps.activity.record(tx, providerEntry(p, provider, paymentAudit.oversold, order, null))
    await deps.activity.record(tx, providerEntry(p, provider, paymentAudit.paid, order, p.mode === 'test' ? 'test' : null))
    return 'paid'
  })

/** Reads a payment back from its provider and applies it. Throws PaymentUnavailable when the provider can't be read. */
export const settlePayment = async (deps: SettleDeps, payment: Pick<PaymentToSettleRow, 'provider' | 'provider_ref' | 'provider_account_id' | 'mode' | 'state'>): Promise<Settled> => {
  const provider = payment.provider
  if (!isCardProvider(provider) || !payment.provider_ref || !payment.provider_account_id) return 'unknown'
  if (payment.state === 'captured' || payment.state === 'refunded') return 'already'
  const gateway = deps.gateways[provider]
  const accountId = payment.provider_account_id
  const row = await withSystemScope(deps.sql, (tx) => selectAccountById(tx, accountId))
  const account = row ? await openAccount(row, payment.mode, deps.secrets) : null
  // Disconnected since: nothing can read it now, and the sweep lets the order go.
  if (!gateway || !account) return 'pending'
  return applyOutcome(deps, provider, payment.provider_ref, await gateway.outcome(account, payment.provider_ref))
}

/** The order's latest card payment, settled: what the shopper's return and the sweep both do. */
export const settleOrder = async (deps: SettleDeps, storeId: string, orderId: string): Promise<Settled> => {
  const latest = await withSystemScope(deps.sql, (tx) => selectLatestPayment(tx, storeId, orderId))
  return latest ? settlePayment(deps, latest) : 'unknown'
}

/**
 * The cron's sweep: an order still unpaid past its time is cancelled by the system, its stock (if held) released, logged
 * with the system as actor (LOGGING §3). A bank transfer has 3 days (decided 2026-10-05 on #284); a card payment a day, and
 * is read back from its provider first so a payment whose webhook was lost is kept. Answers how many it cancelled.
 */
export const releaseUnpaidOrders = async (deps: SettleDeps, now: Date): Promise<number> => {
  const due = await withSystemScope(deps.sql, (tx) => selectUnpaidOrders(tx, now, 100))
  let cancelled = 0
  for (const candidate of due) {
    if (candidate.payment_method && !isManual(candidate.payment_method)) {
      try {
        const settled = await settleOrder(deps, candidate.store_id, candidate.id)
        if (settled === 'paid' || settled === 'already' || settled === 'mismatch') continue
      } catch (error) {
        // The provider is down: asked again on the next sweep, never cancelled on a guess.
        if (error instanceof PaymentUnavailable) continue
        throw error
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

/**
 * An event from a merchant's connected Stripe account, on the platform's one endpoint (THIRD-PARTY-ACCESS §3.1): a payment
 * is read back and settled; the merchant ending the platform's access from Stripe turns Stripe off for the store. Null when
 * the account is no store's, so the caller hands it to billing. Throws PaymentUnavailable for the hook to answer 503.
 */
export const handleMerchantStripeEvent = async (deps: SettleDeps, event: { type: string; account: string; objectId: string }): Promise<MerchantEventOutcome | null> => {
  const store = await withSystemScope(deps.sql, (tx) => selectStoreByStripeAccount(tx, event.account))
  if (!store) return null
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
