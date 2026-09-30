import type { ScopedSql } from '#db/scoped/index'

// ACCESS.md §4, decided 2026-10-01: shorter than every other pool, because a staff session is
// the one that can suspend a store and impersonate a merchant.
export const idleMs = 60 * 60 * 1000
export const absoluteMs = 8 * 60 * 60 * 1000

export const cookieName = '__Host-df_admin_session'

export interface StaffSession {
  staffUserId: string
  reauthAt: Date | null
}

const encoder = new TextEncoder()

/** Stored hashed, so a leaked database row cannot be replayed as a session. */
export const hashSessionId = async (id: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(id))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const newSessionId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const createSession = async (tx: ScopedSql, staffUserId: string, now: Date): Promise<string> => {
  const id = newSessionId()
  await tx`
    insert into staff_session (id_hash, staff_user_id, created_at, last_seen_at, expires_at, reauth_at)
    values (${await hashSessionId(id)}, ${staffUserId}, ${now}, ${now},
            ${new Date(now.getTime() + absoluteMs)}, ${now})
  `
  return id
}

/**
 * The session if it is live, else null. Idle is measured from `last_seen_at` and the absolute
 * bound from `expires_at`; touching `last_seen_at` is what makes the idle window sliding.
 */
export const readSession = async (tx: ScopedSql, id: string, now: Date): Promise<StaffSession | null> => {
  const idHash = await hashSessionId(id)
  const rows = await tx<{ staff_user_id: string; reauth_at: Date | null }[]>`
    update staff_session set last_seen_at = ${now}
    where id_hash = ${idHash}
      and expires_at > ${now}
      and last_seen_at > ${new Date(now.getTime() - idleMs)}
    returning staff_user_id, reauth_at
  `
  const row = rows[0]
  return row ? { staffUserId: row.staff_user_id, reauthAt: row.reauth_at } : null
}

/** Deletes the session and returns whose it was, so sign-out can be attributed. */
export const endSession = async (tx: ScopedSql, id: string): Promise<string | null> => {
  const rows = await tx<{ staff_user_id: string }[]>`
    delete from staff_session where id_hash = ${await hashSessionId(id)} returning staff_user_id
  `
  return rows[0]?.staff_user_id ?? null
}
