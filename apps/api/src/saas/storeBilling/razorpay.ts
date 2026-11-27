import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog } from '#auth/activity'
import type { SecretBox } from '#auth/secretBox'
import { PaymentRefused, PaymentUnavailable } from '#core/payments'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  advancePeriod,
  endRazorpaySubscription,
  hasChangeUnderway,
  insertRazorpayPlan,
  insertRenewal,
  insertSubscribeCharge,
  markChargeCaptured,
  markSubscriptionPastDue,
  saveRazorpaySubscription,
  selectPlanByRazorpayId,
  selectPlanPrice,
  selectRazorpayPlan,
  selectRazorpayStoresEnding,
  type RazorpayStoreEnding,
  selectSealedBillingGateway,
  selectStoreByRazorpaySubscription,
  selectSubscribeCharge,
  type GatewayMode,
} from '#db/scoped/razorpayBilling'
import { applyPlan, clearScheduledChange, scheduleChange, selectBillingSubscription } from '#db/scoped/storeBilling'
import { selectStoreForUpdate } from '#db/scoped/stores'
import { dateOf, methodOf, razorpayKeysSchema, type PlanMethod, type RazorpayBilling, type RazorpayKeys, type RazorpaySubscription } from '#integrations/payments/index'
import { queueSideEffect } from '#saas/outbox/index'
import { transitionStore } from '#saas/stores/index'
import { dunningLabel } from './dunning'
import { keepWithinPlan } from './keep'
import { addInterval } from './quote'

// A store's plan paid to its partner through Razorpay Subscriptions on the partner's own account (#1744; SAAS §7.4):
// every outcome is read back from Razorpay, whatever told the platform to look (a webhook, the hourly run, the Owner).

/** RBI's e-mandate rule as Razorpay applies it to Subscriptions: UPI AutoPay only for a charge under ₹15,000. */
export const upiBelow = 1_500_000
/** The Owner is reminded the day before a renewal (SAAS §7.4). */
const remindAheadMs = 2 * 86_400_000
const dayMs = 86_400_000
const sweepSize = 100
/** A run stops after this many pages; the next run (hourly, or tomorrow's reminder window) carries on. */
const sweepPages = 50
/** How far back the hourly run looks for a store whose period ended without Razorpay's renewal reaching it. */
const backstopMs = 7 * dayMs

export interface PlanBillingDeps {
  sql: postgres.Sql
  api: RazorpayBilling
  secrets: SecretBox | null
  activity: ActivityLog
  now: () => Date
}

export interface Gateway {
  mode: GatewayMode
  keys: RazorpayKeys
}

/** The partner's keys for plan billing, opened only for the call: live where connected, else test, or the mode asked for. */
export const openGateway = async ({ sql, secrets }: Pick<PlanBillingDeps, 'sql' | 'secrets'>, partnerId: string, mode?: GatewayMode): Promise<Gateway | null> => {
  const row = await withSystemScope(sql, (tx) => selectSealedBillingGateway(tx, partnerId, mode))
  const opened = row && secrets ? await secrets.open(row.key_enc) : null
  if (!row || !opened) return null
  let json: unknown
  try {
    json = JSON.parse(opened)
  } catch {
    return null
  }
  const keys = razorpayKeysSchema.safeParse(json)
  return keys.success ? { mode: row.mode, keys: keys.data } : null
}

const systemEntry = (store: { id: string; partner_id: string; name: string }, action: string, reason: string | null, changes: NonNullable<ActivityEntry['changes']>): ActivityEntry => ({
  category: 'system',
  action,
  result: 'success',
  actorKind: 'provider',
  actorId: null,
  actorLabel: 'Razorpay',
  partnerId: store.partner_id,
  storeId: store.id,
  target: { type: 'store', id: store.id, label: store.name },
  reason,
  changes,
  api: null,
  visibility: 'store',
  requestId: null,
  ip: null,
  userAgent: null,
})

