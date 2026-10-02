import type { Money } from '@dripfunnel/shared/format'
import type { ExportJob, PageInfo, PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import type { PartnerRole } from '../features/shell/partnerRoles'
import { harnessEnabled } from '../harness'
import type { PartnerState } from './me'
import { storesServer } from './storesSample'

// The Stores operations on the Platform API (FIRST-RELEASE.md §6, §16): `stores(filter, after, before)`,
// `search(query)`, `createStore` and the signup job's progress. What a caller may do is the API's answer (§1).
export const storeStatuses = ['trial', 'active', 'pastdue', 'suspended', 'cancelled'] as const
export type StoreStatus = (typeof storeStatuses)[number]

export const storefrontStates = ['live', 'building', 'failed', 'own'] as const
export type StorefrontState = (typeof storefrontStates)[number]

export const createdWindows = ['month', '30d', '90d'] as const
export type CreatedWindow = (typeof createdWindows)[number]

// Who bills the merchants (§11.4): DripFunnel for the partner, or the partner itself, which then sets each store's billing status.
export const billingModes = ['dripfunnel', 'own'] as const
export type BillingMode = (typeof billingModes)[number]

export const billingStatuses = ['active', 'pastdue', 'suspended'] as const
export type BillingStatus = (typeof billingStatuses)[number]

export const limitKeys = ['products', 'staff', 'suppliers', 'ai', 'publish'] as const
export type LimitKey = (typeof limitKeys)[number]

// What the Status column shows, worded by the API: days left, days past due, the reason's first sentence.
export type StoreState =
  | { kind: 'trial'; trialEndsAt: string; daysLeft: number }
  | { kind: 'active' }
  | { kind: 'pastdue'; daysPastDue: number }
  | { kind: 'suspended'; reason: string }
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
  owner: { name: string; email: string }
  plan: { id: string; name: string }
  // The API's figure when a limit is at 80% or more (§6.1), null otherwise.
  near: { percent: number; limit: LimitKey } | null
  state: StoreState
  salesLastMonth: Money | null
  storefront: StorefrontState
  domain: StoreDomain
  createdAt: string
  // Set by the partner when it bills its merchants itself (§6.1); null otherwise, and for a cancelled store.
  billingStatus: BillingStatus | null
}

export interface StoreFilter {
  status?: StoreStatus | undefined
  plan?: string | undefined
  created?: CreatedWindow | undefined
  storefront?: StorefrontState | undefined
  near?: 'yes' | undefined
  q?: string | undefined
}

// The stable codes `createStore` may answer with (FIRST-RELEASE.md §6.2, §6.4).
export type CreateRefusal = 'OWNERS_AND_ADMINS_ONLY' | 'PARTNER_NOT_LIVE' | 'PARTNER_PAUSED' | 'STORE_LIMIT_REACHED' | 'READ_ONLY'

export type CreatePermission = { allowed: true } | { allowed: false; reason: CreateRefusal }

export type ActionRefusal = 'OWNERS_AND_ADMINS_ONLY' | 'FINANCE_TRIAL_ONLY' | 'ALREADY_SUSPENDED' | 'NOT_SUSPENDED' | 'NOT_ON_TRIAL' | 'NO_PENDING_INVITATION' | 'READ_ONLY'

export type ActionPermission = { allowed: true } | { allowed: false; reason: ActionRefusal }

export interface StorePage {
  items: readonly StoreRow[]
  pageInfo: PageInfo
  plans: readonly { id: string; name: string }[]
  billingMode: BillingMode
  // Every role may export (ACCESS.md §5.3); `billingStatus` is offered only in own-billing mode, to Owner, Admin and Finance.
  actions: { create: CreatePermission; export: ActionPermission; billingStatus?: ActionPermission }
}

export interface StoreMatch {
  id: string
  name: string
  email: string
  host: string
  state: StoreState
}

export interface CreateStoreForm {
  permission: CreatePermission
  countries: readonly { name: string; currency: string }[]
  plans: readonly { id: string; name: string; price: Readonly<Record<string, Money>> }[]
  trials: readonly number[]
  defaultTrial: number
  // "charged by DripFunnel for Northstar": who bills the merchant, as words (§1, §11.4).
  chargedBy: string
}

