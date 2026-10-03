import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { AccessTarget } from '#auth/assignment'
import { partnerScopedRoles, type StaffPermission } from '#auth/permissions'
import type { StaffMember } from '#auth/staff'
import { parseHostname } from '#core/hostname'
import type { StaffContext } from '#core/tenancy'
import type { BuildState, CustomDomainRow, HostStatus, StoreRow, StoreStatus } from '#db/schema/saas'
import { selectActivity } from '#db/scoped/activity'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { selectPartnerDomainsOf } from '#db/scoped/partners'
import {
  insertStoreNote,
  selectCustomDomains,
  selectJobDetail,
  selectPartnerNames,
  selectStoreCounts,
  selectStoreForUpdate,
  selectStoreListRow,
  selectStoreNotes,
  selectStorePeople,
  selectStores,
  type StoreListRow,
  type StorePerson,
} from '#db/scoped/stores'
import type { PageInfo } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { setupStateOf, stuckAfterMinutes, type SetupState } from '#saas/provisioning/index'
import { decodePage, pageOf, reasonText, roleGuard, staffEntry, type PageRequest } from '#saas/staff/index'
import { reissueOwnerInvitation } from './invitations'
import { daysPastDue, extendTrial as extendTrialTo, transitionStore, trialDaysLeft } from './states'

// Stores on the Admin API (card #34; ui/admin/FIRST-RELEASE.md §5, §12). Every decision a
// screen is told comes from here; every write records its entry in its transaction.

export const storePageSize = 25
export const storeNoteMaxLength = 2000

export const storeAudit = {
  suspendStore: 'store.suspended',
  emergencyFlagged: 'store.suspension_flagged_for_review',
  restoreStore: 'store.restored',
  extendTrial: 'store.trial_extended',
  resendStoreOwnerInvite: 'store.invitation_resent',
  addStoreNote: 'store.note_added',
  recheckStoreDomain: 'store.domain_recheck_requested',
} as const

export type StoreAuditAction = (typeof storeAudit)[keyof typeof storeAudit]

export type StoreActionName = 'suspend' | 'restore' | 'extendTrial' | 'resendInvite' | 'addNote'
export type JobActionName = 'retry' | 'undo'

export type RefusalCode =
  | 'SUPER_ADMIN_ONLY'
  | 'SUSPENDERS_ONLY'
  | 'INVITERS_ONLY'
  | 'NOTERS_ONLY'
  | 'RETRIERS_ONLY'
  | 'CLEANERS_ONLY'
  | 'JOB_RUNNING'
  | 'STAFF_ROLE_NOT_ALLOWED'
  | 'NOT_ASSIGNED'
  | 'INVALID_STATE'
  | 'REASON_REQUIRED'
  | 'INVALID_INPUT'
  | 'INVALID_HOSTNAME'
  | 'NOT_FOUND'
  | 'NOT_ON_TRIAL'
  | 'NO_PENDING_INVITATION'
  | 'TARGET_NOT_ACTIVE'
  | 'PARTNER_CLOSED'

/** `emergency` marks an Engineer on call's suspension, which a Super admin reviews (FIRST-RELEASE §5.3). */
export type ActionPermission = { allowed: true; emergency?: true } | { allowed: false; reason: RefusalCode }

export type StorePermissions = Partial<Record<StoreActionName, ActionPermission>>
export type JobPermissions = Partial<Record<JobActionName, ActionPermission>>

export type StoreState =
  | { kind: 'trial'; trialEndsAt: Date; daysLeft: number }
  | { kind: 'active' }
  | { kind: 'past_due'; daysPastDue: number }
  | { kind: 'suspended'; reason: string; by: string; since: Date; previous: 'trial' | 'active' | 'past_due' }
  | { kind: 'cancelled'; since: Date }
  | { kind: 'closed'; since: Date }

export interface StoreRowDto {
  id: string
  name: string
  code: string
  partner: { id: string; name: string }
  owner: { name: string | null; email: string | null }
  plan: { name: string | null }
  state: StoreState
  storefront: BuildState | 'own'
  domain: { host: string; custom: boolean; status: HostStatus }
  setup: { state: SetupState; step: string | null; steps: string[]; attempts: number }
  createdAt: Date
}

