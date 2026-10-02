import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { readCookie } from './cookie'
import { isReauthFresh, readSession } from './session'
import { staffById, type StaffMember } from './staff'

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
    const session = await readSession(tx, id, now)
    if (!session) return null
    const staff = await staffById(tx, session.staffUserId)
    return staff ? { staff, reauthFresh: isReauthFresh(session, now) } : null
  })
}
