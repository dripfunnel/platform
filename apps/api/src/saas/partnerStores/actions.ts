import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { StoreRow, StoreStatus } from '#db/schema/saas'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { selectCurrentVersions, selectLivePlanChoices } from '#db/scoped/partnerPlans'
import { amountKeys } from '#db/scoped/plans'
import {
  extendSubscriptionTrial,
  insertLimitOverride,
  insertTrialExtension,
  moveSubscriptionNow,
  removeLimitOverride,
  scheduleSubscriptionMove,
  selectStoreAccount,
  selectSubscriptionForUpdate,
  type SubscriptionRow,
} from '#db/scoped/storeAccount'
import {
  restartJobStep,
  selectLatestJobForUpdate,
  selectStoreForUpdate,
  selectStoreListRow,
  updateStorePlan,
  updateStoreStatus,
  type StoreListRow,
} from '#db/scoped/stores'
import { queueSideEffect } from '#saas/outbox/index'
import { setupStateOf } from '#saas/provisioning/index'
import { reasonText } from '#saas/staff/index'
import { reissueOwnerInvitation, transitionStore } from '#saas/stores/index'
import { actionsFor, type ActionRefusal, type StoreAction } from './verdicts'
import { prorate, signed, type Proration } from './proration'

// The store actions of FIRST-RELEASE §6.4 (card #160). Each one asks `actionsFor` on the locked
// row, so a mutation refuses exactly what `store(id)`'s block shows.

export const storeActionAudit = {
  changeStorePlan: 'store.plan_changed',
  extendTrial: 'store.trial_extended',
  addLimitOverride: 'store.limit_override_added',
  removeLimitOverride: 'store.limit_override_removed',
  suspendStore: 'store.suspended',
  restoreStore: 'store.restored',
  resendStoreOwnerInvite: 'store.invitation_resent',
  retryProvisioningStep: 'store.setup_step_retried',
} as const

export type StateRefusal = 'NOT_ON_TRIAL' | 'ALREADY_SUSPENDED' | 'NOT_SUSPENDED' | 'CANCELLED' | 'NOT_STUCK' | 'NO_PENDING_INVITATION'
export type InputRefusal = 'NOT_FOUND' | 'INVALID_INPUT' | 'PLAN_NOT_LIVE' | 'SAME_PLAN' | 'UNPRICED_CURRENCY'
export type StoreActionRefusal = ActionRefusal | StateRefusal | InputRefusal
export type StoreActionResult<T = object> = ({ ok: true } & T) | { ok: false; reason: StoreActionRefusal }

// Why an action the state does not offer is refused (§6.4 "Offered when").
const absentReason = (action: StoreAction, status: StoreStatus): StateRefusal => {
  switch (action) {
    case 'extendTrial':
      return 'NOT_ON_TRIAL'
    case 'restore':
      return 'NOT_SUSPENDED'
    case 'suspend':
      return status === 'suspended' ? 'ALREADY_SUSPENDED' : 'CANCELLED'
    case 'retryStep':
      return 'NOT_STUCK'
    default:
      return 'CANCELLED'
  }
}

// The suspend reason is shown to the merchant (§6.4): plain text, no control characters.
const merchantText = reasonText.refine((text) => !/[\p{Cc}<>]/u.test(text))
const id = z.guid()
const planChange = z.strictObject({ planId: z.guid(), when: z.enum(['next', 'now']), reason: reasonText })
const trialChange = z.strictObject({ days: z.union([z.literal(3), z.literal(7), z.literal(14)]), reason: reasonText })
const overrideInput = z.strictObject({
  limit: z.enum(amountKeys),
  amount: z.number().int().min(1).max(1_000_000),
  duration: z.enum(['month', 'always']),
  reason: reasonText,
})
const overrideRemoval = z.strictObject({ overrideId: z.guid(), reason: reasonText })

const priceIn = (prices: readonly { currency: string; monthly: number | null; yearly: number | null }[], currency: string, interval: 'month' | 'year') => {
  const price = prices.find((p) => p.currency === currency)
  return (interval === 'year' ? price?.yearly : price?.monthly) ?? null
}

// Before billing subscribes a store (#201) its currency is SAAS §6.1's default.
const defaultCurrency = 'USD'

