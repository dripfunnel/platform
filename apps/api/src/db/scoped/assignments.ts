import type { ScopedSql } from './index'

// Which Partner managers a partner is assigned to (ACCESS.md §5.4, decided on #60): the pairs
// `auth/assignment.ts` checks, read and written only here.

export interface PartnerManager {
  id: string
  name: string
  email: string
  since: Date
}

export const selectManagersFor = (tx: ScopedSql, partnerIds: readonly string[]): Promise<(PartnerManager & { partner_id: string })[]> =>
  tx<(PartnerManager & { partner_id: string })[]>`
    select a.partner_id, s.id, s.name, s.email, a.created_at as since
    from staff_partner_assignment a join staff_user s on s.id = a.staff_user_id
    where a.partner_id = any(${[...partnerIds]}) and a.removed_at is null
    order by a.created_at
  `

export interface StaffForAssignment {
  id: string
  name: string
  email: string
  role_key: string
  status: string
}

export const selectStaffForAssignment = async (tx: ScopedSql, staffId: string): Promise<StaffForAssignment | null> =>
  (await tx<StaffForAssignment[]>`select id, name, email, role_key, status from staff_user where id = ${staffId}`)[0] ?? null

export const hasLiveAssignment = async (tx: ScopedSql, partnerId: string, staffId: string): Promise<boolean> =>
  (await tx`select 1 from staff_partner_assignment where staff_user_id = ${staffId} and partner_id = ${partnerId} and removed_at is null`).length > 0

export const insertAssignment = async (tx: ScopedSql, partnerId: string, staffId: string, by: string, now: Date): Promise<void> => {
  await tx`
    insert into staff_partner_assignment (staff_user_id, partner_id, assigned_by_staff_id, created_at)
    values (${staffId}, ${partnerId}, ${by}, ${now})
  `
}

/** True when a live assignment was closed. Never a delete: the history stays with the row. */
export const removeAssignment = async (tx: ScopedSql, partnerId: string, staffId: string, by: string, now: Date): Promise<boolean> =>
  (
    await tx`
      update staff_partner_assignment set removed_at = ${now}, removed_by_staff_id = ${by}
      where staff_user_id = ${staffId} and partner_id = ${partnerId} and removed_at is null
      returning id
    `
  ).length > 0
