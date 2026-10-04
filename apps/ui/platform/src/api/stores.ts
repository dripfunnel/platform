import type { Money } from '@dripfunnel/shared/format'
import { ApiError, isApiError, type ExportJob, type PageInfo, type PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'
import { exportJobFields, exportJobSchema, readExportJob } from './exportJob'

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
// A trial or cancellation the API has no date for carries null, so one such store never fails the list.
export type StoreState =
  | { kind: 'trial'; trialEndsAt: string | null; daysLeft: number | null }
  | { kind: 'active' }
  | { kind: 'pastdue'; daysPastDue: number }
  | { kind: 'suspended'; reason: string }
  | { kind: 'cancelled'; since: string | null }

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
  // Null for a store with no plan on record.
  plan: { id: string; name: string } | null
  // The API's figure when a limit is at 80% or more (§6.1), null otherwise.
  near: { percent: number; limit: LimitKey } | null
  state: StoreState
  salesLastMonth: Money | null
  storefront: StorefrontState
  // The store's own domain; null while it uses the partner's shop address (§9.3).
  domain: StoreDomain | null
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
export const createRefusals = ['OWNERS_AND_ADMINS_ONLY', 'PARTNER_NOT_LIVE', 'PARTNER_PAUSED', 'STORE_LIMIT_REACHED', 'READ_ONLY', 'PLAN_NOT_LIVE', 'UNPRICED_CURRENCY', 'INVALID_INPUT'] as const
export type CreateRefusal = (typeof createRefusals)[number]

export type CreatePermission = { allowed: true } | { allowed: false; reason: CreateRefusal }

export const actionRefusals = [
  'OWNERS_AND_ADMINS_ONLY',
  'FINANCE_TRIAL_ONLY',
  'BILLING_ROLES_ONLY',
  'ALREADY_SUSPENDED',
  'NOT_SUSPENDED',
  'NOT_ON_TRIAL',
  'NOT_STUCK',
  'NO_PENDING_INVITATION',
  'NO_BILLING_DATE',
  'SAME_PLAN',
  'PLAN_NOT_LIVE',
  'UNPRICED_CURRENCY',
  'NOT_SELF_BILLING',
  'CANCELLED',
  'NOT_FOUND',
  'INVALID_INPUT',
  'READ_ONLY',
] as const
export type ActionRefusal = (typeof actionRefusals)[number]

export type ActionPermission = { allowed: true } | { allowed: false; reason: ActionRefusal }

export interface StorePage {
  items: readonly StoreRow[]
  pageInfo: PageInfo
  plans: readonly { id: string; name: string }[]
  billingMode: BillingMode
  // Every role may export (ACCESS.md §5.3); `billingStatus` is offered only in own-billing mode, to Owner, Admin and Finance.
  actions: { create: CreatePermission; export: ActionPermission; billingStatus?: ActionPermission }
}

export interface CreateStoreForm {
  permission: CreatePermission
  // `code` is what the API takes; `name` is shown.
  countries: readonly { code: string; name: string; currency: string }[]
  // `trialDays` is the plan's own trial, which the form starts from.
  plans: readonly { id: string; name: string; price: Readonly<Record<string, Money>>; trialDays: number }[]
  trials: readonly number[]
  billingMode: BillingMode
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
  limit: LimitKey
  amount: number
  duration: 'month' | 'always'
  reason: string
  by: string
  at: string
}

export interface StoreBilling {
  // Both null for a store with no subscription yet.
  cycle: 'monthly' | 'yearly' | null
  price: Money | null
  next: { kind: 'firstCharge'; at: string } | { kind: 'charge'; at: string } | { kind: 'none' }
  // The API sends no payment state yet: `noCard` is the one fact it gives (no card on file).
  payment: 'noCard' | null
  // The last four digits only, or null with no card on file.
  cardLast4: string | null
  mode: 'dripfunnel' | 'own'
  // The partner the subscription is charged for, as the API names it.
  partnerName: string
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
  status: StoreDomain['status']
  since: string
}

export type SetupStepState = 'done' | 'running' | 'slow' | 'failed' | 'waiting'

// When a finished step ran, or the API's sentence about one that is still running.
export type SetupStepDetail = { kind: 'at'; at: string } | { kind: 'text'; text: string } | null

export interface StorePerson {
  id: string
  name: string
  email: string
  // The API's role key; `supplier` names the supplier a person belongs to.
  role: string
  supplier: string | null
  status: 'active' | 'invited' | 'suspended'
  lastSignInAt: string | null
}

export interface StoreSession {
  who: string
  reason: string
  at: string
  how: 'open' | 'expired' | 'ended'
}

// The API's action code; the tab words it (LOGGING.md §7).
export interface StoreActivityEntry {
  id: string
  at: string
  who: string
  action: string
  result: 'success' | 'denied' | 'failed'
}

// Not sent by the API yet, so empty here: last month's sales and orders, invoices, the status
// history and support sessions (#166's findings).
export interface Store extends StoreRow {
  country: string
  planPrice: Money | null
  people: { count: number; suppliers: number }
  ordersLastMonth: number | null
  contacts: readonly { name: string; email: string; role: string }[]
  history: readonly { at: string; text: string; by: string }[]
  usage: readonly StoreUsage[]
  overrides: readonly StoreOverride[]
  billing: StoreBilling
  invoices: readonly StoreInvoice[]
  site: { previewHost: string | null; liveHost: string | null; lastPublishAt: string | null }
  records: readonly StoreDnsRecord[]
  setup: { steps: readonly { key: ProvisioningStepKey; state: SetupStepState; detail: SetupStepDetail }[]; stuck: boolean; error: string | null }
  // The ends the API offers Extend trial, worked out by it; empty when the store is not on trial.
  trialExtensions: readonly { days: number; endsAt: string }[]
  support: { allowed: boolean; people: readonly StorePerson[]; sessions: readonly StoreSession[] }
  activity: readonly StoreActivityEntry[]
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
  nextBillingAt: string | null
  // The API's proration for moving now, per plan: an amount charged today, a credit, or nothing.
  proration: Readonly<Record<string, { kind: 'charge'; amount: Money } | { kind: 'credit'; amount: Money } | { kind: 'none' }>>
}

// The API's cap on a page; it answers with fewer when there are fewer.
export const storePageSize = 25

// The API names usage limits by their stored keys; the console by its own (`limitKeys`).
const limitOf = z
  .enum(['products', 'staff', 'suppliers', 'ai_prompts', 'publish_now', 'ai', 'publish'])
  .transform((key): LimitKey => (key === 'ai_prompts' ? 'ai' : key === 'publish_now' ? 'publish' : key))

const money = z.object({ amount: z.number().int(), currency: z.string() })
const ref = z.object({ id: z.string(), name: z.string() })

const stateSchema = z
  .object({ kind: z.enum(storeStatuses), trialEndsAt: z.string().nullable(), daysLeft: z.number().int().nullable(), daysPastDue: z.number().int().nullable(), reason: z.string().nullable(), since: z.string().nullable() })
  .transform((s): StoreState => {
    if (s.kind === 'active') return { kind: 'active' }
    if (s.kind === 'pastdue') return { kind: 'pastdue', daysPastDue: s.daysPastDue ?? 0 }
    if (s.kind === 'suspended') return { kind: 'suspended', reason: s.reason ?? '' }
    if (s.kind === 'cancelled') return { kind: 'cancelled', since: s.since }
    return { kind: 'trial', trialEndsAt: s.trialEndsAt, daysLeft: s.daysLeft }
  })

const permissionOf = <Code extends string>(codes: readonly [Code, ...Code[]]) =>
  z.object({ allowed: z.boolean(), reason: z.string().nullable() }).transform((p, ctx): { allowed: true } | { allowed: false; reason: Code } => {
    if (p.allowed) return { allowed: true }
    const reason = z.enum(codes).safeParse(p.reason)
    if (reason.success) return { allowed: false, reason: reason.data }
    ctx.addIssue({ code: 'custom', message: `unknown refusal ${p.reason ?? 'null'}` })
    return z.NEVER
  })
const actionPermission = permissionOf(actionRefusals)
const createPermission = permissionOf(createRefusals)

const rowSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  // A store with no owner on record has neither.
  owner: z.object({ name: z.string().nullable().transform((v) => v ?? ''), email: z.string().nullable().transform((v) => v ?? '') }),
  plan: ref.nullable(),
  near: z.object({ percent: z.number().int(), limit: limitOf }).nullable(),
  state: stateSchema,
  storefront: z.enum(storefrontStates),
  domain: z.object({ host: z.string(), custom: z.boolean(), status: z.enum(['live', 'waiting', 'failed']) }).nullable(),
  createdAt: z.string(),
  billingStatus: z.enum(['active', 'past_due', 'suspended']).nullable(),
})
const rowFields = `id name code owner { name email } plan { id name } near { percent limit }
  state { kind trialEndsAt daysLeft daysPastDue reason since } storefront domain { host custom status } createdAt billingStatus`

