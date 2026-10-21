import type { PageWindow } from '#core/paging'
import type { ScopedSql } from './index'

// Your team (ACCESS §7.5, VendorViews): one supplier's people and open invitations, read and changed in
// that supplier's scope, so RLS holds every statement to it (migration 0049).

export type SupplierRole = 'supplier-admin' | 'supplier-member'

export interface TeamRow {
  kind: 'member' | 'invitation'
  id: string
  user_id: string | null
  name: string | null
  email: string
  role_key: SupplierRole
  sort_at: Date
  expires_at: Date | null
  /** The only active admin, whose role can't change and who can't be removed. */
  last_admin: boolean
}

/** Active people and open invitations, newest first. */
export const selectSupplierTeam = (tx: ScopedSql, storeId: string, sellerId: string, window: PageWindow): Promise<TeamRow[]> =>
  tx<TeamRow[]>`
    select * from (
      select 'member' as kind, m.id, m.user_id, u.name, u.email, m.role_key, m.created_at as sort_at, null::timestamptz as expires_at,
        m.role_key = 'supplier-admin' and (select count(*) from membership a where a.store_id = m.store_id and a.seller_id = m.seller_id and a.status = 'active' and a.role_key = 'supplier-admin') = 1 as last_admin
      from membership m join "user" u on u.id = m.user_id
      where m.store_id = ${storeId} and m.seller_id = ${sellerId} and m.status = 'active'
      union all
      select 'invitation', i.id, null, null, i.email, i.role_key, i.created_at, i.expires_at, false
      from invitation i
      where i.store_id = ${storeId} and i.seller_id = ${sellerId} and i.accepted_at is null and i.revoked_at is null
    ) team
    where ${window.after ? tx`(sort_at, id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(sort_at, id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by sort_at ${window.before && !window.after ? tx`asc` : tx`desc`}, id ${window.before && !window.after ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `

/** Someone already working in this supplier, who can't be invited into it again. */
export const isInSupplier = async (tx: ScopedSql, storeId: string, sellerId: string, email: string): Promise<boolean> =>
  (
    await tx`
      select 1 from membership m join "user" u on u.id = m.user_id
      where m.store_id = ${storeId} and m.seller_id = ${sellerId} and m.status in ('active', 'suspended') and lower(u.email) = lower(${email})
    `
  ).length > 0

export const openSupplierInvitationTo = async (tx: ScopedSql, storeId: string, sellerId: string, email: string): Promise<string | null> =>
  (
    await tx<{ id: string }[]>`
      select id from invitation where store_id = ${storeId} and seller_id = ${sellerId} and lower(email) = lower(${email}) and accepted_at is null and revoked_at is null
      order by created_at desc limit 1
    `
  )[0]?.id ?? null

export const selectOpenSupplierInvitation = async (tx: ScopedSql, storeId: string, sellerId: string, invitationId: string): Promise<{ id: string; email: string; role_key: SupplierRole } | null> =>
  (
    await tx<{ id: string; email: string; role_key: SupplierRole }[]>`
      select id, email, role_key from invitation
      where id = ${invitationId} and store_id = ${storeId} and seller_id = ${sellerId} and accepted_at is null and revoked_at is null for update
    `
  )[0] ?? null

export const selectSupplierMember = async (tx: ScopedSql, storeId: string, sellerId: string, membershipId: string): Promise<{ id: string; user_id: string; role_key: SupplierRole; label: string } | null> =>
  (
    await tx<{ id: string; user_id: string; role_key: SupplierRole; label: string }[]>`
      select m.id, m.user_id, m.role_key, coalesce(u.name, u.email) as label from membership m join "user" u on u.id = m.user_id
      where m.id = ${membershipId} and m.store_id = ${storeId} and m.seller_id = ${sellerId} and m.status = 'active' for update of m
    `
  )[0] ?? null

/** The supplier's other active admins, locked, so two changes at once can't both pass the last-admin check. */
export const countOtherSupplierAdmins = async (tx: ScopedSql, storeId: string, sellerId: string, exceptMembershipId: string | null): Promise<number> =>
  (
    await tx<{ id: string }[]>`
      select id from membership
      where store_id = ${storeId} and seller_id = ${sellerId} and status = 'active' and role_key = 'supplier-admin' and id is distinct from ${exceptMembershipId}::uuid
      for update
    `
  ).length

export const setSupplierMemberRole = async (tx: ScopedSql, membershipId: string, role: SupplierRole): Promise<void> => {
  await tx`update membership set role_key = ${role} where id = ${membershipId}`
}

export const removeSupplierMember = async (tx: ScopedSql, membershipId: string): Promise<void> => {
  await tx`update membership set status = 'removed' where id = ${membershipId}`
}
