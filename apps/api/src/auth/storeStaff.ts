import type { ScopedSql } from '#db/scoped/index'
import { endPortalSession } from '#db/scoped/staffPortal'
import { selectStoreStaffSession, type StoreStaffRow } from '#db/scoped/storeStaff'
import type { ActivityEntry, ActivityLog, RequestFacts } from './activity'
import { hashSessionId } from './session'
import type { StoreCaller } from './storeCaller'
import { storeRoleOf } from './storePermissions'

// Staff impersonating a store user on the store's portal host (ACCESS.md §8.1, §8.3): its own
// cookie beside any person's, the caller it resolves to, and how its entries are attributed.

// White label like the person's cookie; `__Host-` pins it to the portal host.
export const staffCookieName = '__Host-portal_staff'

// 30 minutes plus the one extension (ACCESS.md §8.1); the server ends it sooner.
const maxAgeSeconds = 60 * 60

export const setStaffCookie = (id: string): string => `${staffCookieName}=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`

export const clearStaffCookie = (): string => `${staffCookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`

export interface StaffSeat {
  sessionId: string
  staff: { id: string; name: string; email: string }
  expiresAt: Date
}

/** LOGGING.md §4: the user acted as stays the actor, with the staff member on whose behalf. */
const staffAttribution = (seat: StaffSeat): Pick<ActivityEntry, 'onBehalfOf' | 'access'> => ({
  onBehalfOf: { kind: 'staff', id: seat.staff.id, label: `${seat.staff.name} <${seat.staff.email}>` },
  access: { kind: 'impersonation', id: seat.sessionId },
})

/** An impersonation caller's writer: what a service files as the person carries the staff member and the session. */
export const staffAttributed = (log: ActivityLog, seat: StaffSeat): ActivityLog => {
  const attribute = (entry: ActivityEntry): ActivityEntry => (entry.actorKind === 'person' ? { ...entry, ...staffAttribution(seat) } : entry)
  return { record: (tx, entry) => log.record(tx, attribute(entry)), recordAll: (tx, entries) => log.recordAll(tx, entries.map(attribute)) }
}

export type StoreStaffEnd = 'portal' | 'target_gone' | 'partner_closed'

/** `impersonation.ended` from the store side: by the staff member, or by the job when its user, store or partner went. */
export const storeStaffEnded = (row: StoreStaffRow, facts: RequestFacts, why: StoreStaffEnd): ActivityEntry => ({
  category: 'support',
  action: 'impersonation.ended',
  result: 'success',
  ...(why === 'portal' ? { actorKind: 'staff' as const, actorId: row.staff_id, actorLabel: `${row.staff_name} <${row.staff_email}>` } : { actorKind: 'job' as const, actorId: null, actorLabel: null }),
  access: { kind: 'impersonation', id: row.id },
  partnerId: row.partner_id,
  storeId: row.store_id,
  target: { type: 'person', id: row.user_id, label: `${row.user_name} <${row.user_email}>` },
  reason: why === 'portal' ? null : why,
  api: 'store',
  visibility: 'store',
  ...facts,
})

// ACCESS.md §8.1 "Ends": as soon as the user, their seat, the store or the partner is gone.
const goneReason = (row: StoreStaffRow): StoreStaffEnd | null => {
  if (row.partner_state === 'closed') return 'partner_closed'
  if (row.store_status === 'closed') return 'target_gone'
  if (row.user_status !== 'active' || row.membership_status !== 'active' || (row.seller_id !== null && row.seller_status !== 'active')) return 'target_gone'
  return null
}

/** What reading a session needs to end and log one whose user, store or partner has gone. */
export interface StaffEnding {
  now: Date
  activity: ActivityLog
  facts: RequestFacts
}

/** The session a staff cookie on this partner's host belongs to, open or ended; null for an unknown cookie. */
export const readStoreStaffSession = async (tx: ScopedSql, partnerId: string, cookie: string, ending: StaffEnding): Promise<StoreStaffRow | null> => {
  const row = await selectStoreStaffSession(tx, partnerId, await hashSessionId(cookie))
  if (!row || row.ended_at !== null || row.expires_at <= ending.now) return row
  const gone = goneReason(row)
  if (!gone || !(await endPortalSession(tx, 'impersonation', row.id, gone, null, ending.now))) return row
  await ending.activity.record(tx, storeStaffEnded(row, ending.facts, gone))
  return { ...row, ended_at: ending.now, end_reason: gone }
}

/** Ends the cookie's open session from the portal, by the staff member, and logs it; false when none was open (or not `id`). */
export const endStoreStaffSession = async (tx: ScopedSql, partnerId: string, cookie: string, id: string | null, ending: StaffEnding): Promise<boolean> => {
  const s = await readStoreStaffSession(tx, partnerId, cookie, ending)
  if (!s || (id !== null && s.id !== id) || s.expires_at <= ending.now || !(await endPortalSession(tx, 'impersonation', s.id, 'portal', s.staff_id, ending.now))) return false
  await ending.activity.record(tx, storeStaffEnded(s, ending.facts, 'portal'))
  return true
}

/** The open impersonation this cookie holds as a store caller, with the target's own role in its one seat; null otherwise. */
export const resolveStaffCaller = async (tx: ScopedSql, partnerId: string, cookie: string, ending: StaffEnding): Promise<(StoreCaller & { staff: StaffSeat }) | null> => {
  const row = await readStoreStaffSession(tx, partnerId, cookie, ending)
  if (!row || row.ended_at !== null || row.expires_at <= ending.now || row.store_status === 'closed') return null
  const role = storeRoleOf(row)
  if (!role) return null
  return {
    person: { id: row.user_id, name: row.user_name, email: row.user_email, partnerId, sessionHash: '' },
    role,
    membershipId: row.membership_id,
    store: { id: row.store_id, name: row.store_name, status: row.store_status },
    seller: row.seller_id && row.seller_name ? { id: row.seller_id, name: row.seller_name } : null,
    plan: row.plan_id && row.plan_name ? { id: row.plan_id, name: row.plan_name } : null,
    staff: { sessionId: row.id, staff: { id: row.staff_id, name: row.staff_name, email: row.staff_email }, expiresAt: row.expires_at },
    context: {
      caller: { kind: 'impersonation', impersonationId: row.id, staffId: row.staff_id, userId: row.user_id },
      partnerId,
      storeId: row.store_id,
      sellerScope: row.seller_id ? { kind: 'seller', sellerId: row.seller_id } : { kind: 'all' },
      subscription: row.store_status,
    },
  }
}
