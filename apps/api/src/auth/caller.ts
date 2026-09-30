import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { readCookie } from './cookie'
import { readSession } from './session'
import { staffById, type StaffMember } from './staff'

/**
 * Who is asking, from the session cookie. Resolved in `system` scope because the caller is
 * not known yet, which is what `platform` scope would require.
 */
export const resolveStaff = async (
  sql: postgres.Sql,
  request: Request,
  now: Date,
): Promise<StaffMember | null> => {
  const id = readCookie(request.headers.get('cookie'))
  if (!id) return null
  return withSystemScope(sql, async (tx) => {
    const session = await readSession(tx, id, now)
    return session ? staffById(tx, session.staffUserId) : null
  })
}