// The list has no sales figure from the API yet (#166's findings).
const rowOf = (row: z.infer<typeof rowSchema>): StoreRow => ({ ...row, salesLastMonth: null, billingStatus: row.billingStatus === 'past_due' ? 'pastdue' : row.billingStatus })

const pageSchema = z.object({
  stores: z.object({
    items: z.array(rowSchema),
    pageInfo: z.object({ startCursor: z.string().nullable(), endCursor: z.string().nullable(), hasPreviousPage: z.boolean(), hasNextPage: z.boolean() }),
    plans: z.array(ref),
    billingMode: z.enum(billingModes),
    createPermission,
    exportPermission: actionPermission,
    billingStatusPermission: actionPermission.nullable(),
  }),
})

// The filter as the API's input declares it: a harness key never reaches it.
const filterOf = (filter: StoreFilter): StoreFilter => ({ status: filter.status, plan: filter.plan, created: filter.created, storefront: filter.storefront, near: filter.near, q: filter.q })

export const loadStores = async (filter: StoreFilter, page: PageRequest): Promise<StorePage> => {
  const { stores } = await query(
    `query Stores($filter: StoreFilterInput, $after: String, $before: String) {
      stores(filter: $filter, after: $after, before: $before, first: ${storePageSize}) {
        items { ${rowFields} } pageInfo { startCursor endCursor hasPreviousPage hasNextPage } plans { id name } billingMode
        createPermission { allowed reason } exportPermission { allowed reason } billingStatusPermission { allowed reason }
      }
    }`,
    pageSchema,
    { filter: filterOf(filter), after: page.after, before: page.before },
  )
  return {
    items: stores.items.map(rowOf),
    pageInfo: stores.pageInfo,
    plans: stores.plans,
    billingMode: stores.billingMode,
    actions: { create: stores.createPermission, export: stores.exportPermission, ...(stores.billingStatusPermission ? { billingStatus: stores.billingStatusPermission } : {}) },
  }
}

