import type { ProvisioningStep } from '#db/schema/saas'
import type { ScopedSql } from '#db/scoped/index'
import { insertNewSubscription, insertPartnerStore, lockPartnerStores } from '#db/scoped/partnerCreateStore'
import { finishJob, insertActiveOwnerMembership, insertRunningJob, insertSignupUser, moveJobTo, selectSignupPlan, storeCodeTaken } from '#db/scoped/signup'
import { addMonth } from '#saas/partnerStores/create'
import { stepsFor } from './stuck'

// SAAS.md §5's first three steps for a merchant's own sign-up. All database writes, so one transaction:
// a failure anywhere leaves nothing. INF 1 adds steps 4–8, with compensations, as the Workflow.

export interface ProvisionInput {
  partnerId: string
  owner: { name: string; email: string; passwordHash: string; phone: string }
  store: { name: string; code: string; country: string; currency: string }
}

export type ProvisionResult = { ok: true; storeId: string; userId: string } | { ok: false; reason: 'NO_PLAN' | 'SUBDOMAIN_TAKEN' }

/** A plan with no trial of its own still starts in Trial: a self sign-up never begins with a bill. */
export const fallbackTrialDays = 14
const day = 24 * 60 * 60 * 1000

/** Tests name a step to fail at, to prove a failure there leaves no store behind (SAAS.md §5). */
export type FailAt = (step: ProvisioningStep) => void

export const provisionStore = async (tx: ScopedSql, input: ProvisionInput, at: Date, failAt: FailAt = () => undefined): Promise<ProvisionResult> => {
  // One creation at a time per partner, as the console's: the web address is checked under it.
  await lockPartnerStores(tx, input.partnerId)
  if (await storeCodeTaken(tx, input.partnerId, input.store.code)) return { ok: false, reason: 'SUBDOMAIN_TAKEN' }
  const plan = await selectSignupPlan(tx, input.partnerId, input.store.currency)
  if (!plan) return { ok: false, reason: 'NO_PLAN' }
  const trialEndsAt = new Date(at.getTime() + (plan.trial_days > 0 ? plan.trial_days : fallbackTrialDays) * day)

  // 1. Account and store.
  failAt('accountAndStore')
  const userId = await insertSignupUser(tx, { partnerId: input.partnerId, ...input.owner, now: at })
  const storeId = await insertPartnerStore(tx, { partnerId: input.partnerId, name: input.store.name, code: input.store.code, country: input.store.country, status: 'trial', planId: plan.id, trialEndsAt, createdAt: at })
  await insertActiveOwnerMembership(tx, userId, storeId)
  await insertNewSubscription(tx, { storeId, partnerId: input.partnerId, planId: plan.id, planVersion: plan.version, status: 'trial', currency: input.store.currency, amount: plan.monthly, periodStart: at, periodEnd: addMonth(at), trialEndsAt })
  const steps = stepsFor('own')
  const jobId = await insertRunningJob(tx, storeId, steps, at)

  // 2. Defaults: each per-store settings table adds its rows here as its card builds it.
  await moveJobTo(tx, jobId, 'defaults', at)
  failAt('defaults')

  // 3. Hostnames: `{code}.preview` and `{code}.shops` live under the partner's wildcards, so the code is the reservation.
  await moveJobTo(tx, jobId, 'hostnames', at)
  failAt('hostnames')

  await finishJob(tx, jobId, at)
  return { ok: true, storeId, userId }
}
