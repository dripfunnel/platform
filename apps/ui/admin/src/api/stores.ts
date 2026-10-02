// The Stores operations on the Admin API (FIRST-RELEASE.md §5, §12): the only place this app
// talks to the API about stores. Whether an action is allowed, and why not, is the API's
// answer (decided on #20); the screens only render it.
import type { PageInfo, PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { mutate, query } from './client'
import { compactActions, hostStatusSchema, isoString, pageInfoSchema, permissionSchema, refSchema, type HostStatus } from './decode'
import { sessionRefusals, type SessionPermission } from './sessionRefusals'
import type { ActionPermission } from './permissions'
import type { JobPermissions, JobState } from './provisioning'
import { provisioningSteps, type ProvisioningStep } from './provisioningSteps'

// The console's words for a status, kept in its URLs (`?status=pastdue`); the API says `past_due`.
export const storeStatuses = ['trial', 'active', 'pastdue', 'suspended', 'cancelled', 'closed'] as const
export type StoreStatus = (typeof storeStatuses)[number]

const apiStatuses = ['trial', 'active', 'past_due', 'suspended', 'cancelled', 'closed'] as const
const toStatus = (status: (typeof apiStatuses)[number]): StoreStatus => (status === 'past_due' ? 'pastdue' : status)
export const apiStoreStatus = z.enum(apiStatuses).transform(toStatus)
const toApiStatus = (status: StoreStatus) => (status === 'pastdue' ? 'past_due' : status)

export const storefrontStates = ['live', 'building', 'failed', 'own'] as const
export type StorefrontState = (typeof storefrontStates)[number]

export const setupStates = ['done', 'running', 'failed', 'stuck', 'cleaning'] as const satisfies readonly (JobState | 'done')[]
export type SetupState = (typeof setupStates)[number]

export const createdWindows = ['7d', '30d'] as const
export type CreatedWindow = (typeof createdWindows)[number]

// What the Status column shows. A suspended store carries the status it had before, so
// Restore returns it there, never simply to Active (decided on #20).
export type StoreState =
  | { kind: 'trial'; trialEndsAt: string; daysLeft: number }
  | { kind: 'active' }
  | { kind: 'pastdue'; daysPastDue: number }
  | { kind: 'suspended'; reason: string; by: string; since: string; previous: 'trial' | 'active' | 'pastdue' }
  | { kind: 'cancelled'; since: string }
  | { kind: 'closed'; since: string }

export interface StoreDomain {
  host: string
  custom: boolean
  status: Exclude<HostStatus, 'notSet'>
}

export interface StoreRow {
  id: string
  name: string
  code: string
  partner: { id: string; name: string }
  // A store whose signup has not reached its owner yet has neither.
  owner: { name: string | null; email: string | null }
  // No price: plans are priced on their own card (decided on #33).
  plan: { name: string | null }
  state: StoreState
  storefront: StorefrontState
  domain: StoreDomain
  // `steps` is this store's own run: eight, or three for a store with its own frontend. A
  // store that never had a signup job has no step.
  setup: { state: SetupState; step: ProvisioningStep | null; steps: readonly ProvisioningStep[]; attempts: number }
  createdAt: string
}

// Retry and Undo and clean up are the signup job's, in provisioning.ts (decided on #43).
export const storeActions = ['suspend', 'restore', 'extendTrial', 'resendInvite', 'addNote'] as const
export type StoreAction = (typeof storeActions)[number]

// Stable codes the API gives for a refusal (apps/api/src/saas/stores/service.ts).
export const storeRefusals = ['SUPER_ADMIN_ONLY', 'SUSPENDERS_ONLY', 'INVITERS_ONLY', 'NOTERS_ONLY', 'STAFF_ROLE_NOT_ALLOWED', 'NOT_ASSIGNED'] as const
export type StoreRefusal = (typeof storeRefusals)[number]

// `emergency` marks a suspension an Engineer on call may make, which a Super admin reviews:
// the server decides and logs it, the dialog only says so (decided on #20).
export type StorePermission = ActionPermission<StoreRefusal> | { allowed: true; emergency: true }

export type StorePermissions = Partial<Record<StoreAction, StorePermission>>

export interface StoreFilter {
  partner?: string | undefined
  status?: StoreStatus | undefined
  storefront?: StorefrontState | undefined
  setup?: SetupState | undefined
  created?: CreatedWindow | undefined
  q?: string | undefined
}

// Cursor paged with no total (FIRST-RELEASE.md §12); the server caps the page.
export interface StorePage {
  items: readonly StoreRow[]
  pageInfo: PageInfo
  partners: readonly { id: string; name: string }[]
}

// `action` is the activity log's code for the event (LOGGING.md §4), which messages/ words;
// `note` is the reason given with it.
export interface StoreHistoryEntry {
  at: string
  action: string
  by: string | null
  note: string | null
}

// The DNS records the store's addresses need (SAAS.md §7). A store without a custom domain has
// only its shop address, which its partner's wildcard covers.
export interface StoreDnsRecord {
  kind: 'custom' | 'ownership' | 'shopAddress'
  host: string
  record: 'CNAME' | 'TXT' | null
  expected: string | null
  found: string | null
  status: StoreDomain['status']
}

export const storeUserRoles = ['owner', 'manager', 'staff', 'supplierAdmin', 'supplierMember'] as const

export interface StoreUser {
  id: string
  name: string
  email: string
  role: (typeof storeUserRoles)[number]
  supplier: string | null
  status: 'active' | 'invited' | 'suspended'
  lastSignInAt: string | null
}

export interface StoreNote {
  id: string
  by: string
  at: string
  text: string
}

export interface Store extends StoreRow {
  country: string | null
  history: readonly StoreHistoryEntry[]
  // People only: staff never see a store's catalogue or orders here (decided on #34).
  counts: { owners: number; managers: number; staff: number; suppliers: number }
  site: { version: string | null; lastBuildAt: string | null; lastPublishAt: string | null; previewHost: string | null }
  provisioning: { error: string | null }
  records: readonly StoreDnsRecord[]
  users: readonly StoreUser[]
  supportAccess: boolean
  notes: readonly StoreNote[]
  // The signup job while setup hasn't finished, with what may be done to it.
  job: { id: string; actions: JobPermissions } | null
  // Whether the caller may impersonate each of its users, by their id (ACCESS.md §8.1).
  impersonate: Readonly<Record<string, SessionPermission>>
  actions: StorePermissions
}

// The API's cap on a note; the field stops at the same length, so what is typed is what is
// saved and audited.
export const storeNoteMaxLength = 2000

const permission = permissionSchema(storeRefusals)
const jobPermission = permissionSchema(['RETRIERS_ONLY', 'CLEANERS_ONLY', 'JOB_RUNNING'])
const impersonatePermission = permissionSchema(sessionRefusals)

// One object with the facts of every status, switched on `kind` (apps/api/schema/admin.graphql).
const state = z
  .object({
    kind: apiStoreStatus,
    trialEndsAt: isoString.nullable(),
    daysLeft: z.number().int().nullable(),
    daysPastDue: z.number().int().nullable(),
    reason: z.string().nullable(),
    by: z.string().nullable(),
    previous: z.enum(['trial', 'active', 'past_due']).nullable(),
    since: isoString.nullable(),
  })
  .transform((s, ctx): StoreState => {
    switch (s.kind) {
      case 'trial':
        if (s.trialEndsAt && s.daysLeft !== null) return { kind: 'trial', trialEndsAt: s.trialEndsAt, daysLeft: s.daysLeft }
        break
      case 'active':
        return { kind: 'active' }
      case 'pastdue':
        if (s.daysPastDue !== null) return { kind: 'pastdue', daysPastDue: s.daysPastDue }
        break
      case 'suspended':
        if (s.reason !== null && s.by !== null && s.since && s.previous) {
          return { kind: 'suspended', reason: s.reason, by: s.by, since: s.since, previous: s.previous === 'past_due' ? 'pastdue' : s.previous }
        }
        break
      case 'cancelled':
      case 'closed':
        if (s.since) return { kind: s.kind, since: s.since }
        break
    }
    ctx.addIssue({ code: 'custom', message: `incomplete store state ${s.kind}` })
    return z.NEVER
  })

const setup = z.object({
  state: z.enum(setupStates),
  step: z.enum(provisioningSteps).nullable(),
  steps: z.array(z.enum(provisioningSteps)),
  attempts: z.number().int(),
})

const rowFields = {
  id: z.string(),
  name: z.string(),
  code: z.string(),
  partner: refSchema,
  owner: z.object({ name: z.string().nullable(), email: z.string().nullable() }),
  plan: z.object({ name: z.string().nullable() }),
  state,
  storefront: z.enum(storefrontStates),
  domain: z.object({ host: z.string(), custom: z.boolean(), status: hostStatusSchema.exclude(['notSet']) }),
  setup,
  createdAt: isoString,
}

const rowSchema = z.object(rowFields)

const storeRoles: Record<string, StoreUser['role']> = {
  owner: 'owner',
  manager: 'manager',
  staff: 'staff',
  'supplier-admin': 'supplierAdmin',
  'supplier-member': 'supplierMember',
}

const user = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.string(),
    supplier: z.string().nullable(),
    status: z.enum(['active', 'invited', 'suspended']),
    lastSignInAt: isoString.nullable(),
    impersonate: impersonatePermission,
  })
  .transform((u, ctx) => {
    const role = storeRoles[u.role]
    if (!role) {
      ctx.addIssue({ code: 'custom', message: `unknown store role ${u.role}` })
      return z.NEVER
    }
    return { ...u, role }
  })

