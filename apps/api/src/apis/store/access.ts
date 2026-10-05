import type postgres from 'postgres'
import { GraphQLError } from 'graphql'
import type { RequestFacts } from '#auth/activity'
import type { StoreCaller, StoreStanding } from '#auth/storeCaller'
import { isStorePermission, storePermissions, storeRoleHas } from '#auth/storePermissions'
import { accessErrorCode, forbidden, unauthenticated, type AccessPolicy } from '../graphql/scope'

export interface StoreContext extends Record<string, unknown> {
  /** Where the request stands on this portal host (auth/storeCaller.ts). */
  standing: StoreStanding
  /** Null when the Worker has no database: every guarded field then answers UNAUTHENTICATED. */
  sql: postgres.Sql | null
  facts: RequestFacts
  now: () => Date
}

export const signedOutStoreContext = (facts: RequestFacts): StoreContext => ({ standing: { kind: 'signed-out' }, sql: null, facts, now: () => new Date() })

// One message per code, whatever the store: a refusal must not say whether a store exists.
const refusal = (message: string, code: string) => new GraphQLError(message, { extensions: { code } })
export const storeRequired = () => refusal('Choose a store.', accessErrorCode.storeRequired)
export const supplierRequired = () => refusal('Choose which supplier you are acting for.', accessErrorCode.supplierRequired)
export const storeSuspended = () => refusal('This store is suspended.', accessErrorCode.storeSuspended)
export const readOnly = () => refusal('This store is read-only.', accessErrorCode.readOnly)

/**
 * ACCESS.md §5.1–5.2 per role and tier, within the acting store only. `store` fields are the
 * merchant side's; `store-seller` fields admit suppliers too, on their own rows. Past due or
 * cancelled, every write is refused but the few declared `whileReadOnly` (SAAS.md §4.2).
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
    const frozen = caller.store.status === 'past_due' || caller.store.status === 'cancelled'
    if (operation === 'mutation' && frozen && !access.whileReadOnly) throw readOnly()
  },
}

/** The caller a guarded resolver runs for; the policy has already admitted it. */
export const actingCaller = ({ standing }: StoreContext): StoreCaller => {
  if (standing.kind !== 'acting') throw forbidden()
  return standing.caller
}
