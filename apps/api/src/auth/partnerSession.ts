import type { ScopedSql } from '#db/scoped/index'
import { hashSessionId, newSessionId } from './session'

// ACCESS.md §4: the session model every pool but staff's uses. "Remember me" and its longer
// absolute bound arrive with sign-in (#156); until then every session takes the short one.
export const idleMs = 2 * 60 * 60 * 1000
export const absoluteMs = 12 * 60 * 60 * 1000

// `__Host-` pins it to the platform host alone, as the staff cookie is to the admin host.
export const partnerCookieName = '__Host-df_platform_session'

export const clearPartnerCookie = (): string => `${partnerCookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`

export const createPartnerSession = async (tx: ScopedSql, partnerUserId: string, now: Date): Promise<string> => {
  const id = newSessionId()
  await tx`
    insert into partner_session (id_hash, partner_user_id, created_at, last_seen_at, absolute_expires_at)
    values (${await hashSessionId(id)}, ${partnerUserId}, ${now}, ${now}, ${new Date(now.getTime() + absoluteMs)})
  `
  return id
}

/** The session's user if it is live, sliding the idle window; else null. */
export const readPartnerSession = async (tx: ScopedSql, id: string, now: Date): Promise<string | null> => {
  const rows = await tx<{ partner_user_id: string }[]>`
    update partner_session set last_seen_at = ${now}
    where id_hash = ${await hashSessionId(id)}
      and absolute_expires_at > ${now}
      and last_seen_at > ${new Date(now.getTime() - idleMs)}
    returning partner_user_id
  `
  return rows[0]?.partner_user_id ?? null
}

/** Deletes the session and returns whose it was, so sign-out can be attributed. */
export const endPartnerSession = async (tx: ScopedSql, id: string): Promise<string | null> => {
  const rows = await tx<{ partner_user_id: string }[]>`
    delete from partner_session where id_hash = ${await hashSessionId(id)} returning partner_user_id
  `
  return rows[0]?.partner_user_id ?? null
}