export const planBillingAudit = {
  renewed: 'billing.renewed',
  changed: 'billing.plan_changed',
  pastDue: 'store.past_due',
  paid: 'store.paid',
  restored: 'store.restored',
} as const

export type CheckoutRefusal = 'BILLED_BY_PARTNER' | 'NO_SUBSCRIPTION' | 'NOT_FOUND' | 'PAYMENT_FAILED' | 'PROVIDER_UNAVAILABLE' | 'INVALID_INPUT'
export type CheckoutResult<T> = { ok: true; value: T } | { ok: false; reason: CheckoutRefusal }

const refusalOf = (error: unknown): { ok: false; reason: CheckoutRefusal } => {
  if (error instanceof PaymentUnavailable) return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
  if (error instanceof PaymentRefused) return { ok: false, reason: 'PAYMENT_FAILED' }
  throw error
}

export interface PlanPick {
  planId: string
  planVersion: number
  planName: string
  interval: 'month' | 'year'
  currency: string
  amount: number
}

/** The partner plan as a Razorpay plan on the partner's account, made the first time any store needs it. */
const razorpayPlanFor = async (deps: PlanBillingDeps, gateway: Gateway, partnerId: string, p: PlanPick): Promise<string> => {
  const key = { partnerId, mode: gateway.mode, planId: p.planId, planVersion: p.planVersion, interval: p.interval, currency: p.currency, amount: p.amount }
  const known = await withSystemScope(deps.sql, (tx) => selectRazorpayPlan(tx, key))
  if (known) return known
  const made = await deps.api.createPlan(gateway.keys, { name: p.planName, amount: p.amount, currency: p.currency, interval: p.interval, planId: p.planId, planVersion: p.planVersion })
  return withSystemScope(deps.sql, (tx) => insertRazorpayPlan(tx, key, made))
}

// ---- The store follows its subscription ----

const toActive = async (deps: PlanBillingDeps, tx: ScopedSql, storeId: string, at: Date): Promise<void> => {
  const store = await selectStoreForUpdate(tx, storeId)
  if (!store) return
  const to = async (next: 'active' | 'restored', action: string) => {
    const done = await transitionStore(tx, store, { to: next }, at)
    if (done.ok) await deps.activity.record(tx, systemEntry(store, action, 'paid', [{ field: 'status', before: store.status, after: done.status }]))
    return done.ok
  }
  if (store.status === 'trial' || store.status === 'past_due') await to('active', planBillingAudit.paid)
  else if (store.status === 'suspended' && store.suspended_by_label === dunningLabel && store.suspended_previous_status === 'past_due' && (await to('restored', planBillingAudit.restored))) {
    const restored = await selectStoreForUpdate(tx, storeId)
    if (restored) await transitionStore(tx, restored, { to: 'active' }, at)
  }
  await keepWithinPlan(tx, storeId, at)
}

const toPastDue = async (deps: PlanBillingDeps, tx: ScopedSql, storeId: string, reason: string, at: Date): Promise<void> => {
  await markSubscriptionPastDue(tx, storeId)
  const store = await selectStoreForUpdate(tx, storeId)
  if (store?.status !== 'active') return
  const done = await transitionStore(tx, store, { to: 'past_due' }, at)
  if (done.ok) await deps.activity.record(tx, systemEntry(store, planBillingAudit.pastDue, reason, [{ field: 'status', before: 'active', after: 'past_due' }]))
}