// The export's CSV comes inline until a storage bucket is bound (THIRD-PARTY-ACCESS §2.1): a link
// made once per job and revoked when the job expires, so the merchants' list doesn't outlive it.
// `exportStores(filter)` is a job (§16): everything the filter matches, never an order, customer or product.
export const startStoresExport = async (filter: StoreFilter): Promise<ExportJob> => {
  const { exportStores: started } = await query(
    `mutation Export($filter: StoreFilterInput) { exportStores(filter: $filter) { ok jobId reason } }`,
    z.object({ exportStores: z.object({ ok: z.boolean(), jobId: z.string().nullable(), reason: z.string().nullable() }) }),
    { filter: filterOf(filter) },
  )
  if (!started.ok || !started.jobId) throw new ApiError(started.reason ?? 'UNKNOWN', 'The API refused the export.')
  return { id: started.jobId, state: 'preparing', entries: null, url: null, expiresAt: null }
}

export const loadStoresExport = async (id: string): Promise<ExportJob | null> =>
  readExportJob((await query(`query StoresExport($id: ID!) { storesExport(id: $id) { ${exportJobFields} } }`, z.object({ storesExport: exportJobSchema.nullable() }), { id })).storesExport)

export type BillingStatusResult = { ok: true } | { ok: false; reason: ActionRefusal }

export const setStoreBillingStatus = async (id: string, status: BillingStatus): Promise<BillingStatusResult> => {
  const { setStoreBillingStatus: result } = await query(
    `mutation Billing($id: ID!, $status: String!) { setStoreBillingStatus(id: $id, status: $status) { ok reason } }`,
    z.object({ setStoreBillingStatus: z.object({ ok: z.boolean(), reason: z.enum(actionRefusals).nullable() }) }),
    { id, status: status === 'pastdue' ? 'past_due' : status },
  )
  return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'INVALID_INPUT' }
}

