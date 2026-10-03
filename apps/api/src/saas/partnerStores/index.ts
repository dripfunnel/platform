import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'
import { partnerRoleHas, type PartnerPermission, type PartnerRole } from '#auth/partnerPermissions'
import type { StoreStatus } from '#db/schema/saas'
import { maxPageSize, withScope, type ScopedSql } from '#db/scoped/index'
import { selectBillingMode, selectPlanChoices } from '#db/scoped/partnerConsole'
import { selectPartner, selectPartnerDomainsFor } from '#db/scoped/partners'
import { selectOverrides, selectStoreAccount, selectTrialExtensions } from '#db/scoped/storeAccount'
import { selectCustomDomains, selectStoreCounts, selectStoreListRow, selectStorePeople, selectStores, selectStoreUsage, updateStoreBillingStatus, type StoreListRow } from '#db/scoped/stores'
import { listActivity, type PageInfo } from '#saas/activity/index'
import { setupStateOf, stuckAfterMinutes } from '#saas/provisioning/stuck'
import { decodePage, pageOf, type PageRequest } from '#saas/staff/actions'

// Stores on the Platform API (ui/platform/FIRST-RELEASE.md §6.1, §6.3, §6.4; card #159): the
// partner's merchants at account level, never an order, a customer or a product.

export const storePageSize = 25
const detailListSize = 25
const day = 24 * 60 * 60 * 1000

export const storeFilter = z.strictObject({
  status: z.enum(['trial', 'active', 'pastdue', 'suspended', 'cancelled']).optional(),
  plan: z.guid().optional(),
  created: z.enum(['month', '30d', '90d']).optional(),
  storefront: z.enum(['live', 'building', 'failed', 'own']).optional(),
  near: z.literal('yes').optional(),
  q: z.string().trim().min(1).max(100).optional(),
})
export type StoreFilterInput = z.infer<typeof storeFilter>

export type StoreState =
  | { kind: 'trial'; trialEndsAt: Date | null; daysLeft: number | null }
  | { kind: 'active' }
  | { kind: 'pastdue'; daysPastDue: number }
  | { kind: 'suspended'; reason: string }
  | { kind: 'cancelled'; since: Date | null }

export type ActionRefusal = 'OWNERS_AND_ADMINS_ONLY' | 'FINANCE_TRIAL_ONLY' | 'BILLING_ROLES_ONLY'
export type ActionPermission = { allowed: true } | { allowed: false; reason: ActionRefusal }
export const storeActions = ['changePlan', 'extendTrial', 'addOverride', 'resendInvite', 'restore', 'suspend', 'retryStep'] as const
export type StoreAction = (typeof storeActions)[number]

export interface StoreRowDto {
  id: string
  name: string
  code: string
  owner: { name: string | null; email: string | null }
  plan: { id: string; name: string } | null
  near: { percent: number; limit: string } | null
  state: StoreState
  storefront: 'live' | 'building' | 'failed' | 'own'
  domain: { host: string; custom: boolean; status: string } | null
  createdAt: Date
  billingStatus: 'active' | 'past_due' | 'suspended' | null
}

export interface StorePageDto {
  items: StoreRowDto[]
  pageInfo: PageInfo
  plans: { id: string; name: string }[]
  billingMode: 'dripfunnel' | 'own'
  actions: { export: ActionPermission; billingStatus: ActionPermission | null }
}

const pastDueDays = (row: StoreListRow, now: Date) => (row.past_due_since ? Math.max(1, Math.ceil((now.getTime() - row.past_due_since.getTime()) / day)) : 0)

export const stateOf = (row: Pick<StoreListRow, 'status' | 'trial_ends_at' | 'past_due_since' | 'suspended_reason' | 'cancelled_at'>, now: Date): StoreState => {
  switch (row.status) {
    case 'trial':
      return { kind: 'trial', trialEndsAt: row.trial_ends_at, daysLeft: row.trial_ends_at ? Math.max(0, Math.ceil((row.trial_ends_at.getTime() - now.getTime()) / day)) : null }
    case 'past_due':
      return { kind: 'pastdue', daysPastDue: pastDueDays(row as StoreListRow, now) }
    case 'suspended':
      return { kind: 'suspended', reason: row.suspended_reason ?? '' }
    case 'cancelled':
    case 'closed':
      return { kind: 'cancelled', since: row.cancelled_at }
    default:
      return { kind: 'active' }
  }
}

