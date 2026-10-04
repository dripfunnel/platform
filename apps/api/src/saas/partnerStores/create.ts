import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { actingName, type PartnerCaller, partnerContextOf } from '#auth/partnerCaller'
import { partnerRoleHas, type PartnerRole } from '#auth/partnerPermissions'
import { countriesIn, countryOf } from '#core/countries'
import { withScope } from '#db/scoped/index'
import {
  freeStoreCode,
  insertFinishedJob,
  insertNewSubscription,
  insertOwnerMembership,
  insertPartnerStore,
  lockPartnerStores,
  ownerPerson,
  selectCreatablePlans,
  selectProvisioning,
  type ProvisioningRow,
} from '#db/scoped/partnerCreateStore'
import { selectBillingMode } from '#db/scoped/partnerConsole'
import { selectPartner } from '#db/scoped/partners'
import { insertStoreInvitation } from '#db/scoped/stores'
import { partnerEntry } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { stepsFor } from '#saas/provisioning/index'

// Creating a store for a merchant the partner signed (ui/platform/FIRST-RELEASE.md §6.2, SAAS.md
// §5; card #221) and the five steps the screen polls.

const trialOptions = [0, 7, 14, 30] as const
const invitationDays = 7
const day = 24 * 60 * 60 * 1000

const createStoreInput = z.strictObject({
  name: z.string().trim().min(1).max(80),
  ownerName: z.string().trim().min(1).max(80),
  ownerEmail: z.email().max(254),
  country: z.string().regex(/^[A-Z]{2}$/),
  planId: z.guid(),
  trialDays: z.literal(trialOptions),
})

export type CreateRefusal = 'OWNERS_AND_ADMINS_ONLY' | 'PARTNER_NOT_LIVE' | 'PARTNER_PAUSED' | 'INVALID_INPUT'
export type CreatePermission = { allowed: true } | { allowed: false; reason: Exclude<CreateRefusal, 'INVALID_INPUT'> }
type CreateResult = { ok: true; storeId: string } | { ok: false; reason: CreateRefusal; field?: string }

export const createAudit = 'store.created'

// SAAS §5's steps as the screen's five (FIRST-RELEASE §6.2). The storefront has no runner yet,
// so it waits (decided on #159) and only an own storefront counts as done.
export const provisioningKeys = ['account', 'store', 'portal', 'storefront', 'done'] as const
type StepState = 'done' | 'running' | 'waiting' | 'failed'

/** A short, readable code from the name: letters and digits joined by hyphens. */
export const codeFrom = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'store'

/** A month on, the day kept within the next month: 31 January gives 28 or 29 February. */
export const addMonth = (d: Date): Date => {
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)).getUTCDate()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()))
}

export const progressOf = (row: ProvisioningRow, now: Date) => {
  const job = (step: string): StepState => {
    if (!row.steps || !row.state) return 'waiting'
    if (row.state === 'done') return 'done'
    const at = row.steps.indexOf(step)
    const current = row.step ? row.steps.indexOf(row.step) : -1
    if (at < current) return 'done'
    if (at > current) return 'waiting'
    return row.state === 'failed' ? 'failed' : 'running'
  }
  const storefront: StepState = row.storefront_kind === 'own' ? 'done' : row.build_state === 'live' ? 'done' : row.build_state === 'failed' ? 'failed' : row.build_state === 'building' ? 'running' : 'waiting'
  const account = row.state === 'done'
  const states: Record<(typeof provisioningKeys)[number], StepState> = {
    account: job('accountAndStore'),
    store: job('defaults'),
    portal: job('hostnames'),
    storefront,
    done: account ? 'done' : 'waiting',
  }
  const started = row.started_at ?? row.created_at
  return {
    steps: provisioningKeys.map((key) => ({ key, state: states[key] })),
    done: account,
    elapsedSeconds: Math.max(0, Math.round(((row.finished_at ?? now).getTime() - started.getTime()) / 1000)),
  }
}