export const createStoreInput = z.object({
  name: z.string().trim().min(1).max(80),
  ownerName: z.string().trim().min(1).max(80),
  ownerEmail: z.string().trim().email().max(254),
  country: z.string().min(1),
  planId: z.string().min(1),
  trialDays: z.number().int().min(0).max(90),
})
export type CreateStoreInput = z.infer<typeof createStoreInput>

export type CreateStoreResult = { ok: true; storeId: string } | { ok: false; reason: CreateRefusal }

export const provisioningSteps = ['account', 'store', 'portal', 'storefront', 'done'] as const
export type ProvisioningStepKey = (typeof provisioningSteps)[number]

export interface ProvisioningProgress {
  steps: readonly { key: ProvisioningStepKey; state: 'done' | 'running' | 'waiting' | 'failed' }[]
  done: boolean
  elapsedSeconds: number
}

// One store as its partner sees it (FIRST-RELEASE.md §6.3): every figure, sentence and permission
// below is the API's. `actions` holds each §6.4 action as allowed, refused with a stable code, or absent for the state.
export const storeTabs = ['overview', 'plan', 'billing', 'storefront', 'domains', 'setup', 'support', 'activity'] as const
export type StoreTab = (typeof storeTabs)[number]

// In the prototype's menu order, Suspend last.
export const storeActions = ['changePlan', 'extendTrial', 'addOverride', 'resendInvite', 'restore', 'suspend', 'retryStep'] as const
export type StoreAction = (typeof storeActions)[number]

export type StorePermissions = Partial<Record<StoreAction, ActionPermission>>

export interface StoreUsage {
  limit: LimitKey
  used: number
  // null when the plan lacks the limit ("not included"); `percent` is the API's figure against the cap.
  cap: number | null
  percent: number | null
  monthly: boolean
}

export interface StoreOverride {
  id: string
  what: string
  reason: string
  by: string
  at: string
}

export interface StoreBilling {
  cycle: 'monthly' | 'yearly'
  price: Money
  next: { kind: 'firstCharge'; at: string } | { kind: 'charge'; at: string } | { kind: 'none' }
  payment: 'paid' | 'failed' | 'noCard'
  // The last four digits only, or null with no card on file.
  cardLast4: string | null
  mode: 'dripfunnel' | 'own'
  chargedBy: string
}

export interface StoreInvoice {
  id: string
  at: string
  amount: Money
  status: 'paid' | 'failed'
  cardLast4: string | null
}

export interface StoreDnsRecord {
  type: 'CNAME'
  name: string
  value: string
  found: string | null
}

export type SetupStepState = 'done' | 'running' | 'slow' | 'failed' | 'waiting'

// When a finished step ran, or the API's sentence about one that is still running.
export type SetupStepDetail = { kind: 'at'; at: string } | { kind: 'text'; text: string } | null

export interface StorePerson {
  id: string
  name: string
  email: string
  // "Supplier admin · Loomcraft" when the person belongs to a supplier.
  role: string
  status: 'active' | 'invited' | 'suspended'
  lastSignInAt: string | null
}

export interface StoreSession {
  who: string
  reason: string
  at: string
  how: 'open' | 'expired' | 'ended'
}

export interface StoreActivityEntry {
  id: string
  at: string
  who: string
  text: string
  result: 'success' | 'denied' | 'failed'
  facts: readonly { label: string; value: string }[]
}

export interface Store extends StoreRow {
  country: string
  planPrice: Money
  people: { count: number; suppliers: number }
  ordersLastMonth: number | null
  contacts: readonly { name: string; email: string; role: string }[]
  history: readonly { at: string; text: string; by: string }[]
  usage: readonly StoreUsage[]
  overrides: readonly StoreOverride[]
  billing: StoreBilling
  invoices: readonly StoreInvoice[]
  site: { previewHost: string; lastPublishAt: string | null }
  records: readonly StoreDnsRecord[]
  waitingSince: string | null
  setup: { steps: readonly { key: ProvisioningStepKey; state: SetupStepState; detail: SetupStepDetail }[]; stuck: boolean }
  // The ends the API offers Extend trial, worked out by it; empty when the store is not on trial.
  trialExtensions: readonly { days: number; endsAt: string }[]
  support: { allowed: boolean; people: readonly StorePerson[]; sessions: readonly StoreSession[] }
  activity: readonly StoreActivityEntry[]
  // The header's notice for a suspended or past-due store, worded by the API (§6.3).
  notice: { tone: 'danger' | 'warning'; text: string } | null
  actions: StorePermissions
}

