import type postgres from 'postgres'
import { GraphQLError } from 'graphql'
import type { SecretBox } from '#auth/secretBox'
import type { ShopConnect } from '#engine/modules/catalog/index'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { CodeCheck } from '#auth/codeCheck'
import type { StoreCaller, StoreStanding } from '#auth/storeCaller'
import { isStorePermission, storePermissions, storeRoleHas, type StorePermission, type StoreRole } from '#auth/storePermissions'
import { supportActor, type SupportSeat } from '#auth/storeSupport'
import { isUuid } from '#core/ids'
import { withScope } from '#db/scoped/index'
import { accessErrorCode, forbidden, unauthenticated, type Access, type AccessPolicy } from '../graphql/scope'
import type { CourierDirectory } from '#core/couriers'
import type { PaymentWiring } from '#engine/modules/checkout/index'

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

export const supportBlocked = () => refusal('Only someone in the store can change this.', accessErrorCode.blockedForSupport)
export const supportReadOnly = () => refusal('This support session is read-only until the store allows changes.', accessErrorCode.supportReadOnly)

// ACCESS.md §8 "Never", by permission: who works here, payments, billing, its own access, and taking the log away.
export const supportNeverWrites: readonly StorePermission[] = ['invite', 'manage-vendors', 'supplier.team', 'payments.configure', 'billing', 'support.allow_write', 'activity.export']

/** What a support session may not do in its seat; `supportOwn` fields are its own, so its read-only state never refuses them. */
const admitSupport = (access: Access, seat: SupportSeat, permission: StorePermission, operation: string) => {
  if (access.blockedFor?.includes('support')) throw supportBlocked()
  if (operation !== 'mutation' || access.supportOwn) return
  if (supportNeverWrites.includes(permission)) throw supportBlocked()
  if (seat.access === 'read') throw supportReadOnly()
}

// The shell's poll reads only the banner and the store's status (ACCESS.md §8.3), not a page support opened.
const unloggedSupportReads = new Set(['storeState'])

/** LOGGING.md §3: a support session's reads are logged, by field and the id it named, never its other arguments. */
const logSupportRead = async (ctx: StoreContext, caller: StoreCaller, seat: SupportSeat, field: string, args: Record<string, unknown>) => {
  if (!ctx.sql) return
  const id = args['id']
  await withScope(ctx.sql, caller.context, (tx) =>
    ctx.activity.record(tx, {
      category: 'support',
      action: 'support_session.viewed',
      result: 'success',
      ...supportActor(seat),
      partnerId: caller.context.partnerId,
      storeId: caller.store.id,
      sellerId: caller.seller?.id ?? null,
      target: { type: 'query', id: typeof id === 'string' && isUuid(id) ? id : field, label: field },
      reason: null,
      api: 'store',
      visibility: 'store',
      ...ctx.facts,
    }),
  )
}

/**
 * ACCESS.md §5.1–5.2 per role and tier, within the acting store only. `store` fields are the
 * merchant side's; `store-seller` fields admit suppliers too, on their own rows. Read-only, every
 * write is refused but the few declared `whileReadOnly` (SAAS.md §4.2).
 */
export const storePolicy: AccessPolicy<StoreContext> = {
  api: 'store',
  scopes: ['public', 'session', 'store', 'store-seller'],
  permissions: storePermissions,
  authorize: async (access, ctx, args, operation, field) => {
    const { standing } = ctx
    if (standing.kind === 'signed-out') throw unauthenticated()
    const support = standing.kind === 'acting' ? standing.caller.support : undefined
    // A support session is not a person: nothing of the account it acts as is its own (ACCESS.md §8).
    if (access.scope === 'session') {
      if (support) throw supportBlocked()
      return
    }
    if (standing.kind === 'no-store') throw storeRequired()
    if (standing.kind === 'supplier-required') throw supplierRequired()
    if (standing.kind === 'crossing') throw forbidden()
    const { caller } = standing
    if (caller.store.status === 'suspended') throw storeSuspended()
    if (access.scope === 'store' && caller.role.side === 'supplier') throw forbidden()
    if (access.permission === null || !isStorePermission(access.permission) || !storeRoleHas(caller.role, access.permission)) throw forbidden()
    if (access.supportOwn && !support) throw forbidden()
    if (support) admitSupport(access, support, access.permission, operation)
    if (operation === 'mutation' && writeRefused(caller.role, caller.store.status, access.permission) && !access.whileReadOnly) throw readOnly()
    if (support && operation === 'query' && field.root && !unloggedSupportReads.has(field.name)) await logSupportRead(ctx, caller, support, field.name, args)
  },
}

/** The caller a guarded resolver runs for; the policy has already admitted it. */
export const actingCaller = ({ standing }: StoreContext): StoreCaller => {
  if (standing.kind !== 'acting') throw forbidden()
  return standing.caller
}
