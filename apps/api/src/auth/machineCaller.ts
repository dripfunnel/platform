import type postgres from 'postgres'
import type { Subscription, TenantContext } from '#core/tenancy'
import { selectPresentedKey, touchApiKey } from '#db/scoped/apiKeys'
import { countApiCall } from '#db/scoped/apiUsage'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { effectiveScopes, hashApiKey, isApiKeyShape } from './apiKeys'
import { isSupplierTier, type StorePermission, type SupplierTier } from './storePermissions'

// API keys on the Store API (ACCESS.md §3, §5.6). Resolved in system scope like a session, on every request, so a
// revocation, an expiry or a supplier's narrowed tier applies to the next one.

export interface MachineActor {
  kind: 'api_key'
  id: string
  /** The key's name at the time, for the activity log (LOGGING.md §4). */
  label: string
  partnerId: string
}

export interface MachineCaller {
  context: TenantContext
  actor: MachineActor
  store: { id: string; name: string; status: Subscription }
  seller: { id: string; name: string } | null
  scopes: ReadonlySet<StorePermission>
}

/** Over the plan's calls: how long until the minute, or the month, starts again. */
export interface CallsLimited {
  retryAfterSeconds: number
}

export interface ApiLimits {
  minute: number
  month: number
}

// What a plan that sets no API limits gets: the lower line SetDev draws (#286).
export const defaultApiLimits: ApiLimits = { minute: 60, month: 100_000 }

/** The plan's calls a minute and a month for this store (decided on #337: per plan, per store). */
export type ApiLimitsOf = (tx: ScopedSql, storeId: string, now: Date) => Promise<ApiLimits>

/** Until the plan sets API limits, every store gets the defaults. */
export const planApiLimits: ApiLimitsOf = () => Promise.resolve(defaultApiLimits)

/** Counts the call against the store's limits; null while it's within both. */
const overLimit = async (tx: ScopedSql, storeId: string, now: Date, limitsOf: ApiLimitsOf): Promise<CallsLimited | null> => {
  const calls = await countApiCall(tx, storeId, now)
  const limits = await limitsOf(tx, storeId, now)
  if (calls.month > limits.month) {
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    return { retryAfterSeconds: Math.ceil((next - now.getTime()) / 1000) }
  }
  if (calls.minute > limits.minute) return { retryAfterSeconds: 60 - now.getUTCSeconds() }
  return null
}

/** The caller a presented key makes on this partner's portal host, null for no such live key, or how long it must wait. */
export const resolveApiKey = async (sql: postgres.Sql, secret: string, partnerId: string, now: Date, limitsOf: ApiLimitsOf): Promise<MachineCaller | CallsLimited | null> => {
  if (!isApiKeyShape(secret)) return null
  const hash = await hashApiKey(secret)
  return withSystemScope(sql, async (tx) => {
    const key = await selectPresentedKey(tx, hash, partnerId, now)
    if (!key) return null
    let tier: SupplierTier | null = null
    if (key.seller_id !== null) {
      // A removed or suspended supplier's key stops (ACCESS.md §7.5); a tier nobody can read grants nothing.
      if (key.seller_status !== 'active' || key.access_level === null || !isSupplierTier(key.access_level)) return null
      tier = key.access_level
    }
    const limited = await overLimit(tx, key.store_id, now, limitsOf)
    if (limited) return limited
    await touchApiKey(tx, key.id, now)
    return {
      actor: { kind: 'api_key', id: key.id, label: key.name, partnerId: key.partner_id },
      store: { id: key.store_id, name: key.store_name, status: key.store_status },
      seller: key.seller_id && key.seller_name ? { id: key.seller_id, name: key.seller_name } : null,
      scopes: effectiveScopes(key.scopes, tier),
      context: {
        caller: { kind: 'api-key', keyId: key.id, createdByUserId: key.created_by_user_id },
        partnerId: key.partner_id,
        storeId: key.store_id,
        sellerScope: key.seller_id ? { kind: 'seller', sellerId: key.seller_id } : { kind: 'all' },
        subscription: key.store_status,
      },
    }
  })
}
