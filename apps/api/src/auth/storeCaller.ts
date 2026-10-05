import type postgres from 'postgres'
import { logEvent } from '#core/log'
import type { Subscription, TenantContext } from '#core/tenancy'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { selectHeldStoreIds, selectMemberships, selectPortalPartner, selectStorePerson, type MembershipRow } from '#db/scoped/storeCaller'
import type { ActivityLog, RequestFacts } from './activity'
import { readCookie } from './cookie'
import { hashSessionId } from './session'
import { readUserSession, storeCookieName } from './storeSession'
import { isMerchantRole, isSupplierRole, isSupplierTier, type StoreRole } from './storePermissions'

// The acting store and, for a person working for more than one supplier in it, the acting
// supplier (ACCESS.md §4).
export const storeHeader = 'x-store'
export const supplierHeader = 'x-supplier'

export interface StorePerson {
  id: string
  name: string
  email: string
  partnerId: string
}

export interface StoreCaller {
  person: StorePerson
  context: TenantContext
  role: StoreRole
  membershipId: string
  store: { id: string; name: string; status: Subscription }
  /** Null for the merchant side. */
  seller: { id: string; name: string } | null
  plan: { id: string; name: string } | null
}

/**
 * Where a request on the portal host stands. Only `acting` reaches store data; the rest are the
 * refusals of ACCESS.md §4 told apart, so the API can answer each with its own code.
 */
export type StoreStanding =
  | { kind: 'signed-out' }
  | { kind: 'no-store'; person: StorePerson }
  | { kind: 'supplier-required'; person: StorePerson }
  | { kind: 'crossing'; person: StorePerson }
  | { kind: 'acting'; person: StorePerson; caller: StoreCaller }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The partner whose portal host this is; null answers 404 (docs/ARCHITECTURE.md §2). */
export const resolvePortalPartner = async (sql: postgres.Sql, host: string): Promise<string | null> =>
  withSystemScope(sql, (tx) => selectPortalPartner(tx, host))

const roleOf = (row: MembershipRow): StoreRole | null => {
  if (row.seller_id === null) return isMerchantRole(row.role_key) ? { side: 'merchant', role: row.role_key } : null
  if (!isSupplierRole(row.role_key) || row.access_level === null || !isSupplierTier(row.access_level)) return null
  return { side: 'supplier', role: row.role_key, tier: row.access_level }
}

const callerOf = (person: StorePerson, sessionHash: string, row: MembershipRow): StoreCaller | null => {
  const role = roleOf(row)
  if (!role) return null
  return {
    person,
    role,
    membershipId: row.membership_id,
    store: { id: row.store_id, name: row.store_name, status: row.store_status },
    seller: row.seller_id && row.seller_name ? { id: row.seller_id, name: row.seller_name } : null,
    plan: row.plan_id && row.plan_name ? { id: row.plan_id, name: row.plan_name } : null,
    context: {
      caller: { kind: 'person', userId: person.id, sessionId: sessionHash },
      partnerId: person.partnerId,
      storeId: row.store_id,
      sellerScope: row.seller_id ? { kind: 'seller', sellerId: row.seller_id } : { kind: 'all' },
      subscription: row.store_status,
    },
  }
}

// The entry stays small however many stores the person holds.
const heldInLabel = 3

// ACCESS.md §4: naming a store the session doesn't hold is an attempted tenant crossing, logged
// with the store asked for, the stores held and the person.
const recordCrossing = async (tx: ScopedSql, person: StorePerson, asked: string, activity: ActivityLog, facts: RequestFacts) => {
  const held = await selectHeldStoreIds(tx, person.id, person.partnerId, heldInLabel + 1)
  const listed = held.slice(0, heldInLabel).join(', ') + (held.length > heldInLabel ? ' and more' : '')
  await activity.record(tx, {
    category: 'security',
    action: 'store.crossing_refused',
    result: 'denied',
    actorKind: 'person',
    actorId: person.id,
    actorLabel: null,
    partnerId: person.partnerId,
    // The header is request input: kept short, and only ever compared, never trusted.
    target: { type: 'store', id: asked.slice(0, 64), label: held.length ? `holds ${listed}` : 'holds no store' },
    reason: 'store_not_held',
    api: 'store',
    visibility: 'staff',
    ...facts,
  })
}

/**
 * Who is asking on this partner's portal host, and in which store (ACCESS.md §3, §4). Resolved
 * in `system` scope because the caller isn't known yet; memberships are read on every request,
 * so a role, tier or removal applies on the next one.
 */
export const resolveStoreStanding = async (
  sql: postgres.Sql,
  request: Request,
  partnerId: string,
  now: Date,
  activity: ActivityLog,
  facts: RequestFacts,
): Promise<StoreStanding> => {
  const cookie = readCookie(request.headers.get('cookie'), storeCookieName)
  if (!cookie) return { kind: 'signed-out' }
  return withSystemScope(sql, async (tx) => {
    const session = await readUserSession(tx, cookie, partnerId, now)
    const row = session ? await selectStorePerson(tx, session.userId, partnerId) : null
    if (!row) return { kind: 'signed-out' }
    const person: StorePerson = { ...row, partnerId }
    const asked = request.headers.get(storeHeader)
    if (!asked) return { kind: 'no-store', person }
    const memberships = uuid.test(asked) ? await selectMemberships(tx, person.id, partnerId, asked) : []
    if (memberships.length === 0) {
      await recordCrossing(tx, person, asked, activity, facts)
      return { kind: 'crossing', person }
    }
    // A merchant-side member is never also a supplier there (membership_check_parents), so X-Supplier
    // only chooses between supplier seats; a held store with no seat chosen is asked, not logged.
    const supplier = request.headers.get(supplierHeader)
    const merchant = memberships.find((m) => m.seller_id === null)
    const chosen = merchant ?? (supplier ? memberships.find((m) => m.seller_id === supplier) : memberships.length === 1 ? memberships[0] : undefined)
    if (!chosen) return { kind: 'supplier-required', person }
    const caller = callerOf(person, await hashSessionId(cookie), chosen)
    if (!caller) {
      // A held store with a role nobody can read is a data fault, not a crossing: refused, logged technically.
      logEvent({ event: 'membership_unreadable', api: 'store', partnerId, storeId: chosen.store_id, code: chosen.role_key })
      return { kind: 'crossing', person }
    }
    return { kind: 'acting', person, caller }
  })
}
