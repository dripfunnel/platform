import type { ScopedSql } from '#db/scoped/index'
import { hashSessionId, newSessionId } from './session'

// ACCESS.md §4: idle 2 h and absolute 12 h; "Remember me" 7 days idle and 30 days absolute (#337).
export const idleMs = 2 * 60 * 60 * 1000
export const absoluteMs = 12 * 60 * 60 * 1000
export const rememberIdleMs = 7 * 24 * 60 * 60 * 1000
export const rememberAbsoluteMs = 30 * 24 * 60 * 60 * 1000

// White label: the name says nothing about DripFunnel, and `__Host-` pins it to the portal host.
export const storeCookieName = '__Host-portal_session'

export interface UserSession {
  userId: string
  partnerId: string
}

export const createUserSession = async (
  tx: ScopedSql,
  user: { id: string; partnerId: string },
  now: Date,
  options: { remember?: boolean; deviceLabel?: string | null; userAgent?: string | null } = {},
): Promise<string> => {
  const id = newSessionId()
  const remember = options.remember ?? false
  await tx`
    insert into user_session (id_hash, user_id, partner_id, created_at, last_seen_at, absolute_expires_at, remember, device_label, user_agent)
    values (${await hashSessionId(id)}, ${user.id}, ${user.partnerId}, ${now}, ${now},
            ${new Date(now.getTime() + (remember ? rememberAbsoluteMs : absoluteMs))}, ${remember},
            ${options.deviceLabel ?? null}, ${options.userAgent ?? null})
  `
  return id
}

/** The live session on this partner's host, sliding its idle window; null when unknown, ended or another partner's. */
export const readUserSession = async (tx: ScopedSql, id: string, partnerId: string, now: Date): Promise<UserSession | null> => {
  const rows = await tx<{ user_id: string; partner_id: string }[]>`
    update user_session set last_seen_at = ${now}
    where id_hash = ${await hashSessionId(id)}
      and partner_id = ${partnerId}
      and absolute_expires_at > ${now}
      and last_seen_at > ${now}::timestamptz - case when remember then ${`${rememberIdleMs} milliseconds`}::interval else ${`${idleMs} milliseconds`}::interval end
    returning user_id, partner_id
  `
  const row = rows[0]
  return row ? { userId: row.user_id, partnerId: row.partner_id } : null
}
