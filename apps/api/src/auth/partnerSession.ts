import type { ScopedSql } from '#db/scoped/index'
import { hashSessionId, newSessionId } from './session'

// ACCESS.md §4: the session model every pool but staff's uses. "Remember me" and its longer
// absolute bound arrive with sign-in (#156); until then every session takes the short one.
export const idleMs = 2 * 60 * 60 * 1000
export const absoluteMs = 12 * 60 * 60 * 1000

// `__Host-` pins it to the platform host alone, as the staff cookie is to the admin host.
export const partnerCookieName = '__Host-df_platform_session'

export const clearPartnerCookie = (): string => `${partnerCookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`

/** How long a password alone keeps the second-factor step open. */
export const pendingMs = 10 * 60 * 1000

export type SessionStage = 'second-factor' | 'enrol' | 'full'

export const setPartnerCookie = (id: string): string =>
  `${partnerCookieName}=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(absoluteMs / 1000)}`

export const createPartnerSession = async (tx: ScopedSql, partnerUserId: string, now: Date, stage: SessionStage = 'full'): Promise<string> => {
  const id = newSessionId()
  const expires = new Date(now.getTime() + (stage === 'full' ? absoluteMs : pendingMs))
  await tx`
    insert into partner_session (id_hash, partner_user_id, created_at, last_seen_at, absolute_expires_at, stage)
    values (${await hashSessionId(id)}, ${partnerUserId}, ${now}, ${now}, ${expires}, ${stage})
  `
  return id
}

/** The session's user if it is live and past every sign-in step, sliding the idle window; else null. */
export const readPartnerSession = async (tx: ScopedSql, id: string, now: Date): Promise<string | null> => {
  const rows = await tx<{ partner_user_id: string }[]>`
    update partner_session set last_seen_at = ${now}
    where id_hash = ${await hashSessionId(id)}
      and stage = 'full'
      and absolute_expires_at > ${now}
      and last_seen_at > ${new Date(now.getTime() - idleMs)}
    returning partner_user_id
  `
  return rows[0]?.partner_user_id ?? null
}

export interface PendingSession {
  partnerUserId: string
  pendingSecretEnc: string | null
}

/** A session waiting on the given step, or null. */
export const readPendingSession = async (tx: ScopedSql, id: string, stage: Exclude<SessionStage, 'full'>, now: Date): Promise<PendingSession | null> => {
  const rows = await tx<{ partner_user_id: string; pending_secret_enc: string | null }[]>`
    select partner_user_id, pending_secret_enc from partner_session
    where id_hash = ${await hashSessionId(id)} and stage = ${stage} and absolute_expires_at > ${now}
  `
  const row = rows[0]
  return row ? { partnerUserId: row.partner_user_id, pendingSecretEnc: row.pending_secret_enc } : null
}

export const setPendingSecret = async (tx: ScopedSql, id: string, sealed: string): Promise<void> => {
  await tx`update partner_session set pending_secret_enc = ${sealed} where id_hash = ${await hashSessionId(id)} and stage = 'enrol'`
}

/** The step is done: the session becomes a full one, with the full bounds from now. */
export const completePartnerSession = async (tx: ScopedSql, id: string, now: Date): Promise<void> => {
  await tx`
    update partner_session
    set stage = 'full', pending_secret_enc = null, last_seen_at = ${now}, absolute_expires_at = ${new Date(now.getTime() + absoluteMs)}
    where id_hash = ${await hashSessionId(id)}
  `
}

/** Deletes the session and returns whose it was, so sign-out can be attributed. */
export const endPartnerSession = async (tx: ScopedSql, id: string): Promise<string | null> => {
  const rows = await tx<{ partner_user_id: string }[]>`
    delete from partner_session where id_hash = ${await hashSessionId(id)} returning partner_user_id
  `
  return rows[0]?.partner_user_id ?? null
}
