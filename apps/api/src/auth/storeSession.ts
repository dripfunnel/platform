import type { ScopedSql } from '#db/scoped/index'
import { liveUserSession, type UserSessionWindow } from '#db/scoped/storeCaller'
import { hashSessionId, lastSeenIsStale, lastSeenWriteMs, newSessionId } from './session'

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

/** How long a password alone keeps the next step open (ACCESS.md §4). */
export const pendingMs = 10 * 60 * 1000

export type UserSessionStage = 'second-factor' | 'enrol' | 'full'

const absoluteFor = (remember: boolean) => (remember ? rememberAbsoluteMs : absoluteMs)

// A session still waiting for its second factor lives in the browser only as long as on the server.
export const setStoreCookie = (id: string, remember: boolean, stage: UserSessionStage = 'full'): string =>
  `${storeCookieName}=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.floor((stage === 'full' ? absoluteFor(remember) : pendingMs) / 1000)}`

export const clearStoreCookie = (): string => `${storeCookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`

export const createUserSession = async (
  tx: ScopedSql,
  user: { id: string; partnerId: string },
  now: Date,
  options: { remember?: boolean; deviceLabel?: string | null; userAgent?: string | null; stage?: UserSessionStage } = {},
): Promise<string> => {
  const id = newSessionId()
  const remember = options.remember ?? false
  const stage = options.stage ?? 'full'
  await tx`
    insert into user_session (id_hash, user_id, partner_id, created_at, last_seen_at, absolute_expires_at, remember, device_label, user_agent, stage)
    values (${await hashSessionId(id)}, ${user.id}, ${user.partnerId}, ${now}, ${now},
            ${new Date(now.getTime() + (stage === 'full' ? absoluteFor(remember) : pendingMs))}, ${remember},
            ${options.deviceLabel ?? null}, ${options.userAgent ?? null}, ${stage})
  `
  return id
}

export interface PendingUserSession {
  userId: string
  partnerId: string
  remember: boolean
  pendingSecretEnc: string | null
  pendingPhone: string | null
}

/** A session waiting on this step, on this partner's host; null otherwise. */
export const readPendingUserSession = async (tx: ScopedSql, id: string, partnerId: string, stage: Exclude<UserSessionStage, 'full'>, now: Date): Promise<PendingUserSession | null> => {
  const rows = await tx<{ user_id: string; partner_id: string; remember: boolean; pending_secret_enc: string | null; pending_phone: string | null }[]>`
    select user_id, partner_id, remember, pending_secret_enc, pending_phone from user_session
    where id_hash = ${await hashSessionId(id)} and partner_id = ${partnerId} and stage = ${stage} and absolute_expires_at > ${now}
  `
  const row = rows[0]
  return row ? { userId: row.user_id, partnerId: row.partner_id, remember: row.remember, pendingSecretEnc: row.pending_secret_enc, pendingPhone: row.pending_phone } : null
}

export const setPendingEnrolment = async (tx: ScopedSql, id: string, pending: { secretEnc?: string | null; phone?: string | null }): Promise<void> => {
  await tx`
    update user_session set pending_secret_enc = ${pending.secretEnc ?? null}, pending_phone = ${pending.phone ?? null}
    where id_hash = ${await hashSessionId(id)} and stage = 'enrol'
  `
}

/** The step is done: a full session, with the full bounds from now. */
export const completeUserSession = async (tx: ScopedSql, id: string, remember: boolean, now: Date): Promise<void> => {
  await tx`
    update user_session set stage = 'full', pending_secret_enc = null, pending_phone = null, last_seen_at = ${now},
      absolute_expires_at = ${new Date(now.getTime() + absoluteFor(remember))}
    where id_hash = ${await hashSessionId(id)}
  `
}

/** Deletes the session, and returns whose it was so sign-out can be attributed. */
export const endUserSession = async (tx: ScopedSql, id: string): Promise<UserSession | null> => {
  const rows = await tx<{ user_id: string; partner_id: string }[]>`delete from user_session where id_hash = ${await hashSessionId(id)} returning user_id, partner_id`
  const row = rows[0]
  return row ? { userId: row.user_id, partnerId: row.partner_id } : null
}

/** The live-session condition's inputs for this partner's portal (ACCESS.md §4). */
export const userSessionWindow = (idHash: string, partnerId: string, now: Date): UserSessionWindow => ({ idHash, partnerId, now, idleMs, rememberIdleMs })

/** Moves a live session's last-seen on, only when it is stale, so a busy tab writes a few times an hour at most. */
export const touchUserSession = async (tx: ScopedSql, idHash: string, lastSeenAt: Date, now: Date): Promise<void> => {
  if (!lastSeenIsStale(lastSeenAt, now)) return
  await tx`
    update user_session set last_seen_at = ${now}
    where id_hash = ${idHash} and last_seen_at <= ${new Date(now.getTime() - lastSeenWriteMs)}
  `
}

/** The live session on this partner's host, sliding its idle window; null when unknown, ended or another partner's. */
export const readUserSession = async (tx: ScopedSql, id: string, partnerId: string, now: Date): Promise<UserSession | null> => {
  const idHash = await hashSessionId(id)
  const rows = await tx<{ user_id: string; partner_id: string; last_seen_at: Date }[]>`
    select user_id, partner_id, last_seen_at from user_session where ${liveUserSession(tx, userSessionWindow(idHash, partnerId, now))}
  `
  const row = rows[0]
  if (!row) return null
  await touchUserSession(tx, idHash, row.last_seen_at, now)
  return { userId: row.user_id, partnerId: row.partner_id }
}

/** A person who has just become an Owner without 2-factor is held at enrolment, as at sign-in (ACCESS.md §4). */
export const holdForEnrolment = async (tx: ScopedSql, id: string, now: Date): Promise<void> => {
  await tx`
    update user_session set stage = 'enrol', absolute_expires_at = ${new Date(now.getTime() + pendingMs)}
    where id_hash = ${await hashSessionId(id)} and stage = 'full'
  `
}
