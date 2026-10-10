import type postgres from 'postgres'
import { logEvent } from '#core/log'
import type { Subscription, TenantContext } from '#core/tenancy'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { crossingsLoggedSince, selectHeldStoreIds, selectMemberships, selectPortalPartner, selectStorePerson, type MembershipRow } from '#db/scoped/storeCaller'
import type { ActivityEntry, ActivityLog, RequestFacts } from './activity'
import { readCookie } from './cookie'
import { sendsStoreCookie, storeSessionId } from './storeCredential'
import { hashSessionId } from './session'
import { readUserSession } from './storeSession'
import { storeRoleOf, type StoreRole } from './storePermissions'
import { resolveSupportCaller, supportActor, supportCookieName, type SupportSeat } from './storeSupport'
import { isUuid } from '#core/ids'
import { apiKeyOf } from './apiKeys'
import { planApiLimits, resolveApiKey, type MachineCaller } from './machineCaller'

// The acting store and, for a person working for more than one supplier in it, the acting
// supplier (ACCESS.md §4).
export const storeHeader = 'x-store'
export const supplierHeader = 'x-supplier'

export interface StorePerson {
  id: string
  name: string
  email: string
  partnerId: string
  /** The session's hash, only ever compared: "this browser" in My profile, the one sign-out-elsewhere keeps. */
  sessionHash: string
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
  /** Set for a partner support session acting as this seat's user (ACCESS.md §8). */
  support?: SupportSeat
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
  /** An API key, in its own store with its own scopes (auth/machineCaller.ts). */
  | { kind: 'machine'; caller: MachineCaller }
  /** A key over its plan's calls this minute or month: answered 429 before the API runs. */
  | { kind: 'limited'; retryAfterSeconds: number }

/** The signed-in person behind a standing; null when nobody is, or a key is asking. */
export const standingPerson = (standing: StoreStanding): StorePerson | null => ('person' in standing ? standing.person : null)

/** The partner whose portal host this is; null answers 404 (docs/ARCHITECTURE.md §2). */
export const resolvePortalPartner = async (sql: postgres.Sql, host: string): Promise<string | null> =>
  withSystemScope(sql, (tx) => selectPortalPartner(tx, host))

const callerOf = (person: StorePerson, sessionHash: string, row: MembershipRow): StoreCaller | null => {
  const role = storeRoleOf(row)
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

// The entry stays small however many stores the person holds, and a looping client writes a few a minute at most.
const heldInLabel = 3
const crossingsPerMinute = 5

// ACCESS.md §4: naming a store the session doesn't hold is an attempted tenant crossing, logged
// with the store asked for, the stores held and the person.
export const recordCrossing = async (tx: ScopedSql, person: StorePerson, asked: string, activity: ActivityLog, facts: RequestFacts, now: Date) => {
  if ((await crossingsLoggedSince(tx, person.id, new Date(now.getTime() - 60_000), crossingsPerMinute)) >= crossingsPerMinute) return
  const target = asked.slice(0, 64)
  const held = await selectHeldStoreIds(tx, person.id, person.partnerId, heldInLabel + 1)
  const listed = held.slice(0, heldInLabel).join(', ') + (held.length > heldInLabel ? ' and more' : '')
  await activity.record(tx, {
    occurredAt: now,
    category: 'security',
    action: 'store.crossing_refused',
    result: 'denied',
    actorKind: 'person',
    actorId: person.id,
    actorLabel: null,
    partnerId: person.partnerId,
    // The header is request input: kept short, and only ever compared, never trusted.
    target: { type: 'store', id: target, label: held.length ? `holds ${listed}` : 'holds no store' },
    reason: 'store_not_held',
    api: 'store',
    visibility: 'staff',
    ...facts,
  })
}

// A support session is bound to one store: naming another is a crossing too (ACCESS.md §4, §8).
const supportCrossing = (seat: SupportSeat, partnerId: string, asked: string, facts: RequestFacts, now: Date): ActivityEntry => ({
  occurredAt: now,
  category: 'security',
  action: 'store.crossing_refused',
  result: 'denied',
  ...supportActor(seat),
  partnerId,
  target: { type: 'store', id: asked.slice(0, 64), label: 'outside the support session' },
  reason: 'store_not_held',
  api: 'store',
  visibility: 'staff',
  ...facts,
})

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
  const key = apiKeyOf(request)
  if (key !== null) {
    // A key never rides with a session: one sent beside the portal's cookie is refused like a bad key.
    if (sendsStoreCookie(request)) return { kind: 'signed-out' }
    const resolved = await resolveApiKey(sql, key, partnerId, now, planApiLimits)
    return resolved === null ? { kind: 'signed-out' } : 'retryAfterSeconds' in resolved ? { kind: 'limited', retryAfterSeconds: resolved.retryAfterSeconds } : { kind: 'machine', caller: resolved }
  }
  const sessionId = storeSessionId(request)
  const supportCookie = readCookie(request.headers.get('cookie'), supportCookieName)
  if (!sessionId && !supportCookie) return { kind: 'signed-out' }
  return withSystemScope(sql, async (tx) => {
    // A support session on this host first, as a staff session is on the partner console's (#243).
    const support = supportCookie ? await resolveSupportCaller(tx, partnerId, supportCookie, now, activity, facts) : null
    if (support?.support) {
      const asked = request.headers.get(storeHeader)
      if (!asked || asked === support.store.id) return { kind: 'acting', person: support.person, caller: support }
      await activity.record(tx, supportCrossing(support.support, partnerId, asked, facts, now))
      return { kind: 'crossing', person: support.person }
    }
    if (!sessionId) return { kind: 'signed-out' }
    const session = await readUserSession(tx, sessionId, partnerId, now)
    const row = session ? await selectStorePerson(tx, session.userId, partnerId) : null
    if (!row) return { kind: 'signed-out' }
    const sessionHash = await hashSessionId(sessionId)
    const person: StorePerson = { ...row, partnerId, sessionHash }
    const asked = request.headers.get(storeHeader)
    if (!asked) return { kind: 'no-store', person }
    const memberships = isUuid(asked) ? await selectMemberships(tx, person.id, partnerId, asked) : []
    if (memberships.length === 0) {
      await recordCrossing(tx, person, asked, activity, facts, now)
      return { kind: 'crossing', person }
    }
    // A merchant-side member is never also a supplier there (membership_check_parents), so X-Supplier
    // only chooses between supplier seats; a held store with no seat chosen is asked, not logged.
    const supplier = request.headers.get(supplierHeader)
    const merchant = memberships.find((m) => m.seller_id === null)
    const chosen = merchant ?? (supplier ? memberships.find((m) => m.seller_id === supplier) : memberships.length === 1 ? memberships[0] : undefined)
    if (!chosen) return { kind: 'supplier-required', person }
    const caller = callerOf(person, sessionHash, chosen)
    if (!caller) {
      // A held store with a role nobody can read is a data fault, not a crossing: refused, logged technically.
      logEvent({ event: 'membership_unreadable', api: 'store', partnerId, storeId: chosen.store_id, code: chosen.role_key })
      return { kind: 'crossing', person }
    }
    return { kind: 'acting', person, caller }
  })
}