// What "from the next billing date" means for a subscription: the trial's end, else the period's.
const nextBillingOf = (sub: SubscriptionRow): Date => (sub.status === 'trial' && sub.trial_ends_at ? sub.trial_ends_at : sub.period_end)

const prorationOf = (sub: SubscriptionRow, amount: number, at: Date): Proration =>
  sub.status === 'trial' ? { kind: 'none' } : prorate(sub.amount, amount, { start: sub.period_start, end: sub.period_end }, at)

export interface PartnerStoreActionsDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

export const createPartnerStoreActions = ({ sql, caller, facts, activity, now }: PartnerStoreActionsDeps) => {
  const partnerId = caller.partner.id
  const context = { caller: { kind: 'partner-user' as const, partnerUserId: caller.user.id }, partnerId }
  const by = { kind: 'partner_user' as const, label: caller.user.name }

  const entry = (store: StoreRow, action: string, reason: string | null, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'partner_user',
    actorId: caller.user.id,
    actorLabel: `${caller.user.name} <${caller.user.email}>`,
    partnerId,
    storeId: store.id,
    target: { type: 'store', id: store.id, label: store.name ?? '' },
    changes: [],
    reason,
    api: 'platform',
    visibility: 'partner',
    ...facts,
    ...extra,
  })

  /** Locks the partner's own store, then answers as its permission block does before `work` runs. */
  const act = <T extends object>(
    storeId: string,
    action: StoreAction,
    work: (tx: ScopedSql, store: StoreRow, row: StoreListRow, at: Date) => Promise<StoreActionResult<T>>,
  ): Promise<StoreActionResult<T>> => {
    if (!id.safeParse(storeId).success) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    return withScope(sql, context, async (tx): Promise<StoreActionResult<T>> => {
      const at = now()
      const store = await selectStoreForUpdate(tx, storeId)
      const row = store ? await selectStoreListRow(tx, storeId, at) : null
      if (!store || !row || store.partner_id !== partnerId) return { ok: false, reason: 'NOT_FOUND' }
      const verdict = actionsFor(row, caller.user.role, at)[action]
      if (!verdict) return { ok: false, reason: absentReason(action, store.status) }
      if (!verdict.allowed) return { ok: false, reason: verdict.reason }
      return work(tx, store, row, at)
    })
  }

  type PlanOption = { id: string; name: string; version: number; price: { amount: number; currency: string }; proration: Proration }
  type Options = { plans: PlanOption[]; nextBillingAt: Date | null }

  // The Live plans priced in the store's currency, each with what moving now would prorate.
  const planOptions = async (tx: ScopedSql, store: StoreRow, sub: SubscriptionRow | null, at: Date): Promise<Options> => {
    const choices = await selectLivePlanChoices(tx, partnerId, store.plan_id)
    const versions = await selectCurrentVersions(tx, choices.map((c) => c.id))
    const plans = choices.flatMap((c): PlanOption[] => {
      const prices = versions.get(c.id)?.prices ?? []
      const currency = sub?.currency ?? defaultCurrency
      const amount = priceIn(prices, currency, sub?.interval ?? 'month')
      if (amount === null) return []
      return [{ id: c.id, name: c.name, version: c.version, price: { amount, currency }, proration: sub ? prorationOf(sub, amount, at) : { kind: 'none' } }]
    })
    return { plans, nextBillingAt: sub ? nextBillingOf(sub) : store.trial_ends_at }
  }

  const changePlanOptions = (storeId: string): Promise<StoreActionResult<Options>> =>
    act(storeId, 'changePlan', async (tx, store, _row, at) => ({ ok: true, ...(await planOptions(tx, store, (await selectStoreAccount(tx, store.id)).subscription, at)) }))

  const changeStorePlan = (storeId: string, raw: unknown): Promise<StoreActionResult<{ proration: Proration; currency: string }>> => {
    const parsed = planChange.safeParse(raw)
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    const { planId, when, reason } = parsed.data
    return act<{ proration: Proration; currency: string }>(storeId, 'changePlan', async (tx, store, _row, at) => {
      if (planId === store.plan_id) return { ok: false, reason: 'SAME_PLAN' }
      const sub = await selectSubscriptionForUpdate(tx, store.id)
      const live = (await selectLivePlanChoices(tx, partnerId, null)).find((p) => p.id === planId)
      if (!live) return { ok: false, reason: 'PLAN_NOT_LIVE' }
      const option = (await planOptions(tx, store, sub, at)).plans.find((p) => p.id === planId)
      if (!option) return { ok: false, reason: 'UNPRICED_CURRENCY' }
      // Without a subscription nothing is billed yet: the store takes the plan now, and billing
      // (#201) subscribes it to the plan's version then.
      const proration = sub && when === 'now' ? option.proration : { kind: 'none' as const }
      if (sub && when === 'next') {
        await scheduleSubscriptionMove(tx, store.id, planId, option.version, nextBillingOf(sub))
      } else {
        if (sub) await moveSubscriptionNow(tx, store.id, planId, signed(proration), at)
        await updateStorePlan(tx, store.id, planId)
      }
      await activity.record(
        tx,
        entry(store, storeActionAudit.changeStorePlan, reason, {
          changes: [
            { field: 'plan', before: store.plan_id, after: planId },
            { field: 'when', before: null, after: when },
          ],
        }),
      )
      await queueSideEffect(tx, {
        kind: 'email',
        idempotencyKey: `store-plan-changed:${store.id}:${at.toISOString()}`,
        payload: { template: 'store-plan-changed', storeId: store.id, planId, when, contact: 'partner-support' },
        partnerId,
        storeId: store.id,
      })
      return { ok: true, proration, currency: option.price.currency }
    })
  }

  const extendTrial = (storeId: string, raw: unknown): Promise<StoreActionResult<{ trialEndsAt: Date }>> => {
    const parsed = trialChange.safeParse(raw)
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    const { days, reason } = parsed.data
    return act(storeId, 'extendTrial', async (tx, store, _row, at) => {
      const from = store.trial_ends_at && store.trial_ends_at > at ? store.trial_ends_at : at
      const trialEndsAt = new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
      await updateStoreStatus(tx, store.id, { status: 'trial', trialEndsAt })
      await extendSubscriptionTrial(tx, store.id, trialEndsAt)
      await insertTrialExtension(tx, { storeId: store.id, days, endsAt: trialEndsAt, reason, by, at })
      await activity.record(
        tx,
        entry(store, storeActionAudit.extendTrial, reason, { changes: [{ field: 'trial_ends_at', before: store.trial_ends_at?.toISOString() ?? null, after: trialEndsAt.toISOString() }] }),
      )
      return { ok: true, trialEndsAt }
    })
  }

  const addLimitOverride = (storeId: string, raw: unknown): Promise<StoreActionResult<{ overrideId: string }>> => {
    const parsed = overrideInput.safeParse(raw)
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    const o = parsed.data
    return act(storeId, 'addOverride', async (tx, store, _row, at) => {
      const month = o.duration === 'month' ? new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)) : null
      const overrideId = await insertLimitOverride(tx, { storeId: store.id, key: o.limit, amount: o.amount, duration: o.duration, month, reason: o.reason, by, at })
      await activity.record(
        tx,
        entry(store, storeActionAudit.addLimitOverride, o.reason, {
          target: { type: 'limit_override', id: overrideId, label: store.name ?? '' },
          changes: [{ field: o.limit, before: null, after: `+${o.amount} ${o.duration}` }],
        }),
      )
      return { ok: true, overrideId }
    })
  }

  const removeOverride = (storeId: string, raw: unknown): Promise<StoreActionResult> => {
    const parsed = overrideRemoval.safeParse(raw)
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    const { overrideId, reason } = parsed.data
    return act<object>(storeId, 'addOverride', async (tx, store, _row, at) => {
      const removed = await removeLimitOverride(tx, store.id, overrideId, by.label, at)
      if (!removed) return { ok: false, reason: 'NOT_FOUND' }
      await activity.record(
        tx,
        entry(store, storeActionAudit.removeLimitOverride, reason, {
          target: { type: 'limit_override', id: overrideId, label: store.name ?? '' },
          changes: [{ field: removed.key, before: `+${removed.amount} ${removed.duration}`, after: null }],
        }),
      )
      return { ok: true }
    })
  }

  const suspendStore = (storeId: string, rawReason: unknown): Promise<StoreActionResult> => {
    const parsed = merchantText.safeParse(rawReason)
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    const reason = parsed.data
    return act<object>(storeId, 'suspend', async (tx, store, _row, at) => {
      const result = await transitionStore(tx, store, { to: 'suspended', reason, by: caller.partner.name }, at)
      if (!result.ok) return { ok: false, reason: 'ALREADY_SUSPENDED' }
      await activity.record(tx, entry(store, storeActionAudit.suspendStore, reason, { changes: [{ field: 'status', before: store.status, after: 'suspended' }] }))
      // SAAS §4.2: the Owner is told and pointed at the partner's support; billing reads the
      // suspended status and charges nothing until restored (§4.3, #201).
      await queueSideEffect(tx, {
        kind: 'email',
        idempotencyKey: `store-suspended:${store.id}:${at.toISOString()}`,
        payload: { template: 'store-suspended', storeId: store.id, reason, contact: 'partner-support' },
        partnerId,
        storeId: store.id,
      })
      await queueSideEffect(tx, {
        kind: 'cache.purge',
        idempotencyKey: `store-degraded:${store.id}:suspended:${at.toISOString()}`,
        payload: { storeId: store.id, rule: 'suspended' },
        partnerId,
        storeId: store.id,
      })
      return { ok: true }
    })
  }

  const restoreStore = (storeId: string, rawReason: unknown): Promise<StoreActionResult<{ status: StoreStatus }>> => {
    const parsed = reasonText.safeParse(rawReason)
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    const reason = parsed.data
    return act<{ status: StoreStatus }>(storeId, 'restore', async (tx, store, _row, at) => {
      const result = await transitionStore(tx, store, { to: 'restored' }, at)
      if (!result.ok) return { ok: false, reason: 'NOT_SUSPENDED' }
      await activity.record(tx, entry(store, storeActionAudit.restoreStore, reason, { changes: [{ field: 'status', before: 'suspended', after: result.status }] }))
      await queueSideEffect(tx, {
        kind: 'email',
        idempotencyKey: `store-restored:${store.id}:${at.toISOString()}`,
        payload: { template: 'store-restored', storeId: store.id, contact: 'partner-support' },
        partnerId,
        storeId: store.id,
      })
      await queueSideEffect(tx, {
        kind: 'cache.purge',
        idempotencyKey: `store-degraded:${store.id}:restored:${at.toISOString()}`,
        payload: { storeId: store.id, rule: 'restored' },
        partnerId,
        storeId: store.id,
      })
      return { ok: true, status: result.status }
    })
  }

  const resendStoreOwnerInvite = (storeId: string): Promise<StoreActionResult> =>
    act<object>(storeId, 'resendInvite', async (tx, store, _row, at) => {
      const reissued = await reissueOwnerInvitation(tx, store, caller.partner.name, at)
      if (!reissued) return { ok: false, reason: 'NO_PENDING_INVITATION' }
      await activity.record(tx, entry(store, storeActionAudit.resendStoreOwnerInvite, null, { target: { type: 'invitation', id: reissued.invitationId, label: reissued.email } }))
      return { ok: true }
    })

  // The block offers this only for a stuck or failed step, so a second call finds the step
  // running again and is refused: one restart, one queued run.
  const retryProvisioningStep = (storeId: string): Promise<StoreActionResult> =>
    act<object>(storeId, 'retryStep', async (tx, store, _row, at) => {
      const job = await selectLatestJobForUpdate(tx, store.id)
      const state = job ? setupStateOf(job, at) : null
      if (!job || (state !== 'stuck' && state !== 'failed')) return { ok: false, reason: 'NOT_STUCK' }
      const attempt = await restartJobStep(tx, job.id, at)
      await queueSideEffect(tx, {
        kind: 'provisioning.retry',
        idempotencyKey: `provisioning-retry:${job.id}:${attempt}`,
        payload: { jobId: job.id, step: job.step, attempt },
        partnerId,
        storeId: store.id,
      })
      await activity.record(
        tx,
        entry(store, storeActionAudit.retryProvisioningStep, null, { target: { type: 'job', id: job.id, label: job.step }, changes: [{ field: 'state', before: job.state, after: 'running' }] }),
      )
      return { ok: true }
    })

  return { changePlanOptions, changeStorePlan, extendTrial, addLimitOverride, removeLimitOverride: removeOverride, suspendStore, restoreStore, resendStoreOwnerInvite, retryProvisioningStep }
}

export type PartnerStoreActions = ReturnType<typeof createPartnerStoreActions>