/** The store as Razorpay has its subscription now: renewed, past due, or moved to the free plan it chose (SAAS §7.4). */
export const followSubscription = async (deps: PlanBillingDeps, gateway: Gateway, partnerId: string, s: RazorpaySubscription): Promise<'renewed' | 'changed' | 'past_due' | 'unchanged' | 'unknown'> => {
  const at = deps.now()
  const known = await withSystemScope(deps.sql, (tx) => selectStoreByRazorpaySubscription(tx, partnerId, s.id))
  if (!known) {
    // Checkout's answer never reached the API (a closed tab, say): the subscription read back settles it the same way.
    const pending = await withSystemScope(deps.sql, (tx) => selectSubscribeCharge(tx, partnerId, s.id))
    if (!pending || pending.status === 'captured') return 'unknown'
    return (await applyCheckout(deps, gateway, partnerId, pending.store_id, s, null)) === null ? 'unknown' : 'changed'
  }
  const current = await withSystemScope(deps.sql, (tx) => selectBillingSubscription(tx, known.store_id))
  const renewing = s.status === 'active' && current && (s.current_start ?? 0) * 1000 > current.period_start.getTime()
  const invoices = renewing ? await deps.api.invoices(gateway.keys, s.id) : []
  return withSystemScope(deps.sql, async (tx) => {
    const mine = await selectStoreByRazorpaySubscription(tx, partnerId, s.id)
    const sub = mine ? await selectBillingSubscription(tx, mine.store_id, true) : null
    if (!mine || !sub) return 'unknown'
    if (s.status === 'pending' || s.status === 'halted') {
      await toPastDue(deps, tx, sub.store_id, `razorpay_${s.status}`, at)
      return 'past_due'
    }
    const ended = s.status === 'cancelled' || s.status === 'completed' || s.status === 'expired'
    if (ended) {
      const next = sub.next_plan_id && sub.next_plan_version !== null && sub.next_interval ? { id: sub.next_plan_id, version: sub.next_plan_version, interval: sub.next_interval } : null
      if (next && sub.period_end.getTime() <= at.getTime() && (await selectPlanPrice(tx, next.id, next.version, sub.currency, next.interval)) === 0) {
        // The free plan chosen for the period's end follows the subscription that ended with it.
        await applyPlan(tx, sub.store_id, { planId: next.id, planVersion: next.version, interval: next.interval, amount: 0, subscriptionId: null, periodStart: sub.period_end, periodEnd: addInterval(sub.period_end, next.interval), activate: true })
        await endRazorpaySubscription(tx, sub.store_id)
        await deps.activity.record(tx, systemEntry({ id: sub.store_id, partner_id: partnerId, name: sub.store_name }, planBillingAudit.changed, 'razorpay', [{ field: 'plan', before: sub.plan_id, after: next.id }]))
        return 'changed'
      }
      // Stopped on Razorpay (a mandate revoked in the UPI app, say) with the store not closing, and no new one replacing it.
      if (sub.cancel_at || (await hasChangeUnderway(tx, sub.store_id, at))) return 'unchanged'
      await toPastDue(deps, tx, sub.store_id, `razorpay_${s.status}`, at)
      return 'past_due'
    }
    if (s.status !== 'active') return 'unchanged'
    const plan = await selectPlanByRazorpayId(tx, partnerId, gateway.mode, s.plan_id)
    const start = dateOf(s.current_start)
    const end = dateOf(s.current_end)
    if (!plan || !start || !end) return 'unchanged'
    if (start.getTime() > sub.period_start.getTime()) {
      const paid = invoices.find((i) => i.status === 'paid' && i.billing_start === s.current_start)
      const recorded = await insertRenewal(tx, { store_id: sub.store_id, partner_id: partnerId, mode: gateway.mode, plan_id: plan.planId, plan_version: plan.planVersion, interval: plan.interval, amount: plan.amount, currency: plan.currency, razorpay_subscription_id: s.id, razorpay_payment_id: paid?.payment_id ?? null, period_start: start, period_end: end })
      await advancePeriod(tx, sub.store_id, { planId: plan.planId, planVersion: plan.planVersion, interval: plan.interval, amount: plan.amount, periodStart: start, periodEnd: end })
      if (recorded) await deps.activity.record(tx, systemEntry({ id: sub.store_id, partner_id: partnerId, name: sub.store_name }, planBillingAudit.renewed, 'paid', [{ field: 'period_end', before: sub.period_end.toISOString(), after: end.toISOString() }]))
      await toActive(deps, tx, sub.store_id, at)
      return 'renewed'
    }
    if (sub.store_status === 'past_due') await toActive(deps, tx, sub.store_id, at)
    return 'unchanged'
  })
}