// What each action needs besides a reason (§6.4).
export type StoreActionInput =
  | { action: 'changePlan'; planId: string; when: 'next' | 'now'; reason: string }
  | { action: 'extendTrial'; days: number; reason: string }
  | { action: 'addOverride'; limit: LimitKey; amount: number; duration: 'month' | 'always'; reason: string }
  | { action: 'suspend'; reason: string }
  | { action: 'restore'; reason: string }
  | { action: 'resendInvite' }
  | { action: 'retryStep' }

export type StoreActionResult = { ok: true } | { ok: false; reason: ActionRefusal }

export interface ChangePlanOptions {
  plans: readonly { id: string; name: string; price: Money }[]
  nextBillingAt: string
  // The API's proration for moving now, per plan: an amount charged today, a credit, or nothing.
  proration: Readonly<Record<string, { kind: 'charge'; amount: Money } | { kind: 'credit' } | { kind: 'none' }>>
}

// The API's cap on a page; it answers with fewer when there are fewer.
export const storePageSize = 25

export const searchMaxResults = 8

const notConnected = () => Promise.reject(new Error('The Platform API has no stores operations yet.'))

// Seam: the sample stands in for the Platform API's stores operations until they land; it is invented,
// so it answers only where the ?state= harness does, and a production build shows the error state.
// `billing` is the harness asking the fixture for own-billing mode; the real API knows the partner's mode itself.
export const loadStores = (filter: StoreFilter, page: PageRequest, caller: PartnerRole, billing: BillingMode = 'dripfunnel'): Promise<StorePage> =>
  harnessEnabled ? Promise.resolve(storesServer.list(filter, page, caller, billing)) : notConnected()

// `exportStores(filter)` is a job (§16): everything the filter matches, never an order, customer or product.
export const startStoresExport = (filter: StoreFilter): Promise<ExportJob> =>
  harnessEnabled ? Promise.resolve(storesServer.startExport(filter)) : notConnected()

export const loadStoresExport = (id: string): Promise<ExportJob | null> =>
  harnessEnabled ? Promise.resolve(storesServer.exportJob(id)) : notConnected()

export type BillingStatusResult = { ok: true } | { ok: false; reason: ActionRefusal }

export const setStoreBillingStatus = (id: string, status: BillingStatus, caller: PartnerRole): Promise<BillingStatusResult> =>
  harnessEnabled ? Promise.resolve(storesServer.setBillingStatus(id, status, caller)) : notConnected()

export const searchStores = (query: string): Promise<readonly StoreMatch[]> =>
  harnessEnabled ? Promise.resolve(storesServer.search(query)) : notConnected()

export const loadCreateStoreForm = (caller: PartnerRole, partnerState: PartnerState): Promise<CreateStoreForm> =>
  harnessEnabled ? Promise.resolve(storesServer.form(caller, partnerState)) : notConnected()

export const createStore = (input: CreateStoreInput, caller: PartnerRole, partnerState: PartnerState): Promise<CreateStoreResult> =>
  harnessEnabled ? Promise.resolve(storesServer.create(input, caller, partnerState)) : notConnected()

export const loadProvisioning = (storeId: string): Promise<ProvisioningProgress> =>
  harnessEnabled ? Promise.resolve(storesServer.progress(storeId)) : notConnected()

export const loadStore = (id: string, caller: PartnerRole): Promise<Store | null> =>
  harnessEnabled ? Promise.resolve(storesServer.get(id, caller)) : notConnected()

export const loadChangePlanOptions = (id: string): Promise<ChangePlanOptions> =>
  harnessEnabled ? Promise.resolve(storesServer.changePlanOptions(id)) : notConnected()

export const runStoreAction = (id: string, input: StoreActionInput, caller: PartnerRole): Promise<StoreActionResult> =>
  harnessEnabled ? Promise.resolve(storesServer.run(id, input, caller)) : notConnected()

export const recheckStoreDomain = (id: string): Promise<StoreDomain['status']> =>
  harnessEnabled ? Promise.resolve(storesServer.recheck(id)) : notConnected()
