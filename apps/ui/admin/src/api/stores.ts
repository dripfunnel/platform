// The Stores operations on the Admin API (FIRST-RELEASE.md §5, §12): the only place this app
// talks to the API about stores. Whether an action is allowed, and why not, is the API's
// answer (decided on #20); the screens only render it.
import type { Money } from '@dripfunnel/shared/format'
import { harnessEnabled } from '../features/common/useScreenState'
import type { StaffRole } from '../features/shell/staffRoles'
import type { SessionPermission } from './impersonation'
import type { PageInfo, PageRequest } from './pageInfo'
import type { ActionPermission } from './permissions'
import type { JobPermissions, JobState } from './provisioning'
import type { ProvisioningStep } from './provisioningSteps'
import { storesServer } from './storesSample'

export const storeStatuses = ['trial', 'active', 'pastdue', 'suspended', 'cancelled'] as const
export type StoreStatus = (typeof storeStatuses)[number]

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
  | { kind: 'suspended'; reason: string; by: string; previous: Exclude<StoreStatus, 'suspended'> }
  | { kind: 'cancelled'; since: string }

export interface StoreDomain {
  host: string
  custom: boolean
  status: 'live' | 'waiting' | 'failed'
}

export interface StoreRow {
  id: string
  name: string
  code: string
  partner: { id: string; name: string }
  owner: { name: string; email: string }
  plan: { name: string; price: Money }
  state: StoreState
  storefront: StorefrontState
  domain: StoreDomain
  // `steps` is this store's own run: eight, or three for a store with its own frontend.
  setup: { state: SetupState; step: ProvisioningStep; steps: readonly ProvisioningStep[]; attempts: number }
  createdAt: string
}

// Retry and Undo and clean up are the signup job's, in provisioning.ts (decided on #43).
export const storeActions = ['suspend', 'restore', 'extendTrial', 'resendInvite', 'addNote'] as const
export type StoreAction = (typeof storeActions)[number]

export type StoreRefusal =
  | 'SUPER_ADMIN_ONLY'
  | 'SUSPENDERS_ONLY'
  | 'INVITERS_ONLY'
  | 'NOTERS_ONLY'

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

export interface StorePage {
  items: readonly StoreRow[]
  pageInfo: PageInfo
  partners: readonly { id: string; name: string }[]
}

export type StoreEvent = 'trialStarted' | 'active' | 'pastDue' | 'suspended' | 'restored' | 'cancelled' | 'trialExtended'

// `note` is the reason given, or for a trial extension the new end date; `plan` names the plan
// the event happened on, when it did.
export interface StoreHistoryEntry {
  at: string
  event: StoreEvent
  by: string | null
  note: string | null
  plan: string | null
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

export interface StoreUser {
  id: string
  name: string
  email: string
  role: 'owner' | 'manager' | 'staff' | 'supplierAdmin' | 'supplierMember'
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
  country: string
  history: readonly StoreHistoryEntry[]
  counts: { owners: number; managers: number; staff: number; suppliers: number; products: number; orders: number }
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

// The API's cap on a page; it answers with fewer when there are fewer.
export const storePageSize = 25

const notConnected = () => Promise.reject(new Error('The Admin API has no stores queries yet (#34).'))

// Seam: replace the sample with the Admin API's `stores(filter, page)` and `store(id)` queries
// and the §12 mutations through createApiClient from @dripfunnel/shared/graphql once #34 lands
// (https://github.com/dripfunnel/platform/issues/34). `caller` stands in for the session the
// API reads the staff role from, and goes with the sample. The sample is invented, so it
// appears only where the ?state= harness does; a production build shows the error state.
export const loadStores = (filter: StoreFilter, page: PageRequest): Promise<StorePage> =>
  harnessEnabled ? Promise.resolve(storesServer.list(filter, page, storePageSize)) : notConnected()

export const loadStore = (id: string, caller: StaffRole): Promise<Store | null> =>
  harnessEnabled ? Promise.resolve(storesServer.get(id, caller)) : notConnected()

// `value` is what the action needs besides a reason: the new trial end, or the note's text.
export const runStoreAction = (id: string, action: StoreAction, reason: string | null, value: string | null): Promise<void> =>
  harnessEnabled ? Promise.resolve(storesServer.run(id, action, reason, value)) : notConnected()

export const recheckStoreDomain = (id: string, host: string): Promise<StoreDomain['status']> =>
  harnessEnabled ? Promise.resolve(storesServer.recheck(id, host)) : notConnected()