// FIRST-RELEASE §6.4 "Offered when", then the permission each needs (ACCESS.md §5.3): an action
// the state does not offer is absent; one the role cannot use is present and refused.
export const storeActionPermission: Record<StoreAction, PartnerPermission> = {
  changePlan: 'stores.plan',
  extendTrial: 'stores.trial',
  addOverride: 'stores.plan',
  resendInvite: 'stores.invite.resend',
  restore: 'stores.suspend',
  suspend: 'stores.suspend',
  retryStep: 'setup.retry',
}

export const actionsFor = (row: StoreListRow, role: PartnerRole, now: Date): Partial<Record<StoreAction, ActionPermission>> => {
  const setup = setupStateOf(row.job_state && row.job_step && row.job_step_started_at ? { state: row.job_state, step: row.job_step, step_started_at: row.job_step_started_at } : null, now)
  const offered: StoreAction[] = [
    ...(row.status !== 'cancelled' && row.status !== 'closed' ? (['changePlan', 'addOverride'] as const) : []),
    ...(row.status === 'trial' ? (['extendTrial'] as const) : []),
    ...(row.status === 'active' || row.status === 'trial' || row.status === 'past_due' ? (['suspend'] as const) : []),
    ...(row.status === 'suspended' ? (['restore'] as const) : []),
    'resendInvite' as const,
    ...(setup === 'stuck' || setup === 'failed' ? (['retryStep'] as const) : []),
  ]
  return Object.fromEntries(
    offered.map((action) => [action, partnerRoleHas(role, storeActionPermission[action]) ? { allowed: true } : { allowed: false, reason: action === 'extendTrial' ? 'FINANCE_TRIAL_ONLY' : 'OWNERS_AND_ADMINS_ONLY' }]),
  )
}

// A closed store reads as cancelled (FIRST-RELEASE §6.1), so the filter takes both.
const statusFor: Record<NonNullable<StoreFilterInput['status']>, StoreStatus | readonly StoreStatus[]> = {
  trial: 'trial',
  active: 'active',
  pastdue: 'past_due',
  suspended: 'suspended',
  cancelled: ['cancelled', 'closed'],
}

export interface PartnerStoresDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

