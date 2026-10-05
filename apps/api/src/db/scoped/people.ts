import type { PageWindow } from '#core/paging'
import type { ScopedSql } from './index'

// Settings › People (ACCESS.md §6, SetTeam): the merchant side of the acting store, read and changed
// in that store's scope, so RLS holds every statement to it (migrations/0007's store policies).

export type MerchantRole = 'owner' | 'manager' | 'staff'

export interface PersonRow {
  kind: 'member' | 'invitation'
  id: string
  user_id: string | null
  name: string | null
  email: string
  role_key: MerchantRole
  sort_at: Date
  expires_at: Date | null
}

const peopleFilter = (tx: ScopedSql, filter: 'all' | 'staff' | 'waiting') =>
  filter === 'waiting' ? tx`kind = 'invitation'` : filter === 'staff' ? tx`kind = 'member'` : tx`true`

/** Active merchant-side members and open invitations, newest first; no supplier user (SAPI 5's). */
export const selectPeople = (tx: ScopedSql, storeId: string, filter: 'all' | 'staff' | 'waiting', window: PageWindow): Promise<PersonRow[]> =>
  tx<PersonRow[]>`
    select * from (
      select 'member' as kind, m.id, m.user_id, u.name, u.email, m.role_key, m.created_at as sort_at, null::timestamptz as expires_at
      from membership m join "user" u on u.id = m.user_id
      where m.store_id = ${storeId} and m.seller_id is null and m.status = 'active'
      union all
      select 'invitation', i.id, null, null, i.email, i.role_key, i.created_at, i.expires_at
      from invitation i
      where i.store_id = ${storeId} and i.seller_id is null and i.accepted_at is null and i.revoked_at is null
    ) people
    where ${peopleFilter(tx, filter)}
      and ${window.after ? tx`(sort_at, id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(sort_at, id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by sort_at ${window.before && !window.after ? tx`asc` : tx`desc`}, id ${window.before && !window.after ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `

/** The chips' counts, from their own query (FIRST-RELEASE §19): open invitations include expired ones, which offer a resend. */
export const countPeople = async (tx: ScopedSql, storeId: string): Promise<{ staff: number; waiting: number }> =>
  (
    await tx<{ staff: number; waiting: number }[]>`
      select
        (select count(*)::int from membership where store_id = ${storeId} and seller_id is null and status = 'active') as staff,
        (select count(*)::int from invitation where store_id = ${storeId} and seller_id is null and accepted_at is null and revoked_at is null) as waiting
    `
  )[0] ?? { staff: 0, waiting: 0 }

/** One People write at a time per store, so a seat counted is still free when it is taken. */
export const lockStorePeople = async (tx: ScopedSql, storeId: string): Promise<void> => {
  await tx`select pg_advisory_xact_lock(hashtext(${`store_people:${storeId}`}))`
}

/** Managers and Staff, active or invited, but the invitation being replaced: the plan's `staff` limit counts them, never an Owner (decided on #290). */
export const countStaffSeats = async (tx: ScopedSql, storeId: string, exceptInvitationId: string | null): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select (
        (select count(*) from membership where store_id = ${storeId} and seller_id is null and status = 'active' and role_key <> 'owner')
        + (select count(*) from invitation where store_id = ${storeId} and seller_id is null and accepted_at is null and revoked_at is null and role_key <> 'owner'
             and id is distinct from ${exceptInvitationId}::uuid)
      )::int as n
    `
  )[0]?.n ?? 0

/** ACCESS.md §6.3: "already a member here" is the only refusal, and nothing the Owner can't already see. */
export const isMemberHere = async (tx: ScopedSql, storeId: string, email: string): Promise<boolean> =>
  (
    await tx`
      select 1 from membership m join "user" u on u.id = m.user_id
      where m.store_id = ${storeId} and m.seller_id is null and m.status in ('active', 'suspended') and lower(u.email) = lower(${email})
    `
  ).length > 0

export const openInvitationTo = async (tx: ScopedSql, storeId: string, email: string): Promise<string | null> =>
  (await tx<{ id: string }[]>`select id from invitation where store_id = ${storeId} and seller_id is null and lower(email) = lower(${email}) and accepted_at is null and revoked_at is null order by created_at desc limit 1`)[0]?.id ?? null

/** The partner's person for this address, made `invited` if new (migrations/0040 `store_invitee`); null when they can't be invited. */
export const invitee = async (tx: ScopedSql, email: string, name: string): Promise<string | null> =>
  (await tx<{ id: string | null }[]>`select store_invitee(${email}, ${name}) as id`)[0]?.id ?? null

/** The invited membership the acceptance activates; a removed one becomes invited again. */
export const holdInvitedMembership = async (tx: ScopedSql, storeId: string, userId: string, role: MerchantRole, invitedBy: string): Promise<void> => {
  const updated = await tx`
    update membership set status = 'invited', role_key = ${role}, invited_by_user_id = ${invitedBy}
    where store_id = ${storeId} and user_id = ${userId} and seller_id is null and status in ('invited', 'removed')
  `
  if (updated.count === 0) {
    await tx`insert into membership (user_id, store_id, role_key, status, invited_by_user_id) values (${userId}, ${storeId}, ${role}, 'invited', ${invitedBy})`
  }
}

export const insertInvitation = async (tx: ScopedSql, i: { storeId: string; email: string; role: MerchantRole; expiresAt: Date; invitedBy: { id: string; label: string }; now: Date }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into invitation (store_id, email, role_key, expires_at, invited_by_user_id, invited_by_label, created_at)
    values (${i.storeId}, ${i.email}, ${i.role}, ${i.expiresAt}, ${i.invitedBy.id}, ${i.invitedBy.label}, ${i.now}) returning id
  `
  if (!row) throw new Error('invitation: insert returned no row')
  return row.id
}

export const selectOpenInvitation = async (tx: ScopedSql, invitationId: string): Promise<{ id: string; email: string; role_key: MerchantRole } | null> =>
  (await tx<{ id: string; email: string; role_key: MerchantRole }[]>`select id, email, role_key from invitation where id = ${invitationId} and seller_id is null and accepted_at is null and revoked_at is null for update`)[0] ?? null

export const revokeInvitation = async (tx: ScopedSql, invitationId: string, now: Date): Promise<void> => {
  await tx`update invitation set revoked_at = ${now} where id = ${invitationId}`
}

/** Invitations sent since `since` by this person, or to this address, in the store: invitations are no email cannon (ACCESS.md §6.2). */
export const countInvitationsSince = async (tx: ScopedSql, storeId: string, since: Date, by: { inviterId?: string; email?: string }): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select count(*)::int as n from invitation
      where store_id = ${storeId} and created_at > ${since}
        and ${by.inviterId ? tx`invited_by_user_id = ${by.inviterId}` : tx`true`}
        and ${by.email ? tx`lower(email) = lower(${by.email})` : tx`true`}
    `
  )[0]?.n ?? 0

export const selectMember = async (tx: ScopedSql, membershipId: string): Promise<{ id: string; user_id: string; role_key: MerchantRole; label: string } | null> =>
  (
    await tx<{ id: string; user_id: string; role_key: MerchantRole; label: string }[]>`
      select m.id, m.user_id, m.role_key, coalesce(u.name, u.email) as label from membership m join "user" u on u.id = m.user_id
      where m.id = ${membershipId} and m.seller_id is null and m.status = 'active' for update of m
    `
  )[0] ?? null

/** The store's other active Owners, locked, so two demotions at once can't both pass the last-Owner check. */
export const countOtherOwners = async (tx: ScopedSql, storeId: string, exceptMembershipId: string): Promise<number> =>
  (
    await tx<{ id: string }[]>`
      select id from membership where store_id = ${storeId} and seller_id is null and status = 'active' and role_key = 'owner' and id <> ${exceptMembershipId} for update
    `
  ).length

export const setMemberRole = async (tx: ScopedSql, membershipId: string, role: MerchantRole): Promise<void> => {
  await tx`update membership set role_key = ${role} where id = ${membershipId}`
}

/** ACCESS.md §6.3: the membership for this store only; the account and its other stores are untouched. */
export const removeMember = async (tx: ScopedSql, membershipId: string): Promise<void> => {
  await tx`update membership set status = 'removed' where id = ${membershipId}`
}
