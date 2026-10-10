import type postgres from 'postgres'
import { GraphQLError } from 'graphql'
import type { SecretBox } from '#auth/secretBox'
import type { ShopConnect } from '#engine/modules/catalog/index'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { CodeCheck } from '#auth/codeCheck'
import type { StoreCaller, StoreStanding } from '#auth/storeCaller'
import { isStorePermission, storePermissions, storeRoleHas, type StorePermission, type StoreRole } from '#auth/storePermissions'
import { accessErrorCode, forbidden, unauthenticated, type AccessPolicy } from '../graphql/scope'
import type { CourierDirectory } from '#core/couriers'
import type { PaymentWiring } from '#engine/modules/checkout/index'
import type { StoreBillingStripe, StripeApi } from '#integrations/stripe/index'

export interface StoreContext extends Record<string, unknown> {
  /** Where the request stands on this portal host (auth/storeCaller.ts). */
  standing: StoreStanding
  /** The host's partner; null only when the Worker has no database to tell. */
  partnerId: string | null
  activity: ActivityLog
  /** Null when the Worker has no database: every guarded field then answers UNAUTHENTICATED. */
  sql: postgres.Sql | null
  facts: RequestFacts
  /** The credential key (THIRD-PARTY-ACCESS §5): My profile's authenticator set-up needs it. */
  secrets?: SecretBox | null
  /** The portal host, which Connect Shopify comes back to. */
  host?: string
  /** Connect Shopify's app, or null where none is set up (CATALOG K7). */
  shopify?: ShopConnect | null
  /** The partners' couriers (THIRD-PARTY-ACCESS §4), or null where none can be reached yet (#275). */
  couriers?: CourierDirectory | null
  /** DripFunnel's own Stripe account, which bills the store's plan (SAAS §7.2); null where its keys aren't set. */
  billing?: (StripeApi & StoreBillingStripe) | null
  /** The card adapters and Connect Stripe (SAPI 10); null where none is set up. */
  payments?: PaymentWiring | null
  codeCheck?: CodeCheck
  /** The offer-code limiter (OFFER_CODE_RATE_LIMITER) by key; "Check a code" refuses everything where it isn't bound. */
  allowCodeCheck?: (key: string) => Promise<boolean>
  now: () => Date
}

export const signedOutStoreContext = (facts: RequestFacts, activity: ActivityLog): StoreContext => ({ standing: { kind: 'signed-out' }, partnerId: null, sql: null, activity, facts, now: () => new Date() })

// One message per code, whatever the store: a refusal must not say whether a store exists.
const refusal = (message: string, code: string) => new GraphQLError(message, { extensions: { code } })
export const storeRequired = () => refusal('Choose a store.', accessErrorCode.storeRequired)
export const supplierRequired = () => refusal('Choose which supplier you are acting for.', accessErrorCode.supplierRequired)
export const storeSuspended = () => refusal('This store is suspended.', accessErrorCode.storeSuspended)
export const readOnly = () => refusal('This store is read-only.', accessErrorCode.readOnly)

/** Past due or cancelled for the merchant side; a supplier keeps working while past due and isn't told (FIRST-RELEASE §1). */
export const readOnlyFor = (role: StoreRole, status: string): boolean => status === 'cancelled' || (status === 'past_due' && role.side === 'merchant')

// The decision's "stock, shipping" (#337): what a past-due store's supplier still writes; the rest waits as the merchant's does.
const supplierWorkWhilePastDue: readonly StorePermission[] = ['stock.write', 'warehouses.write', 'orders.fulfil']

const writeRefused = (role: StoreRole, status: string, permission: StorePermission): boolean =>
  readOnlyFor(role, status) || (status === 'past_due' && role.side === 'supplier' && !supplierWorkWhilePastDue.includes(permission))

/**
 * ACCESS.md §5.1–5.2 per role and tier, within the acting store only. `store` fields are the
 * merchant side's; `store-seller` fields admit suppliers too, on their own rows. Read-only, every
 * write is refused but the few declared `whileReadOnly` (SAAS.md §4.2).
 */
export const storePolicy: AccessPolicy<StoreContext> = {
  api: 'store',
  scopes: ['public', 'session', 'store', 'store-seller'],
  permissions: storePermissions,
  authorize: async (access, { standing }, _args, operation) => {
    if (standing.kind === 'signed-out') throw unauthenticated()
    if (access.scope === 'session') return
    if (standing.kind === 'no-store') throw storeRequired()
    if (standing.kind === 'supplier-required') throw supplierRequired()
    if (standing.kind === 'crossing') throw forbidden()
    const { caller } = standing
    if (caller.store.status === 'suspended') throw storeSuspended()
    if (access.scope === 'store' && caller.role.side === 'supplier') throw forbidden()
    if (access.permission === null || !isStorePermission(access.permission) || !storeRoleHas(caller.role, access.permission)) throw forbidden()
    if (operation === 'mutation' && writeRefused(caller.role, caller.store.status, access.permission) && !access.whileReadOnly) throw readOnly()
  },
}

/** The caller a guarded resolver runs for; the policy has already admitted it. */
export const actingCaller = ({ standing }: StoreContext): StoreCaller => {
  if (standing.kind !== 'acting') throw forbidden()
  return standing.caller
}
