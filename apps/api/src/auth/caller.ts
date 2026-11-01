import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { selectStaffStanding } from '#db/scoped/staffMembers'
import { readCookie } from './cookie'
import { hashSessionId, isReauthFresh, staffSessionWindow, touchStaffSession } from './session'
import type { StaffMember, StaffRole } from './staff'

export interface StaffCaller {
  staff: StaffMember
  /** CONSOLE-DESIGN A2: whether the credential was proved recently enough for a dangerous action. */
  reauthFresh: boolean
}

/**
 * Who is asking, from the session cookie. Resolved in `system` scope because the caller is
 * not known yet, which is what `platform` scope would require.
 */
export const resolveStaff = async (sql: postgres.Sql, request: Request, now: Date): Promise<StaffCaller | null> => {
  const id = readCookie(request.headers.get('cookie'))
  if (!id) return null
  return withSystemScope(sql, async (tx) => {
    // The session and its staff member in one statement (#1124).
    const idHash = await hashSessionId(id)
    const row = await selectStaffStanding<StaffRole>(tx, staffSessionWindow(idHash, now))
    if (!row) return null
    await touchStaffSession(tx, idHash, row.last_seen_at, now)
    return { staff: { id: row.id, email: row.email, name: row.name, role: row.role_key }, reauthFresh: isReauthFresh({ staffUserId: row.id, reauthAt: row.reauth_at }, now) }
  })
}