// ---- The Owner's first payment, in Checkout ----

export interface SubscriptionCheckout {
  keyId: string
  subscriptionId: string
  amount: number
  currency: string
  mode: GatewayMode
  upi: boolean
}

/** A plan change on a subscribed store: a new subscription from `startAt`, today's part paid at approval as an add-on. */
export interface PlanChange {
  when: 'now' | 'period_end'
  startAt: Date
  periodStart: Date
  periodEnd: Date
  today: number
}

/** Checkout on a new subscription: the plan's own amount for a first payment, or what a change makes due today. */
export const startSubscription = async (deps: PlanBillingDeps, storeId: string, partnerId: string, p: PlanPick, change: PlanChange | null = null): Promise<CheckoutResult<SubscriptionCheckout>> => {
  const gateway = await openGateway(deps, partnerId)
  if (!gateway) return { ok: false, reason: 'BILLED_BY_PARTNER' }
  try {
    const razorpayPlanId = await razorpayPlanFor(deps, gateway, partnerId, p)
    const addon = change && change.today > 0 ? { name: `${p.planName} for the rest of this period`, amount: change.today, currency: p.currency } : null
    const s = await deps.api.createSubscription(gateway.keys, { razorpayPlanId, interval: p.interval, storeId, startAt: change?.startAt ?? null, addon })
    await withSystemScope(deps.sql, (tx) =>
      insertSubscribeCharge(tx, {
        store_id: storeId,
        partner_id: partnerId,
        mode: gateway.mode,
        plan_id: p.planId,
        plan_version: p.planVersion,
        interval: p.interval,
        amount: p.amount,
        currency: p.currency,
        razorpay_subscription_id: s.id,
        change_when: change?.when ?? null,
        period_start: change?.periodStart ?? null,
        period_end: change?.periodEnd ?? null,
      }),
    )
    // UPI AutoPay is judged on the renewals the mandate will pay, as Razorpay does.
    return { ok: true, value: { keyId: gateway.keys.keyId, subscriptionId: s.id, amount: change ? change.today : p.amount, currency: p.currency, mode: gateway.mode, upi: p.currency === 'INR' && p.amount < upiBelow } }
  } catch (error) {
    return refusalOf(error)
  }
}

export interface CheckoutAnswer {
  paymentId: string
  subscriptionId: string
  signature: string
}

type Applied = 'started' | 'now' | 'scheduled' | 'kept' | 'none'