// An Engineer on call's suspend arrives allowed with the reason `EMERGENCY` (apps/api/src/apis/admin/stores.ts).
const storePermission = z
  .object({ allowed: z.boolean(), reason: z.string().nullable(), failingChecks: z.array(z.string()).nullable() })
  .transform((p, ctx): StorePermission => {
    if (p.allowed && p.reason === 'EMERGENCY') return { allowed: true, emergency: true }
    const parsed = permission.safeParse(p)
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: `unknown refusal ${p.reason ?? 'null'}` })
      return z.NEVER
    }
    return parsed.data
  })

const storeSchema = z.object({
  ...rowFields,
  country: z.string().nullable(),
  history: z.array(z.object({ at: isoString, action: z.string(), by: z.string().nullable(), note: z.string().nullable() })),
  counts: z.object({ owners: z.number().int(), managers: z.number().int(), staff: z.number().int(), suppliers: z.number().int() }),
  site: z.object({ version: z.string().nullable(), lastBuildAt: isoString.nullable(), lastPublishAt: isoString.nullable(), previewHost: z.string().nullable() }),
  provisioning: z.object({ error: z.string().nullable() }),
  records: z.array(
    z.object({
      kind: z.enum(['custom', 'ownership', 'shopAddress']),
      host: z.string(),
      record: z.enum(['CNAME', 'TXT']).nullable(),
      expected: z.string().nullable(),
      found: z.string().nullable(),
      status: hostStatusSchema.exclude(['notSet']),
    }),
  ),
  users: z.array(user),
  supportAccess: z.boolean(),
  notes: z.array(z.object({ id: z.string(), by: z.string(), at: isoString, text: z.string() })),
  job: z.object({ id: z.string(), actions: z.object({ retry: jobPermission.nullable(), undo: jobPermission.nullable() }) }).nullable(),
  actions: z.object({
    suspend: storePermission.nullable(),
    restore: storePermission.nullable(),
    extendTrial: storePermission.nullable(),
    resendInvite: storePermission.nullable(),
    addNote: storePermission.nullable(),
  }),
})
  // A signup job is always at a step; the dialogs about it rely on that.
  .refine((s) => s.job === null || s.setup.step !== null, { message: 'a store with a job has no step', path: ['setup', 'step'] })