/** The role first, then the partner's state as stored now (FIRST-RELEASE §6.2). */
export const createPermissionFor = (role: PartnerRole, state: string | null): CreatePermission => {
  if (!partnerRoleHas(role, 'stores.create')) return { allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' }
  if (state === 'paused') return { allowed: false, reason: 'PARTNER_PAUSED' }
  if (state !== 'live') return { allowed: false, reason: 'PARTNER_NOT_LIVE' }
  return { allowed: true }
}

export interface PartnerCreateStoreDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

export const createPartnerCreateStore = ({ sql, caller, facts, activity, now }: PartnerCreateStoreDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)

  const permissionFor = (state: string | null) => createPermissionFor(caller.role, state)

  const createStoreForm = () =>
    withScope(sql, context, async (tx) => {
      const partner = await selectPartner(tx, partnerId)
      const plans = await selectCreatablePlans(tx, partnerId)
      return {
        permission: permissionFor(partner?.state ?? null),
        countries: countriesIn(new Set(plans.flatMap((p) => p.prices.map((x) => x.currency)))),
        plans: plans.map((p) => ({ id: p.id, name: p.name, trialDays: p.trial_days, prices: p.prices.map((x) => ({ amount: x.monthly, currency: x.currency })) })),
        trials: [...trialOptions],
        billingMode: await selectBillingMode(tx, partnerId),
      }
    })

  const createStore = (raw: unknown): Promise<CreateResult> => {
    const parsed = createStoreInput.safeParse(raw)
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT', field: String(parsed.error.issues[0]?.path[0] ?? '') })
    const input = parsed.data
    return withScope(sql, context, async (tx): Promise<CreateResult> => {
      // One creation at a time per partner: the code and the owner's account are chosen under it.
      await lockPartnerStores(tx, partnerId)
      const permission = permissionFor((await selectPartner(tx, partnerId))?.state ?? null)
      if (!permission.allowed) return { ok: false, reason: permission.reason }
      const [plan] = await selectCreatablePlans(tx, partnerId, input.planId)
      if (!plan) return { ok: false, reason: 'INVALID_INPUT', field: 'planId' }
      const country = countryOf(input.country)
      const price = country ? plan.prices.find((p) => p.currency === country.currency) : undefined
      if (!country || !price) return { ok: false, reason: 'INVALID_INPUT', field: 'country' }
      const at = now()
      const trialEndsAt = input.trialDays > 0 ? new Date(at.getTime() + input.trialDays * day) : null
      const status = trialEndsAt ? 'trial' : 'active'
      const ownerId = await ownerPerson(tx, partnerId, input.ownerEmail, input.ownerName)
      if (!ownerId) return { ok: false, reason: 'INVALID_INPUT', field: 'ownerEmail' }
      const storeId = await insertPartnerStore(tx, {
        partnerId,
        name: input.name,
        code: await freeStoreCode(tx, partnerId, codeFrom(input.name)),
        country: country.code,
        planId: plan.id,
        status,
        trialEndsAt,
        createdAt: at,
      })
      await insertOwnerMembership(tx, ownerId, storeId)
      await insertNewSubscription(tx, {
        storeId,
        partnerId,
        planId: plan.id,
        planVersion: plan.version,
        status,
        currency: country.currency,
        amount: price.monthly,
        periodStart: at,
        periodEnd: trialEndsAt ?? addMonth(at),
        trialEndsAt,
      })
      // Account, store and portal: what each does today is these rows (SAAS §5); the storefront
      // steps wait for their runner, so they are not this job's.
      await insertFinishedJob(tx, storeId, stepsFor('own'), at)
      const invitationId = await insertStoreInvitation(tx, { storeId, email: input.ownerEmail, role: 'owner', expiresAt: new Date(at.getTime() + invitationDays * day), invitedByLabel: actingName(caller) })
      await queueSideEffect(tx, {
        kind: 'email',
        idempotencyKey: `store-owner-invitation:${invitationId}`,
        payload: { template: 'store-owner-invitation', invitationId, to: input.ownerEmail, storeId },
        partnerId,
        storeId,
      })
      await activity.record(
        tx,
        partnerEntry(caller, facts)({
          action: createAudit,
          storeId,
          target: { type: 'store', id: storeId, label: input.name },
          reason: null,
          changes: [
            { field: 'plan', before: null, after: plan.id },
            { field: 'owner', before: null, after: ownerId },
            { field: 'trial_days', before: null, after: String(input.trialDays) },
          ],
        }),
      )
      return { ok: true, storeId }
    })
  }

  const provisioning = (storeId: string) => {
    if (!z.guid().safeParse(storeId).success) return Promise.resolve(null)
    return withScope(sql, context, async (tx) => {
      const row = await selectProvisioning(tx, partnerId, storeId)
      return row ? progressOf(row, now()) : null
    })
  }

  return { createStoreForm, createStore, provisioning }
}

export type PartnerCreateStore = ReturnType<typeof createPartnerCreateStore>