// An approved subscription, read back: the one it replaces ends first so only one charges, then its plan applies.
// Null when it isn't this store's; 'none' when it was already settled.
const applyCheckout = async (deps: PlanBillingDeps, gateway: Gateway, partnerId: string, storeId: string, s: RazorpaySubscription, paymentId: string | null): Promise<{ method: PlanMethod | null; applied: Applied } | null> => {
  const notes = s.notes && !Array.isArray(s.notes) ? s.notes : {}
  if (notes['df_store_id'] !== storeId || (s.status !== 'active' && s.status !== 'authenticated')) return null
  const method = paymentId ? methodOf(await deps.api.payment(gateway.keys, paymentId)) : null
  const before = await withSystemScope(deps.sql, (tx) => selectBillingSubscription(tx, storeId))
  if (before?.razorpay_subscription_id && before.razorpay_subscription_id !== s.id && before.razorpay_mode) {
    const old = await openGateway(deps, partnerId, before.razorpay_mode)
    if (!old) throw new PaymentUnavailable('the replaced subscription’s keys are unavailable')
    const replaced = await deps.api.subscription(old.keys, before.razorpay_subscription_id)
    if (!['cancelled', 'completed', 'expired'].includes(replaced.status)) await deps.api.cancelNow(old.keys, replaced.id)
  }
  const at = deps.now()
  return withSystemScope(deps.sql, async (tx) => {
    const locked = await selectSubscribeCharge(tx, partnerId, s.id)
    const sub = await selectBillingSubscription(tx, storeId, true)
    if (!locked || !sub || locked.store_id !== storeId || locked.status === 'captured') return { method, applied: 'none' as const }
    const start = locked.period_start ?? dateOf(s.current_start) ?? at
    const end = locked.period_end ?? dateOf(s.current_end) ?? addInterval(start, locked.interval)
    await saveRazorpaySubscription(tx, storeId, { subscriptionId: s.id, customerId: s.customer_id ?? null, mode: gateway.mode, method })
    const move = { planId: locked.plan_id, planVersion: locked.plan_version, interval: locked.interval, amount: locked.amount }
    let applied: Applied = locked.change_when === 'now' ? 'now' : 'started'
    if (locked.change_when === 'period_end') {
      const keeps = locked.plan_id === sub.plan_id && locked.plan_version === sub.plan_version && locked.interval === sub.interval
      applied = keeps ? 'kept' : 'scheduled'
      await (keeps ? clearScheduledChange(tx, storeId) : scheduleChange(tx, storeId, { ...move, at: start }))
    } else {
      await applyPlan(tx, storeId, { ...move, subscriptionId: null, periodStart: start, periodEnd: end, activate: true })
    }
    await markChargeCaptured(tx, locked.id, { paymentId, periodStart: start, periodEnd: end }, at)
    await toActive(deps, tx, storeId, at)
    return { method, applied }
  })
}

/** Checkout's answer: its signature is checked with the key secret, then the subscription is read back and applied. */
export const confirmSubscription = async (deps: PlanBillingDeps, storeId: string, partnerId: string, answer: CheckoutAnswer): Promise<CheckoutResult<{ method: PlanMethod | null; applied: Applied }>> => {
  const pending = await withSystemScope(deps.sql, (tx) => selectSubscribeCharge(tx, partnerId, answer.subscriptionId))
  if (!pending || pending.store_id !== storeId) return { ok: false, reason: 'NOT_FOUND' }
  const gateway = await openGateway(deps, partnerId, pending.mode)
  if (!gateway) return { ok: false, reason: 'BILLED_BY_PARTNER' }
  if (!(await deps.api.checkoutSignatureValid(gateway.keys, answer.paymentId, answer.subscriptionId, answer.signature))) return { ok: false, reason: 'PAYMENT_FAILED' }
  try {
    const applied = await applyCheckout(deps, gateway, partnerId, storeId, await deps.api.subscription(gateway.keys, answer.subscriptionId), answer.paymentId)
    return applied ? { ok: true, value: applied } : { ok: false, reason: 'PAYMENT_FAILED' }
  } catch (error) {
    return refusalOf(error)
  }
}

// ---- Ending a subscription ----

/** Close my store: Razorpay charges nothing after the period paid for. */
export const cancelSubscription = async (deps: PlanBillingDeps, partnerId: string, subscriptionId: string, mode: GatewayMode): Promise<CheckoutResult<Date | null>> => {
  const gateway = await openGateway(deps, partnerId, mode)
  if (!gateway) return { ok: false, reason: 'BILLED_BY_PARTNER' }
  try {
    const s = await deps.api.cancelAtCycleEnd(gateway.keys, subscriptionId)
    return { ok: true, value: dateOf(s.current_end) }
  } catch (error) {
    return refusalOf(error)
  }
}

// ---- What tells the platform to look ----

/** A webhook on the partner's own address: whichever of its keys signed it names the subscription, which is read back. */
export const settleFromRazorpayWebhook = async (deps: PlanBillingDeps, partnerId: string, body: string, signature: string): Promise<'settled' | 'ignored' | 'invalid'> => {
  for (const mode of ['live', 'test'] as const) {
    const gateway = await openGateway(deps, partnerId, mode)
    if (!gateway) continue
    const read = await deps.api.webhookSubscription(gateway.keys, body, signature)
    if (!read.valid) continue
    if (!read.subscriptionId) return 'ignored'
    const followed = await followSubscription(deps, gateway, partnerId, await deps.api.subscription(gateway.keys, read.subscriptionId))
    return followed === 'unknown' ? 'ignored' : 'settled'
  }
  return 'invalid'
}

