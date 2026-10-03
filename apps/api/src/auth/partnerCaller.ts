import type postgres from 'postgres'
import type { PartnerState } from '#db/schema/saas'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { selectPartnerCaller } from '#db/scoped/partnerUsers'
import { readCookie } from './cookie'
import { isPartnerRole, type PartnerRole } from './partnerPermissions'
import { partnerCookieName, readPartnerSession } from './partnerSession'

/** The console's own reading of the partner's state: a draft that was sent back says so (FIRST-RELEASE §2.3). */
export type PartnerConsoleState = Exclude<PartnerState, 'closed'> | 'sentback'

export interface PartnerCaller {
  user: { id: string; name: string; email: string; role: PartnerRole }
  partner: { id: string; name: string; product: string; host: string | null; state: PartnerConsoleState }
}

// A suspended user and a closed partner read as no session at all, as an unknown one does.
const callerFor = async (tx: ScopedSql, partnerUserId: string): Promise<PartnerCaller | null> => {
  const row = await selectPartnerCaller(tx, partnerUserId)
  if (!row || row.state === 'closed' || !isPartnerRole(row.role_key)) return null
  return {
    user: { id: row.id, name: row.name, email: row.email, role: row.role_key },
    partner: {
      id: row.partner_id,
      name: row.partner_name,
      product: row.product_name ?? row.partner_name,
      host: row.portal_host,
      state: row.state === 'draft' && row.sent_back_reason !== null ? 'sentback' : row.state,
    },
  }
}

/**
 * Who is asking, from the session cookie. Resolved in `system` scope because the caller is
 * not known yet, which is what `partner` scope would require.
 */
export const resolvePartner = async (sql: postgres.Sql, request: Request, now: Date): Promise<PartnerCaller | null> => {
  const id = readCookie(request.headers.get('cookie'), partnerCookieName)
  if (!id) return null
  return withSystemScope(sql, async (tx) => {
    const userId = await readPartnerSession(tx, id, now)
    return userId ? callerFor(tx, userId) : null
  })
}

