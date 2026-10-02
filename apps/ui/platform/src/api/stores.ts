import type { Money } from '@dripfunnel/shared/format'
import type { PageInfo, PageRequest } from '@dripfunnel/shared/graphql'
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

export interface StorePage {
  items: readonly StoreRow[]
  pageInfo: PageInfo
  plans: readonly { id: string; name: string }[]
  actions: { create: CreatePermission }
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

// The API's cap on a page; it answers with fewer when there are fewer.
export const storePageSize = 25

export const searchMaxResults = 8

const notConnected = () => Promise.reject(new Error('The Platform API has no stores operations yet.'))

// Seam: the sample stands in for the Platform API's stores operations until they land; it is invented,
// so it answers only where the ?state= harness does, and a production build shows the error state.
export const loadStores = (filter: StoreFilter, page: PageRequest, caller: PartnerRole): Promise<StorePage> =>
  harnessEnabled ? Promise.resolve(storesServer.list(filter, page, caller)) : notConnected()

export const searchStores = (query: string): Promise<readonly StoreMatch[]> =>
  harnessEnabled ? Promise.resolve(storesServer.search(query)) : notConnected()

export const loadCreateStoreForm = (caller: PartnerRole, partnerState: PartnerState): Promise<CreateStoreForm> =>
  harnessEnabled ? Promise.resolve(storesServer.form(caller, partnerState)) : notConnected()

export const createStore = (input: CreateStoreInput, caller: PartnerRole, partnerState: PartnerState): Promise<CreateStoreResult> =>
  harnessEnabled ? Promise.resolve(storesServer.create(input, caller, partnerState)) : notConnected()

export const loadProvisioning = (storeId: string): Promise<ProvisioningProgress> =>
  harnessEnabled ? Promise.resolve(storesServer.progress(storeId)) : notConnected()