const permissionSelection = `{ allowed reason failingChecks }`

const rowSelection = `id name code partner { id name } owner { name email } plan { name }
  state { kind trialEndsAt daysLeft daysPastDue reason by previous since }
  storefront domain { host custom status } setup { state step steps attempts } createdAt`

const storesQuery = `query Stores($filter: StoreFilter, $after: String, $before: String) {
  stores(filter: $filter, after: $after, before: $before) {
    items { ${rowSelection} }
    pageInfo { startCursor endCursor hasPreviousPage hasNextPage }
    partners { id name }
  }
}`

const storeQuery = `query Store($id: ID!) {
  store(id: $id) {
    ${rowSelection}
    country history { at action by note }
    counts { owners managers staff suppliers }
    site { version lastBuildAt lastPublishAt previewHost }
    provisioning { error }
    records { kind host record expected found status }
    users { id name email role supplier status lastSignInAt impersonate ${permissionSelection} }
    supportAccess notes { id by at text }
    job { id actions { retry ${permissionSelection} undo ${permissionSelection} } }
    actions { suspend ${permissionSelection} restore ${permissionSelection} extendTrial ${permissionSelection} resendInvite ${permissionSelection} addNote ${permissionSelection} }
  }
}`

export const loadStores = async (filter: StoreFilter, page: PageRequest): Promise<StorePage> => {
  const { stores } = await query(storesQuery, z.object({ stores: z.object({ items: z.array(rowSchema), pageInfo: pageInfoSchema, partners: z.array(refSchema) }) }), {
    filter: { ...filter, status: filter.status && toApiStatus(filter.status) },
    after: page.after,
    before: page.before,
  })
  return stores
}