export const loadCreateStoreForm = async (): Promise<CreateStoreForm> => {
  const { createStoreForm: form } = await query(
    `{ createStoreForm { permission { allowed reason } countries { code name currency } plans { id name prices { amount currency } trialDays } trials billingMode } }`,
    z.object({
      createStoreForm: z.object({
        permission: createPermission,
        countries: z.array(z.object({ code: z.string(), name: z.string(), currency: z.string() })),
        plans: z.array(z.object({ id: z.string(), name: z.string(), prices: z.array(money), trialDays: z.number().int() })),
        trials: z.array(z.number().int()),
        billingMode: z.enum(billingModes),
      }),
    }),
  )
  return { ...form, plans: form.plans.map((plan) => ({ id: plan.id, name: plan.name, trialDays: plan.trialDays, price: Object.fromEntries(plan.prices.map((price) => [price.currency, price])) })) }
}

export const createStore = async (input: CreateStoreInput): Promise<CreateStoreResult> => {
  const { createStore: result } = await query(
    `mutation Create($input: CreateStoreInput!) { createStore(input: $input) { ok storeId reason field } }`,
    z.object({ createStore: z.object({ ok: z.boolean(), storeId: z.string().nullable(), reason: z.enum(createRefusals).nullable(), field: z.string().nullable() }) }),
    { input },
  )
  return result.ok && result.storeId ? { ok: true, storeId: result.storeId } : { ok: false, reason: result.reason ?? 'INVALID_INPUT' }
}

const progressSchema = z.object({ done: z.boolean(), elapsedSeconds: z.number().int(), steps: z.array(z.object({ key: z.enum(provisioningSteps), state: z.enum(['done', 'running', 'waiting', 'failed']) })) })

export const loadProvisioning = async (storeId: string): Promise<ProvisioningProgress> => {
  const { provisioning } = await query(`query Progress($storeId: ID!) { provisioning(storeId: $storeId) { done elapsedSeconds steps { key state } } }`, z.object({ provisioning: progressSchema.nullable() }), { storeId })
  if (!provisioning) throw new ApiError('NOT_FOUND', 'No signup job for this store.')
  return provisioning
}

const detailSchema = z.object({
  store: z
    .object({
      row: rowSchema,
      country: z.string().nullable().transform((v) => v ?? ''),
      price: money.nullable(),
      people: z.object({ count: z.number().int(), suppliers: z.number().int() }),
      contacts: z.array(z.object({ name: z.string(), email: z.string(), role: z.string() })),
      usage: z.array(z.object({ limit: limitOf, used: z.number().int(), cap: z.number().int().nullable(), percent: z.number().int().nullable(), monthly: z.boolean() })),
      overrides: z.array(z.object({ id: z.string(), limit: limitOf, amount: z.number().int(), duration: z.enum(['month', 'always']), reason: z.string(), by: z.string(), at: z.string() })),
      billing: z.object({ interval: z.enum(['month', 'year']).transform((i) => (i === 'month' ? 'monthly' : 'yearly')).nullable(), nextChargeAt: z.string().nullable(), cardLast4: z.string().nullable(), mode: z.enum(billingModes), partnerName: z.string() }),
      site: z.object({ previewHost: z.string().nullable(), liveHost: z.string().nullable(), lastPublishAt: z.string().nullable() }),
      records: z.array(z.object({ host: z.string(), status: z.enum(['live', 'waiting', 'failed']), type: z.literal('CNAME'), value: z.string(), found: z.string().nullable(), since: z.string() })),
      setup: z.object({ state: z.enum(['done', 'running', 'stuck', 'failed', 'cleaning']), error: z.string().nullable() }),
      // Extend trial's offers, dated by the API as it will grant them (FIRST-RELEASE §6.4).
      trialOffers: z.array(z.object({ days: z.number().int(), endsAt: z.string() })),
      support: z.object({
        allowed: z.boolean(),
        people: z.array(z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.string(), supplier: z.string().nullable(), status: z.enum(['active', 'invited', 'suspended']), lastSignInAt: z.string().nullable() })),
      }),
      activity: z.array(z.object({ id: z.string(), at: z.string(), who: z.string().nullable().transform((v) => v ?? ''), action: z.string(), result: z.enum(['success', 'denied', 'failed']) })),
      actions: z.object(Object.fromEntries(storeActions.map((action) => [action, actionPermission.nullable()])) as Record<StoreAction, z.ZodNullable<typeof actionPermission>>),
    })
    .nullable(),
})

