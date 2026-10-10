import type { ScopedSql } from '#db/scoped/index'
import { endGoneSupportSession, selectSupportPortalSession, type SupportEnd, type SupportPortalRow } from '#db/scoped/storeSupport'
import type { ActivityEntry, ActivityLog, RequestFacts } from './activity'
import { hashSessionId } from './session'
import type { StoreCaller, StoreStanding } from './storeCaller'
import { storeRoleOf } from './storePermissions'

// A partner support session on the store's portal host (ACCESS.md §8; #331): its own cookie beside
// any person's, the caller it resolves to, and the attribution of everything done under it.

// White label, like the person's cookie; `__Host-` pins it to the portal host.
export const supportCookieName = '__Host-portal_support'

// A session lasts 30 minutes from its start (ACCESS.md §8); the server ends it sooner.
const maxAgeSeconds = 30 * 60

export const setSupportCookie = (id: string): string => `${supportCookieName}=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`

export interface SupportSeat {
  sessionId: string
  agent: { id: string; name: string }
  partnerName: string
  /** The store user the agent acts as: "Priya as Jenna" (ui/platform/FIRST-RELEASE.md §12). */
  actingAs: string
  access: 'read' | 'write'
  expiresAt: Date
  writeRequest: WriteRequest | null
}

export interface WriteRequest {
  note: string
  requestedAt: Date
  state: 'pending' | 'allowed' | 'denied'
}

/** The agent's request for writes and where it stands: waiting, allowed or denied. */
export const writeRequestOf = (s: Pick<SupportPortalRow, 'access' | 'write_requested_at' | 'write_request_note' | 'write_decided_at'>): WriteRequest | null =>
  s.write_requested_at === null
    ? null
    : { note: s.write_request_note ?? '', requestedAt: s.write_requested_at, state: s.write_decided_at === null ? 'pending' : s.access === 'write' ? 'allowed' : 'denied' }

export const seatOf = (row: SupportPortalRow): SupportSeat => ({
  sessionId: row.id,
  agent: { id: row.partner_user_id, name: row.agent_name },
  partnerName: row.partner_name,
  actingAs: row.user_name,
  access: row.access,
  expiresAt: row.expires_at,
  writeRequest: writeRequestOf(row),
})

/** The session as an entry's actor, with the agent behind it (LOGGING.md §4). */
export const supportActor = (seat: SupportSeat): Pick<ActivityEntry, 'actorKind' | 'actorId' | 'actorLabel' | 'onBehalfOf' | 'access'> => ({
  actorKind: 'support_session',
  actorId: seat.sessionId,
  actorLabel: `${seat.agent.name} (${seat.partnerName} support) as ${seat.actingAs}`,
  onBehalfOf: { kind: 'partner_user', id: seat.agent.id, label: seat.agent.name },
  access: { kind: 'support_session', id: seat.sessionId },
})

/** A support caller's writer: what a service files as the person acted as is the session's (ACCESS.md §8 "Logged"). */
export const supportAttributed = (log: ActivityLog, seat: SupportSeat): ActivityLog => {
  const attribute = (entry: ActivityEntry): ActivityEntry => (entry.actorKind === 'person' ? { ...entry, ...supportActor(seat) } : entry)
  return { record: (tx, entry) => log.record(tx, attribute(entry)), recordAll: (tx, entries) => log.recordAll(tx, entries.map(attribute)) }
}

/** The request's writer for this standing: a support caller's entries are the session's. */
export const storeActivityFor = (standing: StoreStanding, log: ActivityLog): ActivityLog =>
  standing.kind === 'acting' && standing.caller.support ? supportAttributed(log, standing.caller.support) : log

/** Why an open session can't be used any more (ACCESS.md §9 check 1), or null while it can. */
const goneReason = (row: SupportPortalRow): SupportEnd | null => {
  if (row.store_status === 'cancelled' || row.store_status === 'closed') return 'store_closed'
  // A start raced the switch going Off (0160 ends only what was open then): it ends on first use.
  if (!row.support_access_allowed) return 'support_off'
  if (row.user_status !== 'active' || row.membership_status !== 'active' || (row.seller_id !== null && row.seller_status !== 'active')) return 'target_gone'
  return null
}

/** The partner and store hear how the store side ended a session; the job ended it, the code says why. */
export const supportEndedEntry = (row: Pick<SupportPortalRow, 'id' | 'partner_id' | 'store_id' | 'store_name' | 'user_id' | 'user_name'>, reason: SupportEnd, facts: RequestFacts): ActivityEntry => ({
  category: 'support',
  action: 'support_session.ended',
  result: 'success',
  actorKind: 'job',
  actorId: null,
  actorLabel: null,
  access: { kind: 'support_session', id: row.id },
  partnerId: row.partner_id,
  storeId: row.store_id,
  target: { type: 'user', id: row.user_id, label: `${row.user_name} (${row.store_name})` },
  reason,
  api: 'store',
  visibility: 'partner',
  ...facts,
})

/** The open session this cookie holds as a store caller, ending one its store can no longer host; null otherwise. */
export const resolveSupportCaller = async (tx: ScopedSql, partnerId: string, cookie: string, now: Date, activity: ActivityLog, facts: RequestFacts): Promise<StoreCaller | null> => {
  const row = await selectSupportPortalSession(tx, partnerId, await hashSessionId(cookie))
  if (!row || row.ended_at !== null || row.expires_at <= now) return null
  const gone = goneReason(row)
  if (gone) {
    if (await endGoneSupportSession(tx, row.id, gone, now)) await activity.record(tx, supportEndedEntry(row, gone, facts))
    return null
  }
  const role = storeRoleOf(row)
  if (!role || row.store_status === 'closed') return null
  const support = seatOf(row)
  return {
    person: { id: row.user_id, name: row.user_name, email: row.user_email, partnerId, sessionHash: '' },
    role,
    membershipId: row.membership_id,
    store: { id: row.store_id, name: row.store_name, status: row.store_status },
    seller: row.seller_id && row.seller_name ? { id: row.seller_id, name: row.seller_name } : null,
    plan: row.plan_id && row.plan_name ? { id: row.plan_id, name: row.plan_name } : null,
    support,
    context: {
      caller: { kind: 'support', supportSessionId: row.id, partnerUserId: row.partner_user_id, access: row.access },
      partnerId,
      storeId: row.store_id,
      sellerScope: row.seller_id ? { kind: 'seller', sellerId: row.seller_id } : { kind: 'all' },
      subscription: row.store_status,
    },
  }
}