/** The hourly backstop for a missed webhook: each store whose period ended in the last week is read back from Razorpay. */
export const followEndedSubscriptions = async (deps: PlanBillingDeps): Promise<number> => {
  const at = deps.now()
  const gateways = new Map<string, Promise<Gateway | null>>()
  let followed = 0
  for await (const store of storesEnding(deps.sql, new Date(at.getTime() - backstopMs), at)) {
    const key = `${store.partner_id}:${store.razorpay_mode}`
    if (!gateways.has(key)) gateways.set(key, openGateway(deps, store.partner_id, store.razorpay_mode))
    const gateway = await gateways.get(key)
    if (!gateway) continue
    try {
      if ((await followSubscription(deps, gateway, store.partner_id, await deps.api.subscription(gateway.keys, store.razorpay_subscription_id))) !== 'unknown') followed += 1
    } catch (error) {
      if (!(error instanceof PaymentUnavailable || error instanceof PaymentRefused)) throw error
    }
  }
  return followed
}

/** The reminder the day before a renewal, once per period, naming a change scheduled for it (SAAS §7.4). */
export const queueRenewalReminders = async (sql: postgres.Sql, now: Date): Promise<number> => {
  let queued = 0
  for await (const due of storesEnding(sql, new Date(now.getTime() + dayMs), new Date(now.getTime() + remindAheadMs))) {
    queued += await withSystemScope(sql, async (tx) => {
      const sub = await selectBillingSubscription(tx, due.store_id)
      if (!sub) return 0
      const scheduled = sub.next_plan_id && sub.next_plan_version !== null && sub.change_at && sub.change_at.getTime() <= sub.period_end.getTime()
      const amount = scheduled ? await selectPlanPrice(tx, sub.next_plan_id ?? '', sub.next_plan_version ?? 1, sub.currency, sub.next_interval ?? sub.interval) : sub.amount
      if (!amount) return 0
      await queueSideEffect(tx, {
        kind: 'email',
        idempotencyKey: `plan-renewal-reminder:${sub.store_id}:${sub.period_end.toISOString()}`,
        payload: { template: 'plan-renewal-reminder', storeId: sub.store_id, plan: scheduled ? (sub.next_plan_name ?? sub.plan_name) : sub.plan_name, amount: String(amount), currency: sub.currency, method: savedMethodOf(sub), at: sub.period_end.toISOString() },
        partnerId: sub.partner_id,
        storeId: sub.store_id,
      })
      return 1
    })
  }
  return queued
}

/** Every store ending in the window, a page at a time, so one run reaches all of them (up to sweepPages). */
async function* storesEnding(sql: postgres.Sql, from: Date, until: Date): AsyncGenerator<RazorpayStoreEnding> {
  let after: { periodEnd: Date; storeId: string } | null = null
  for (let page = 0; page < sweepPages; page += 1) {
    const rows = await withSystemScope(sql, (tx) => selectRazorpayStoresEnding(tx, from, until, sweepSize, after))
    yield* rows
    const last = rows.at(-1)
    if (!last || rows.length < sweepSize) return
    after = { periodEnd: last.period_end, storeId: last.store_id }
  }
}

/** The method a store's subscription charges, as stored (db/scoped/razorpayBilling saveRazorpaySubscription). */
export const savedMethodOf = (s: { payment_method_brand: string | null; payment_method_last4: string | null; payment_method_label: string | null }): PlanMethod | null => {
  if (s.payment_method_brand === 'upi' && s.payment_method_label) return { kind: 'upi', handle: s.payment_method_label }
  return s.payment_method_last4 ? { kind: 'card', brand: s.payment_method_brand ?? '', last4: s.payment_method_last4 } : null
}
