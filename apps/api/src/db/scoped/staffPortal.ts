import type { PartnerState } from '#db/schema/saas'
import type { ScopedSql } from './index'

// The partner console's half of staff sessions (ACCESS.md §8.3, #243), in system scope: the
// caller isn't known until the cookie resolves, and these are platform tables.

export type PortalSessionKind = 'impersonation' | 'setup'

/**
 * Spends a handoff once, before its link expires and while its session is open, and keeps the
 * new cookie's hash on the session. Only a partner user's impersonation opens here; a store
 * user's opens on the store's portal.
 */
export const spendPortalHandoff = async (tx: ScopedSql, handoffHash: string, portalHash: string, now: Date): Promise<{ kind: PortalSessionKind; id: string } | null> => {
  const impersonation = await tx<{ id: string }[]>`
    update impersonation set handoff_used_at = ${now}, handoff_hash = null, portal_session_hash = ${portalHash}
    where handoff_hash = ${handoffHash} and target_kind = 'partner_user' and handoff_used_at is null
      and handoff_expires_at > ${now} and ended_at is null and expires_at > ${now}
    returning id
  `
  if (impersonation[0]) return { kind: 'impersonation', id: impersonation[0].id }
  const setup = await tx<{ id: string }[]>`
    update partner_setup_session set handoff_used_at = ${now}, handoff_hash = null, portal_session_hash = ${portalHash}
    where handoff_hash = ${handoffHash} and handoff_used_at is null
      and handoff_expires_at > ${now} and ended_at is null and expires_at > ${now}
    returning id
  `
  return setup[0] ? { kind: 'setup', id: setup[0].id } : null
}

export interface PortalSessionRow {
  kind: PortalSessionKind
  id: string
  staff_id: string
  staff_name: string
  staff_email: string
  partner_id: string
  partner_name: string
  partner_state: PartnerState
  /** The partner user acted as: impersonation only. */
  target_id: string | null
  target_name: string | null
  target_role: string | null
  target_status: string | null
  expires_at: Date
  ended_at: Date | null
  end_reason: string | null
}

const portalSessions = (tx: ScopedSql) => tx`
  select * from (
    select 'impersonation' as kind, i.id, st.id as staff_id, st.name as staff_name, st.email as staff_email, p.id as partner_id,
      p.name as partner_name, p.state as partner_state, pu.id as target_id, pu.name as target_name, pu.role_key as target_role, pu.status as target_status, i.expires_at, i.ended_at,
      i.end_reason, i.portal_session_hash, i.started_at
    from impersonation i join staff_user st on st.id = i.staff_user_id join partner p on p.id = i.partner_id
    left join partner_user pu on pu.id = i.target_id
    where i.target_kind = 'partner_user'
    union all
    select 'setup', ss.id, st.id, st.name, st.email, p.id, p.name, p.state, null, null, null, null, ss.expires_at, ss.ended_at,
      coalesce(ss.end_reason, case when ss.ended_at is null then null when ss.ended_by_staff_id is null then 'expired' else 'staff' end),
      ss.portal_session_hash, ss.started_at
    from partner_setup_session ss join staff_user st on st.id = ss.staff_user_id join partner p on p.id = ss.partner_id
  ) x
`

/** The session a portal cookie belongs to, open or not, so the console can say how it ended. */
export const selectPortalSession = async (tx: ScopedSql, portalHash: string): Promise<PortalSessionRow | null> =>
  (await tx<PortalSessionRow[]>`${portalSessions(tx)} where x.portal_session_hash = ${portalHash}`)[0] ?? null

/** The open session on a partner its own users must hear of first: an impersonation of one of them, else a setup session. */
export const selectOpenPortalSessionOn = async (tx: ScopedSql, partnerId: string, now: Date): Promise<PortalSessionRow | null> =>
  (
    await tx<PortalSessionRow[]>`
      ${portalSessions(tx)} where x.partner_id = ${partnerId} and x.ended_at is null and x.expires_at > ${now}
      order by x.kind = 'impersonation' desc, x.started_at desc limit 1
    `
  )[0] ?? null

export type PortalEnd = 'portal' | 'target_gone' | 'partner_closed'

/** Ends an open session from the console's side; false when it had already ended. */
export const endPortalSession = async (tx: ScopedSql, kind: PortalSessionKind, id: string, reason: PortalEnd, by: string | null, now: Date): Promise<boolean> =>
  kind === 'impersonation'
    ? (await tx`update impersonation set ended_at = ${now}, ended_by = ${by}, end_reason = ${reason}, handoff_hash = null where id = ${id} and ended_at is null`).count > 0
    : (await tx`update partner_setup_session set ended_at = ${now}, ended_by_staff_id = ${by}, end_reason = ${reason}, handoff_hash = null where id = ${id} and ended_at is null`).count > 0