export const createPartnerStoresService = ({ sql, caller, facts, activity, now }: PartnerStoresDeps) => {
  const partnerId = caller.partner.id
  const context = { caller: { kind: 'partner-user' as const, partnerUserId: caller.user.id }, partnerId }
  const role = caller.user.role
  const billers = partnerRoleHas(role, 'stores.billingStatus')

  const rowDto = (row: StoreListRow, mode: 'dripfunnel' | 'own'): StoreRowDto => ({
    id: row.id,
    name: row.name,
    code: row.code,
    owner: { name: row.owner_name, email: row.owner_email },
    plan: row.plan_id && row.plan_name ? { id: row.plan_id, name: row.plan_name } : null,
    near: row.near_key !== null && row.near_percent !== null && row.near_percent >= 80 ? { percent: row.near_percent, limit: row.near_key } : null,
    state: stateOf(row, now()),
    storefront: row.storefront_kind === 'own' ? 'own' : (row.build_state ?? 'building'),
    domain: row.domain_host ? { host: row.domain_host, custom: true, status: row.domain_status ?? 'waiting' } : null,
    createdAt: row.created_at,
    billingStatus: mode === 'own' ? row.billing_status : null,
  })

  const modeOf = (tx: ScopedSql) => selectBillingMode(tx, partnerId)

  /** Null for a filter or cursor it cannot read: refused, never read as no filter. */
  const stores = (rawFilter: unknown, page: PageRequest): Promise<StorePageDto | null> => {
    const parsed = storeFilter.safeParse(rawFilter ?? {})
    if (!parsed.success) return Promise.resolve(null)
    const decoded = decodePage(page, storePageSize)
    if (!decoded.ok) return Promise.resolve(null)
    const f = parsed.data
    const at = now()
    const createdAfter = f.created === undefined ? undefined : f.created === 'month' ? new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)) : new Date(at.getTime() - (f.created === '30d' ? 30 : 90) * day)
    return withScope(sql, context, async (tx) => {
      const rows = await selectStores(
        tx,
        { partnerId, status: f.status ? statusFor[f.status] : undefined, planId: f.plan, createdAfter, storefront: f.storefront, nearLimit: f.near === 'yes', q: f.q },
        decoded,
        decoded.limit,
        stuckAfterMinutes,
        at,
      )
      const { rows: pageRows, pageInfo } = pageOf(rows, decoded, (r) => ({ occurredAt: r.created_at, id: r.id }))
      const mode = await modeOf(tx)
      const plans = await selectPlanChoices(tx, partnerId)
      return {
        items: pageRows.map((r) => rowDto(r, mode)),
        pageInfo,
        plans,
        billingMode: mode,
        actions: {
          export: partnerRoleHas(role, 'exports') ? { allowed: true } : { allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' },
          billingStatus: mode === 'own' ? (billers ? { allowed: true } : { allowed: false, reason: 'BILLING_ROLES_ONLY' }) : null,
        },
      }
    })
  }

  const store = (id: string) =>
    withScope(sql, context, async (tx) => {
      if (!z.guid().safeParse(id).success) return null
      const at = now()
      const row = await selectStoreListRow(tx, id, at)
      if (!row || row.partner_id !== partnerId) return null
      const mode = await modeOf(tx)
      const account = await selectStoreAccount(tx, id)
      const people = await selectStorePeople(tx, id)
      const domains = await selectCustomDomains(tx, id)
      const partner = await selectPartner(tx, partnerId)
      const partnerDomains = await selectPartnerDomainsFor(tx, [partnerId])
      const wildcard = (kind: 'preview' | 'shops') => partnerDomains.find((d) => d.kind === kind)?.host.replace(/^\*\./, '') ?? null
      const activityPage = await listActivity(sql, context, { storeId: id }, { first: detailListSize })
      const overrides = await selectOverrides(tx, id, undefined, detailListSize + 1)
      const extensions = await selectTrialExtensions(tx, id, undefined, detailListSize + 1)
      const counts = await selectStoreCounts(tx, id)
      // The same computation as the list's near-limit, so the two never disagree.
      const measured = row.plan_id ? await selectStoreUsage(tx, id, row.plan_id, at) : []
      const usage = (['products', 'staff', 'suppliers', 'ai_prompts', 'publish_now'] as const).map((key) => {
        const m = measured.find((u) => u.key === key)
        return { limit: key, used: m?.used ?? 0, cap: m?.cap ?? null, percent: m?.percent ?? null, monthly: key === 'ai_prompts' || key === 'publish_now' }
      })
      const merchantSide = people.filter((p) => p.seller_id === null)
      return {
        ...rowDto(row, mode),
        country: row.country,
        price: account.subscription ? { amount: account.subscription.amount, currency: account.subscription.currency } : null,
        people: { count: counts.people, suppliers: counts.suppliers },
        contacts: merchantSide.map((p) => ({ name: p.name, email: p.email, role: p.role_key })),
        usage,
        overrides: overrides.slice(0, detailListSize).map((o) => ({ id: o.id, limit: o.key, amount: o.amount, duration: o.duration, reason: o.reason, by: o.created_by_label, at: o.created_at })),
        billing: {
          interval: account.subscription?.interval ?? null,
          nextChargeAt: account.subscription ? (account.subscription.status === 'trial' ? account.subscription.trial_ends_at : account.subscription.period_end) : null,
          cardLast4: account.subscription?.payment_method_last4 ?? null,
          mode,
          chargedBy: mode === 'own' ? null : `DripFunnel for ${partner?.name ?? caller.partner.name}`,
        },
        site: {
          liveHost: domains.find((d) => d.status === 'live')?.host ?? (wildcard('shops') ? `${row.code}.${wildcard('shops')}` : null),
          previewHost: wildcard('preview') ? `${row.code}.${wildcard('preview')}` : null,
          lastPublishAt: row.last_publish_at,
        },
        records: domains.map((d) => ({ host: d.host, status: d.status, type: 'CNAME', value: d.expected_cname, found: d.found_cname, since: d.created_at })),
        setup: {
          steps: row.job_steps ?? [],
          step: row.job_step,
          state: setupStateOf(row.job_state && row.job_step && row.job_step_started_at ? { state: row.job_state, step: row.job_step, step_started_at: row.job_step_started_at } : null, at),
          error: row.job_last_error,
        },
        trialExtensions: extensions.slice(0, detailListSize).map((e) => ({ days: e.days, endsAt: e.ends_at })),
        support: {
          allowed: row.support_access_allowed,
          people: people.map((p) => ({ id: p.user_id, name: p.name, email: p.email, role: p.role_key, supplier: p.seller_name, status: p.user_status, lastSignInAt: p.last_sign_in_at })),
        },
        activity: activityPage.ok ? activityPage.page.items.map((e) => ({ id: e.id, at: e.occurred_at, who: e.actor_label, action: e.action, result: e.result })) : [],
        // A tab shows its newest rows and says when there are more (FIRST-RELEASE §16).
        more: {
          overrides: overrides.length > detailListSize,
          trialExtensions: extensions.length > detailListSize,
          people: people.length >= maxPageSize,
          activity: activityPage.ok && activityPage.page.pageInfo.hasNextPage,
        },
        actions: actionsFor(row, role, at),
      }
    })

  // Only a partner that bills its merchants itself sets this (SAAS §7.1), never on a cancelled store.
  const billingStatusInput = z.enum(['active', 'past_due', 'suspended'])
  type BillingResult = { ok: true } | { ok: false; reason: 'BILLING_ROLES_ONLY' | 'NOT_SELF_BILLING' | 'CANCELLED' | 'NOT_FOUND' | 'INVALID_INPUT' }

  const setStoreBillingStatus = (id: string, raw: unknown): Promise<BillingResult> => {
    if (!billers) return Promise.resolve({ ok: false, reason: 'BILLING_ROLES_ONLY' })
    if (!z.guid().safeParse(id).success) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    const parsed = billingStatusInput.safeParse(raw)
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    return withScope(sql, context, async (tx): Promise<BillingResult> => {
      const row = await selectStoreListRow(tx, id, now())
      if (!row || row.partner_id !== partnerId) return { ok: false, reason: 'NOT_FOUND' }
      if ((await modeOf(tx)) !== 'own') return { ok: false, reason: 'NOT_SELF_BILLING' }
      if (row.status === 'cancelled' || row.status === 'closed') return { ok: false, reason: 'CANCELLED' }
      await updateStoreBillingStatus(tx, id, parsed.data)
      const entry: ActivityEntry = {
        category: 'write',
        action: storeAudit.setStoreBillingStatus,
        result: 'success',
        actorKind: 'partner_user',
        actorId: caller.user.id,
        actorLabel: `${caller.user.name} <${caller.user.email}>`,
        partnerId,
        storeId: id,
        target: { type: 'store', id, label: row.name },
        changes: [{ field: 'billing_status', before: row.billing_status, after: parsed.data }],
        reason: null,
        api: 'platform',
        visibility: 'partner',
        ...facts,
      }
      await activity.record(tx, entry)
      return { ok: true }
    })
  }

  return { stores, store, setStoreBillingStatus }
}

export const storeAudit = { setStoreBillingStatus: 'store.billing_status_set' } as const
export type PartnerStoresService = ReturnType<typeof createPartnerStoresService>
export type StoreDetailDto = NonNullable<Awaited<ReturnType<PartnerStoresService['store']>>>