// Null when there is no such store. One outside the caller's assignment is refused with
// FORBIDDEN, which the route's error view words (ui/README.md §5).
export const loadStore = async (id: string): Promise<Store | null> => {
  const { store } = await query(storeQuery, z.object({ store: storeSchema.nullable() }), { id })
  if (!store) return null
  const users = store.users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, supplier: u.supplier, status: u.status, lastSignInAt: u.lastSignInAt }))
  const impersonate = Object.fromEntries(store.users.map((u) => [u.id, u.impersonate]))
  return {
    ...store,
    users,
    impersonate,
    job: store.job && { id: store.job.id, actions: compactActions(store.job.actions) },
    actions: compactActions(store.actions),
  }
}

// `value` is what the action needs besides a reason: the new trial end as a day, or the note's
// text. A refusal arrives as an ApiError with the API's code.
export const runStoreAction = async (id: string, action: StoreAction, reason: string | null, value: string | null): Promise<void> => {
  switch (action) {
    case 'suspend':
      await mutate('suspendStore', 'suspendStore(id: $id, reason: $reason)', '($id: ID!, $reason: String!)', { id, reason: reason ?? '' })
      return
    case 'restore':
      await mutate('restoreStore', 'restoreStore(id: $id, reason: $reason)', '($id: ID!, $reason: String!)', { id, reason: reason ?? '' })
      return
    case 'extendTrial':
      // The dialog picks a day; the trial ends at the start of it in UTC, as the screens show days.
      await mutate('extendTrial', 'extendTrial(id: $id, trialEndsAt: $trialEndsAt)', '($id: ID!, $trialEndsAt: String!)', { id, trialEndsAt: `${value ?? ''}T00:00:00.000Z` })
      return
    case 'resendInvite':
      await mutate('resendStoreOwnerInvite', 'resendStoreOwnerInvite(id: $id)', '($id: ID!)', { id })
      return
    case 'addNote':
      await mutate('addStoreNote', 'addStoreNote(id: $id, text: $text)', '($id: ID!, $text: String!)', { id, text: value ?? '' })
      return
  }
}

// Queues the check of the store's custom domain; the records update once it has run
// (FIRST-RELEASE.md §12), so there is no new status to return yet.
export const recheckStoreDomain = async (id: string): Promise<void> => {
  await mutate('recheckStoreDomain', 'recheckStoreDomain(id: $id)', '($id: ID!)', { id })
}