const permissionsOf = (actions: Partial<Record<StoreAction, StorePermissions[StoreAction] | null>>): StorePermissions =>
  Object.fromEntries(Object.entries(actions).filter(([, permission]) => permission !== null)) as StorePermissions

// The store page (§6.3). The signup's five steps come from `provisioning`, as on Create store;
// what the API doesn't send yet stays empty here (`Store`).
// A store's name alone, for a filter that names a store the page hasn't listed; nothing when it can't be read.
export const loadStoreName = (id: string): Promise<{ id: string; name: string } | null> =>
  query(`query StoreName($id: ID!) { store(id: $id) { row { id name } } }`, z.object({ store: z.object({ row: z.object({ id: z.string(), name: z.string() }) }).nullable() }), { id }).then(
    ({ store }) => store?.row ?? null,
    () => null,
  )

export const loadStore = async (id: string): Promise<Store | null> => {
  const { store: s } = await query(
    `query Store($id: ID!) {
      store(id: $id) {
        row { ${rowFields} } country price { amount currency } people { count suppliers } contacts { name email role }
        usage { limit used cap percent monthly } overrides { id limit amount duration reason by at }
        billing { interval nextChargeAt cardLast4 mode partnerName } site { previewHost liveHost lastPublishAt }
        records { host status type value found since } setup { state error } trialOffers { days endsAt }
        support { allowed people { id name email role supplier status lastSignInAt } }
        activity { id at who action result }
        actions { ${storeActions.map((action) => `${action} { allowed reason }`).join(' ')} }
      }
    }`,
    detailSchema,
    { id },
  )
  if (!s) return null
  // No signup job is an empty Setup tab; any other failure is the page's to show.
  const progress = await loadProvisioning(id).catch((error: unknown) => (isApiError(error) && error.code === 'NOT_FOUND' ? null : Promise.reject(error)))
  const row = rowOf(s.row)
  const stuck = s.setup.state === 'stuck'
  return {
    ...row,
    // Without its own domain the store answers at its shop address (§9.3).
    domain: row.domain ?? (s.site.liveHost ? { host: s.site.liveHost, custom: false, status: 'live' } : null),
    country: s.country,
    planPrice: s.price,
    people: s.people,
    ordersLastMonth: null,
    contacts: s.contacts,
    history: [],
    usage: s.usage,
    overrides: s.overrides,
    billing: {
      cycle: s.billing.interval,
      price: s.price,
      next: !s.billing.nextChargeAt ? { kind: 'none' } : row.state.kind === 'trial' ? { kind: 'firstCharge', at: s.billing.nextChargeAt } : { kind: 'charge', at: s.billing.nextChargeAt },
      payment: s.billing.cardLast4 ? null : 'noCard',
      cardLast4: s.billing.cardLast4,
      mode: s.billing.mode,
      partnerName: s.billing.partnerName,
    },
    invoices: [],
    site: s.site,
    records: s.records.map((record) => ({ type: record.type, name: record.host, value: record.value, found: record.found, status: record.status, since: record.since })),
    setup: {
      steps: (progress?.steps ?? []).map((step) => ({ key: step.key, state: step.state === 'running' && stuck ? 'slow' : step.state, detail: null })),
      stuck,
      error: s.setup.error,
    },
    // The API sends past extensions; the offers are §6.4's three, from the trial's end (#166's findings).
    trialExtensions: s.trialOffers,
    support: {
      allowed: s.support.allowed,
      people: s.support.people,
      sessions: [],
    },
    activity: s.activity,
    actions: permissionsOf(s.actions),
  }
}