export interface StoreUserDto {
  id: string
  name: string
  email: string
  role: string
  supplier: string | null
  status: string
  lastSignInAt: Date | null
  impersonate: ActionPermission
}

export interface StoreDnsRecord {
  kind: 'custom' | 'ownership' | 'shopAddress'
  host: string
  record: 'CNAME' | 'TXT' | null
  expected: string | null
  found: string | null
  status: HostStatus
}

export interface StoreDto extends StoreRowDto {
  country: string | null
  history: { at: Date; action: string; by: string | null; note: string | null }[]
  counts: { owners: number; managers: number; staff: number; suppliers: number }
  site: { version: string | null; lastBuildAt: Date | null; lastPublishAt: Date | null; previewHost: string | null; liveHost: string }
  provisioning: { error: string | null; details: string | null }
  records: StoreDnsRecord[]
  users: StoreUserDto[]
  supportAccess: boolean
  notes: { id: string; by: string; at: Date; text: string }[]
  job: { id: string; actions: JobPermissions } | null
  actions: StorePermissions
}

export interface StorePage {
  items: StoreRowDto[]
  pageInfo: PageInfo
  partners: { id: string; name: string }[]
}

export const storeFilter = z
  .object({
    partner: z.guid().optional(),
    status: z.enum(['trial', 'active', 'past_due', 'suspended', 'cancelled', 'closed']).optional(),
    storefront: z.enum(['live', 'building', 'failed', 'own']).optional(),
    setup: z.enum(['done', 'running', 'failed', 'stuck', 'cleaning']).optional(),
    created: z.enum(['7d', '30d']).optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .strict()

export type { PageRequest } from '#saas/staff/index'

export type Refusal = { ok: false; code: RefusalCode }
export type Result<T = object> = ({ ok: true } & T) | Refusal

export interface StoresServiceDeps {
  sql: postgres.Sql
  staff: StaffMember
  facts: RequestFacts
  activity: ActivityLog
  isAssigned: (staffId: string, target: AccessTarget) => Promise<boolean>
  now: () => Date
}

const noteText = z.string().trim().min(1).max(storeNoteMaxLength)

const roleRefusals: Partial<Record<StaffPermission, RefusalCode>> = {
  'stores.suspend': 'SUSPENDERS_ONLY',
  'stores.restore': 'SUPER_ADMIN_ONLY',
  'stores.trial.extend': 'SUPER_ADMIN_ONLY',
  'stores.invite.resend': 'INVITERS_ONLY',
  'stores.notes.write': 'NOTERS_ONLY',
  'provisioning.retry': 'RETRIERS_ONLY',
  'provisioning.undo': 'CLEANERS_ONLY',
  'domains.recheck': 'STAFF_ROLE_NOT_ALLOWED',
  impersonate: 'STAFF_ROLE_NOT_ALLOWED',
}

const dayMs = 24 * 60 * 60 * 1000

const stateOf = (row: StoreRow, now: Date): StoreState => {
  switch (row.status) {
    case 'trial':
      return { kind: 'trial', trialEndsAt: row.trial_ends_at ?? now, daysLeft: trialDaysLeft(row.trial_ends_at ?? now, now) }
    case 'active':
      return { kind: 'active' }
    case 'past_due':
      return { kind: 'past_due', daysPastDue: daysPastDue(row.past_due_since ?? now, now) }
    case 'suspended':
      return { kind: 'suspended', reason: row.suspended_reason ?? '', by: row.suspended_by_label ?? '', since: row.suspended_at ?? now, previous: row.suspended_previous_status ?? 'active' }
    case 'cancelled':
      return { kind: 'cancelled', since: row.cancelled_at ?? now }
    case 'closed':
      return { kind: 'closed', since: row.closed_at ?? now }
  }
}

export const createStoresService = (deps: StoresServiceDeps) => {
  const { sql, staff, facts, activity, now } = deps
  const context: StaffContext = { caller: { kind: 'staff', staffId: staff.id } }
  const scopedByAssignment = partnerScopedRoles.includes(staff.role)
  // A malformed id is NOT_FOUND (or null), never a database error, and so is a store of a partner
  // outside a Partner manager's assignment (ACCESS.md §5.4): the service enforces it, not the resolver alone.
  const visible = async (id: string): Promise<boolean> =>
    z.guid().safeParse(id).success && (!scopedByAssignment || (await deps.isAssigned(staff.id, { storeId: id })))
  const asStaff = staffEntry(staff, facts)
  const { may, refusedBy } = roleGuard<RefusalCode>(staff, roleRefusals, 'STAFF_ROLE_NOT_ALLOWED')

  // Account-level by default: the partner and the merchant both read it (LOGGING.md §6).
  const entry = (store: Pick<StoreRow, 'id' | 'name' | 'partner_id'>, action: StoreAuditAction, reason: string | null, extra: Partial<ActivityEntry> = {}): ActivityEntry =>
    asStaff({ action, reason, partnerId: store.partner_id, storeId: store.id, target: { type: 'store', id: store.id, label: store.name }, visibility: 'partner', ...extra })

  // SAAS.md §8: the live site is the custom domain once it is live, and `{shop}.shops.<partnerdomain>` until then.
  const defaultHostOf = (row: StoreListRow, partnerDomain: string | null): string => `${row.code}.shops.${partnerDomain ?? 'dripfunnel.example'}`
  const liveHostOf = (row: StoreListRow, partnerDomain: string | null): string =>
    row.domain_host !== null && row.domain_status === 'live' ? row.domain_host : defaultHostOf(row, partnerDomain)

  const setupOf = (row: StoreListRow): StoreRowDto['setup'] => {
    const state = setupStateOf(row.job_state && row.job_step && row.job_step_started_at ? { state: row.job_state, step: row.job_step, step_started_at: row.job_step_started_at } : null, now())
    return { state, step: row.job_step, steps: row.job_steps ?? [], attempts: row.job_attempts ?? 0 }
  }

  const rowOf = (row: StoreListRow, shopsDomain: string | null): StoreRowDto => ({
    id: row.id,
    name: row.name,
    code: row.code,
    partner: { id: row.partner_id, name: row.partner_name },
    owner: { name: row.owner_name, email: row.owner_email },
    plan: { name: row.plan_name },
    state: stateOf(row, now()),
    storefront: row.storefront_kind === 'own' ? 'own' : (row.build_state ?? 'building'),
    // FIRST-RELEASE §5.1: the custom domain and its status when there is one, else the live link.
    domain: row.domain_host !== null ? { host: row.domain_host, custom: true, status: row.domain_status ?? 'waiting' } : { host: defaultHostOf(row, shopsDomain), custom: false, status: 'live' },
    setup: setupOf(row),
    createdAt: row.created_at,
  })

  // For the store's default addresses: `{shop}.shops.<partnerdomain>` and `{shop}.preview.<partnerdomain>`.
  const shopsDomainsFor = (tx: ScopedSql, partnerIds: readonly string[]) => selectPartnerDomainsOf(tx, partnerIds)

  const list = async (filter: unknown, page: PageRequest): Promise<Result<{ page: StorePage }>> => {
    const parsed = storeFilter.safeParse(filter ?? {})
    if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' }
    const decoded = decodePage(page, storePageSize)
    if (!decoded.ok) return { ok: false, code: 'INVALID_INPUT' }
    const f = parsed.data
    const at = now()
    return withScope(sql, context, async (tx) => {
      const assignedTo = scopedByAssignment ? staff.id : undefined
      const rows = await selectStores(
        tx,
        {
          partnerId: f.partner,
          status: f.status,
          storefront: f.storefront,
          setup: f.setup,
          createdAfter: f.created ? new Date(at.getTime() - (f.created === '7d' ? 7 : 30) * dayMs) : undefined,
          q: f.q,
          assignedTo,
        },
        decoded,
        decoded.limit,
        stuckAfterMinutes,
        at,
      )
      const { rows: pageRows, pageInfo } = pageOf(rows, decoded, (row) => ({ occurredAt: row.created_at, id: row.id }))
      const shops = await shopsDomainsFor(tx, [...new Set(pageRows.map((r) => r.partner_id))])
      return {
        ok: true,
        page: {
          items: pageRows.map((row) => rowOf(row, shops.get(row.partner_id) ?? null)),
          pageInfo,
          partners: await selectPartnerNames(tx, assignedTo),
        },
      }
    })
  }

  // FIRST-RELEASE §5.3 with the #20 decisions: offered by state, refused by role, Engineer on
  // call's suspension flagged as an emergency, Restore back to the previous status.
  const permissionsFor = (row: StoreListRow): StorePermissions => {
    const actions: StorePermissions = {}
    if (row.status === 'closed') return actions
    if (row.status === 'trial' || row.status === 'active' || row.status === 'past_due') {
      const suspend = may('stores.suspend')
      actions.suspend = suspend.allowed && staff.role === 'staff-engineer' ? { allowed: true, emergency: true } : suspend
    }
    if (row.status === 'suspended') actions.restore = may('stores.restore')
    if (row.status === 'trial') actions.extendTrial = may('stores.trial.extend')
    // Offered while the Owner's invitation is open, the same fact the mutation checks.
    if (row.owner_invitation_open) actions.resendInvite = may('stores.invite.resend')
    actions.addNote = may('stores.notes.write')
    return actions
  }

  // FIRST-RELEASE §7 with the #20 decisions: Retry while failed or stuck, Undo for a failed
  // signup only, both held back while a step is running. The mutations are #37's.
  const jobPermissionsFor = (state: SetupState): JobPermissions => {
    switch (state) {
      case 'running':
        return { retry: { allowed: false, reason: 'JOB_RUNNING' }, undo: { allowed: false, reason: 'JOB_RUNNING' } }
      case 'stuck':
        return { retry: may('provisioning.retry') }
      case 'failed':
        return { retry: may('provisioning.retry'), undo: may('provisioning.undo') }
      case 'cleaning':
      case 'done':
        return {}
    }
  }

  // ACCESS.md §8.1: Super admin and Support, an active user, a partner that is open.
  const impersonateFor = (person: StorePerson, partnerState: string): ActionPermission => {
    const role = may('impersonate')
    if (!role.allowed) return role
    if (partnerState === 'closed') return { allowed: false, reason: 'PARTNER_CLOSED' }
    if (person.status !== 'active' || person.user_status !== 'active') return { allowed: false, reason: 'TARGET_NOT_ACTIVE' }
    return { allowed: true }
  }

  const recordsFor = (domain: CustomDomainRow | null, liveHost: string): StoreDnsRecord[] =>
    domain
      ? [
          { kind: 'custom', host: domain.host, record: 'CNAME', expected: domain.expected_cname, found: domain.found_cname, status: domain.status },
          { kind: 'ownership', host: `_df-verify.${domain.host}`, record: 'TXT', expected: domain.ownership_token, found: domain.ownership_found, status: domain.status },
        ]
      : [{ kind: 'shopAddress', host: liveHost, record: null, expected: null, found: null, status: 'live' }]

  const get = async (id: string): Promise<StoreDto | null> => {
    if (!(await visible(id))) return null
    return withScope(sql, context, async (tx) => {
      const row = await selectStoreListRow(tx, id, now())
      if (!row) return null
      const [people, domains, notes, counts, history, shops, detail] = await Promise.all([
        selectStorePeople(tx, id),
        selectCustomDomains(tx, id),
        selectStoreNotes(tx, id),
        selectStoreCounts(tx, id),
        selectActivity(tx, { targetType: 'store', targetId: id }, {}, 100),
        shopsDomainsFor(tx, [row.partner_id]),
        row.job_id ? selectJobDetail(tx, row.job_id) : Promise.resolve(null),
      ])
      const shopsDomain = shops.get(row.partner_id) ?? null
      const base = rowOf(row, shopsDomain)
      const domain = domains[0] ?? null
      const jobState = base.setup.state
      return {
        ...base,
        country: row.country,
        history: history.reverse().map((h) => ({ at: h.occurred_at, action: h.action, by: h.actor_label, note: h.reason })),
        counts,
        site: {
          version: row.core_version,
          lastBuildAt: row.last_build_at,
          lastPublishAt: row.last_publish_at,
          previewHost: row.storefront_kind === 'own' ? null : `${row.code}.preview.${shopsDomain ?? 'dripfunnel.example'}`,
          liveHost: liveHostOf(row, shopsDomain),
        },
        provisioning: { error: row.job_last_error, details: detail?.details ?? null },
        records: recordsFor(domain, liveHostOf(row, shopsDomain)),
        users: people.map((p) => ({
          id: p.user_id,
          name: p.name,
          email: p.email,
          role: p.role_key,
          supplier: p.seller_name,
          status: p.status,
          lastSignInAt: p.last_sign_in_at,
          impersonate: impersonateFor(p, row.partner_state),
        })),
        supportAccess: row.support_access_allowed,
        notes: notes.map((n) => ({ id: n.id, by: n.by_name, at: n.created_at, text: n.text })),
        job: row.job_id && jobState !== 'done' ? { id: row.job_id, actions: jobPermissionsFor(jobState) } : null,
        actions: permissionsFor(row),
      }
    })
  }

  const locked = async <T>(id: string, work: (tx: ScopedSql, store: StoreRow) => Promise<Result<T>>): Promise<Result<T>> => {
    if (!(await visible(id))) return { ok: false, code: 'NOT_FOUND' }
    return withScope(sql, context, async (tx): Promise<Result<T>> => {
      const store = await selectStoreForUpdate(tx, id)
      if (!store) return { ok: false, code: 'NOT_FOUND' }
      return work(tx, store)
    })
  }

  const suspendStore = async (id: string, reason: string | null): Promise<Result<{ status: StoreStatus; emergency: boolean }>> => {
    const refused = refusedBy('stores.suspend')
    if (refused) return refused
    // Merchant-visible text (FIRST-RELEASE §5.3): bounded, trimmed, never empty.
    const parsed = reasonText.safeParse(reason ?? '')
    if (!parsed.success) return { ok: false, code: 'REASON_REQUIRED' }
    return locked(id, async (tx, store): Promise<Result<{ status: StoreStatus; emergency: boolean }>> => {
      const result = await transitionStore(tx, store, { to: 'suspended', reason: parsed.data, by: staff.name }, now())
      if (!result.ok) return { ok: false, code: result.code === 'REASON_REQUIRED' ? 'REASON_REQUIRED' : 'INVALID_STATE' }
      const emergency = staff.role === 'staff-engineer'
      await activity.record(tx, entry(store, storeAudit.suspendStore, parsed.data, { changes: [{ field: 'status', before: store.status, after: 'suspended' }] }))
      // FIRST-RELEASE §5.3: an Engineer on call's suspension is reviewed by a Super admin; that is DripFunnel's note, not the partner's.
      if (emergency) await activity.record(tx, entry(store, storeAudit.emergencyFlagged, null, { visibility: 'staff' }))
      // SAAS.md §4.2: the Owner is told, pointed at their partner's support, never DripFunnel's;
      // the storefront's degraded rule is purged. Neither payload carries a DripFunnel route.
      await queueSideEffect(tx, {
        kind: 'email',
        idempotencyKey: `store-suspended:${store.id}:${now().toISOString()}`,
        payload: { template: 'store-suspended', storeId: store.id, reason: parsed.data, contact: 'partner-support' },
        partnerId: store.partner_id,
        storeId: store.id,
      })
      await queueSideEffect(tx, {
        kind: 'cache.purge',
        idempotencyKey: `store-degraded:${store.id}:suspended:${now().toISOString()}`,
        payload: { storeId: store.id, rule: 'suspended' },
        partnerId: store.partner_id,
        storeId: store.id,
      })
      return { ok: true, status: 'suspended', emergency }
    })
  }

  const restoreStore = async (id: string, reason: string | null): Promise<Result<{ status: StoreStatus }>> => {
    const refused = refusedBy('stores.restore')
    if (refused) return refused
    const parsed = reasonText.safeParse(reason ?? '')
    if (!parsed.success) return { ok: false, code: 'REASON_REQUIRED' }
    return locked(id, async (tx, store): Promise<Result<{ status: StoreStatus }>> => {
      const result = await transitionStore(tx, store, { to: 'restored' }, now())
      if (!result.ok) return { ok: false, code: 'INVALID_STATE' }
      await activity.record(tx, entry(store, storeAudit.restoreStore, parsed.data, { changes: [{ field: 'status', before: 'suspended', after: result.status }] }))
      // SAAS.md §4.2: every state change tells the Owner and purges the storefront's rule.
      await queueSideEffect(tx, {
        kind: 'email',
        idempotencyKey: `store-restored:${store.id}:${now().toISOString()}`,
        payload: { template: 'store-restored', storeId: store.id, contact: 'partner-support' },
        partnerId: store.partner_id,
        storeId: store.id,
      })
      await queueSideEffect(tx, {
        kind: 'cache.purge',
        idempotencyKey: `store-degraded:${store.id}:restored:${now().toISOString()}`,
        payload: { storeId: store.id, rule: 'restored' },
        partnerId: store.partner_id,
        storeId: store.id,
      })
      return { ok: true, status: result.status }
    })
  }

  const extendTrial = async (id: string, trialEndsAt: string): Promise<Result<{ trialEndsAt: Date }>> => {
    const refused = refusedBy('stores.trial.extend')
    if (refused) return refused
    const parsed = z.iso.datetime().safeParse(trialEndsAt)
    if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' }
    const end = new Date(parsed.data)
    return locked(id, async (tx, store): Promise<Result<{ trialEndsAt: Date }>> => {
      if (store.status !== 'trial') return { ok: false, code: 'NOT_ON_TRIAL' }
      if (end <= now()) return { ok: false, code: 'INVALID_INPUT' }
      const result = await extendTrialTo(tx, store, end)
      if (!result.ok) return { ok: false, code: 'INVALID_INPUT' }
      await activity.record(tx, entry(store, storeAudit.extendTrial, null, { changes: [{ field: 'trial_ends_at', before: store.trial_ends_at?.toISOString() ?? null, after: end.toISOString() }] }))
      return { ok: true, trialEndsAt: end }
    })
  }

  const resendStoreOwnerInvite = async (id: string): Promise<Result> => {
    const refused = refusedBy('stores.invite.resend')
    if (refused) return refused
    return locked(id, async (tx, store): Promise<Result> => {
      const reissued = await reissueOwnerInvitation(tx, store, staff.name, now())
      if (!reissued) return { ok: false, code: 'NO_PENDING_INVITATION' }
      await activity.record(tx, entry(store, storeAudit.resendStoreOwnerInvite, null, { target: { type: 'invitation', id: reissued.invitationId, label: reissued.email } }))
      return { ok: true }
    })
  }

  const addStoreNote = async (id: string, text: string): Promise<Result<{ noteId: string }>> => {
    const refused = refusedBy('stores.notes.write')
    if (refused) return refused
    const parsed = noteText.safeParse(text)
    if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' }
    return locked(id, async (tx, store): Promise<Result<{ noteId: string }>> => {
      const noteId = await insertStoreNote(tx, { storeId: id, staffUserId: staff.id, text: parsed.data, createdAt: now() })
      // Staff-only, like the note itself (FIRST-RELEASE §5.2); the text is never in the entry.
      await activity.record(tx, entry(store, storeAudit.addStoreNote, null, { visibility: 'staff', target: { type: 'store_note', id: noteId, label: store.name } }))
      return { ok: true, noteId }
    })
  }

  const recheckStoreDomain = async (id: string): Promise<Result<{ status: 'queued' }>> => {
    const refused = refusedBy('domains.recheck')
    if (refused) return refused
    return locked(id, async (tx, store): Promise<Result<{ status: 'queued' }>> => {
      const domain = (await selectCustomDomains(tx, id))[0]
      if (!domain) return { ok: false, code: 'NOT_FOUND' }
      if (!parseHostname(domain.host).ok) return { ok: false, code: 'INVALID_HOSTNAME' }
      const at = now()
      await queueSideEffect(tx, {
        kind: 'custom_domain.recheck',
        idempotencyKey: `${domain.id}:${Math.floor(at.getTime() / 60_000)}`,
        payload: { storeId: id, customDomainId: domain.id },
        partnerId: store.partner_id,
        storeId: id,
      })
      await activity.record(tx, entry(store, storeAudit.recheckStoreDomain, null, { target: { type: 'domain', id: domain.id, label: domain.host } }))
      return { ok: true, status: 'queued' }
    })
  }

  return { list, get, suspendStore, restoreStore, extendTrial, resendStoreOwnerInvite, addStoreNote, recheckStoreDomain }
}

export type StoresService = ReturnType<typeof createStoresService>