export const loadChangePlanOptions = async (id: string): Promise<ChangePlanOptions> => {
  const { changePlanOptions: options } = await query(
    `query Options($storeId: ID!) { changePlanOptions(storeId: $storeId) { ok reason nextBillingAt plans { id name amount currency proration { kind amount currency } } } }`,
    z.object({
      changePlanOptions: z.object({
        ok: z.boolean(),
        reason: z.string().nullable(),
        nextBillingAt: z.string().nullable(),
        plans: z.array(z.object({ id: z.string(), name: z.string(), amount: z.number().int(), currency: z.string(), proration: z.object({ kind: z.enum(['charge', 'credit', 'none']), amount: z.number().int().nullable(), currency: z.string() }) })).nullable(),
      }),
    }),
    { storeId: id },
  )
  if (!options.ok || !options.plans) throw new ApiError(options.reason ?? 'UNKNOWN', 'The API offered no plans to move to.')
  return {
    plans: options.plans.map((plan) => ({ id: plan.id, name: plan.name, price: { amount: plan.amount, currency: plan.currency } })),
    nextBillingAt: options.nextBillingAt,
    proration: Object.fromEntries(
      options.plans.map((plan) => [plan.id, plan.proration.kind === 'none' || plan.proration.amount === null ? { kind: 'none' as const } : { kind: plan.proration.kind, amount: { amount: plan.proration.amount, currency: plan.proration.currency } }]),
    ),
  }
}

// Each §6.4 action is its own mutation; a refusal comes back by its stable code.
const actionCalls: Record<StoreActionInput['action'], { field: string; args: string; call: string }> = {
  changePlan: { field: 'changeStorePlan', args: '($id: ID!, $planId: ID!, $when: String!, $reason: String!)', call: 'changeStorePlan(id: $id, planId: $planId, when: $when, reason: $reason)' },
  extendTrial: { field: 'extendTrial', args: '($id: ID!, $days: Int!, $reason: String!)', call: 'extendTrial(id: $id, days: $days, reason: $reason)' },
  addOverride: { field: 'addLimitOverride', args: '($id: ID!, $limit: String!, $amount: Int!, $duration: String!, $reason: String!)', call: 'addLimitOverride(id: $id, limit: $limit, amount: $amount, duration: $duration, reason: $reason)' },
  suspend: { field: 'suspendStore', args: '($id: ID!, $reason: String!)', call: 'suspendStore(id: $id, reason: $reason)' },
  restore: { field: 'restoreStore', args: '($id: ID!, $reason: String!)', call: 'restoreStore(id: $id, reason: $reason)' },
  resendInvite: { field: 'resendStoreOwnerInvite', args: '($id: ID!)', call: 'resendStoreOwnerInvite(id: $id)' },
  retryStep: { field: 'retryProvisioningStep', args: '($id: ID!)', call: 'retryProvisioningStep(id: $id)' },
}

// The API's own limit keys for an override.
const limitKeyOut: Record<LimitKey, string> = { products: 'products', staff: 'staff', suppliers: 'suppliers', ai: 'ai_prompts', publish: 'publish_now' }

export const runStoreAction = async (id: string, input: StoreActionInput): Promise<StoreActionResult> => {
  const { field, args, call } = actionCalls[input.action]
  const { action, ...rest } = input
  const variables = { id, ...rest, ...(action === 'addOverride' && 'limit' in rest ? { limit: limitKeyOut[rest.limit] } : {}) }
  const result = (await query(`mutation Act${args} { ${call} { ok reason } }`, z.object({ [field]: z.object({ ok: z.boolean(), reason: z.enum(actionRefusals).nullable() }) }), variables))[field] as { ok: boolean; reason: ActionRefusal | null }
  return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'INVALID_INPUT' }
}

// The check runs out of the request; the store page shows its answer on the next load.
export const recheckStoreDomain = async (id: string): Promise<void> => {
  const { recheckMerchantDomain: result } = await query(
    `mutation Recheck($storeId: ID!) { recheckMerchantDomain(storeId: $storeId) { ok reason } }`,
    z.object({ recheckMerchantDomain: z.object({ ok: z.boolean(), reason: z.string().nullable() }) }),
    { storeId: id },
  )
  if (!result.ok) throw new ApiError(result.reason ?? 'UNKNOWN', 'The API refused the check.')
}
