import type { PageWindow } from '#core/paging'
import type { ScopedSql } from './index'

// The merchant's Suppliers tab (ACCESS §5.2, §7.5; DATA-MODEL §4.2, migration 0048): the merchant side
// only, in its own scope. A supplier's people and invitations live in membership and invitation.

/** One of auth's supplier tiers, which the service checks before it writes one. */
export type SupplierTier = string
export type ShippingMode = 'to-store' | 'to-shopper'
export type LabelAccount = 'store' | 'own'
export type SupplierStatus = 'invited' | 'active' | 'suspended' | 'removed'
export type SupplierFilter = 'all' | 'active' | 'suspended'

export interface SupplierRow {
  id: string
  name: string
  access_level: SupplierTier
  shipping_mode: ShippingMode
  label_account: LabelAccount
  status: SupplierStatus
  hide_products_while_suspended: boolean | null
  suspended_at: Date | null
  created_at: Date
  /** Its people, joined or invited. */
  users: number
  /** Its products in the catalogue, hidden ones included. */
  products: number
}

const filterOf = (tx: ScopedSql, filter: SupplierFilter) => {
  switch (filter) {
    case 'active':
      return tx`s.status in ('active', 'invited')`
    case 'suspended':
      return tx`s.status = 'suspended'`
    case 'all':
      return tx`s.status <> 'removed'`
  }
}

const columns = (tx: ScopedSql) => tx`
  s.id, s.name, s.access_level, s.shipping_mode, s.label_account, s.status, s.hide_products_while_suspended, s.suspended_at, s.created_at,
  (select count(*)::int from membership m where m.seller_id = s.id and m.status in ('active', 'invited')) as users,
  (select count(*)::int from product p where p.seller_id = s.id and p.deleted_at is null) as products
`

/** Newest first; a removed supplier leaves the list, its products still marked as its own. */
export const selectSuppliers = (tx: ScopedSql, storeId: string, filter: SupplierFilter, window: PageWindow): Promise<SupplierRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<SupplierRow[]>`
    select ${columns(tx)} from seller s
    where s.store_id = ${storeId} and ${filterOf(tx, filter)}
      and ${window.after ? tx`(s.created_at, s.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(s.created_at, s.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by s.created_at ${backwards ? tx`asc` : tx`desc`}, s.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

export const selectSupplier = async (tx: ScopedSql, storeId: string, id: string): Promise<SupplierRow | null> =>
  (await tx<SupplierRow[]>`select ${columns(tx)} from seller s where s.id = ${id} and s.store_id = ${storeId} and s.status <> 'removed'`)[0] ?? null

export const countSuppliers = async (tx: ScopedSql, storeId: string): Promise<{ all: number; active: number; suspended: number }> =>
  (
    await tx<{ all: number; active: number; suspended: number }[]>`
      select count(*)::int as all, count(*) filter (where status in ('active', 'invited'))::int as active, count(*) filter (where status = 'suspended')::int as suspended
      from seller where store_id = ${storeId} and status <> 'removed'
    `
  )[0] ?? { all: 0, active: 0, suspended: 0 }

/** Suppliers the plan counts (SAAS §6.2): every one not removed. */
export const countLiveSuppliers = async (tx: ScopedSql, storeId: string): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from seller where store_id = ${storeId} and status <> 'removed'`)[0]?.n ?? 0

export const supplierNameTaken = async (tx: ScopedSql, storeId: string, name: string): Promise<boolean> =>
  (await tx`select 1 from seller where store_id = ${storeId} and lower(name) = lower(${name}) and status <> 'removed'`).length > 0

export const insertSupplier = async (tx: ScopedSql, s: { id: string; storeId: string; name: string; tier: SupplierTier; mode: ShippingMode; labels: LabelAccount; now: Date }): Promise<void> => {
  await tx`
    insert into seller (id, store_id, name, access_level, shipping_mode, label_account, status, created_at)
    values (${s.id}, ${s.storeId}, ${s.name}, ${s.tier}, ${s.mode}, ${s.labels}, 'invited', ${s.now})
  `
}

/** Locks the supplier for the change; null when it isn't this store's or was removed. */
export const lockSupplier = async (tx: ScopedSql, storeId: string, id: string): Promise<{ name: string; status: SupplierStatus; access_level: SupplierTier; shipping_mode: ShippingMode; label_account: LabelAccount; hide_products_while_suspended: boolean | null } | null> =>
  (
    await tx<{ name: string; status: SupplierStatus; access_level: SupplierTier; shipping_mode: ShippingMode; label_account: LabelAccount; hide_products_while_suspended: boolean | null }[]>`
      select name, status, access_level, shipping_mode, label_account, hide_products_while_suspended from seller
      where id = ${id} and store_id = ${storeId} and status <> 'removed' for update
    `
  )[0] ?? null

export const setSupplierTier = async (tx: ScopedSql, id: string, tier: SupplierTier): Promise<void> => {
  await tx`update seller set access_level = ${tier} where id = ${id}`
}

export const setSupplierShipping = async (tx: ScopedSql, id: string, mode: ShippingMode, labels: LabelAccount): Promise<void> => {
  await tx`update seller set shipping_mode = ${mode}, label_account = ${labels} where id = ${id}`
}

export const markSupplierSuspended = async (tx: ScopedSql, id: string, hide: boolean, now: Date): Promise<void> => {
  await tx`update seller set status = 'suspended', suspended_at = ${now}, hide_products_while_suspended = ${hide} where id = ${id}`
}

/** Back to active, or to invited when nobody has joined yet. */
export const markSupplierResumed = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`
    update seller set suspended_at = null, hide_products_while_suspended = null,
      status = case when exists (select 1 from membership m where m.seller_id = ${id} and m.status = 'active') then 'active' else 'invited' end
    where id = ${id}
  `
}

export const markSupplierRemoved = async (tx: ScopedSql, id: string, now: Date): Promise<void> => {
  await tx`update seller set status = 'removed', removed_at = ${now}, suspended_at = null, hide_products_while_suspended = null where id = ${id}`
}

/**
 * Hides the supplier's visible products, remembering each one's status so a resume puts it back
 * (ACCESS §7.5); `because` says why. Answers how many it hid.
 */
export const hideSupplierProducts = async (tx: ScopedSql, storeId: string, sellerId: string, because: 'seller_suspended' | 'seller_removed', now: Date): Promise<number> =>
  (
    await tx`
      update product set status_before_hide = coalesce(status_before_hide, visibility), visibility = 'hidden', hidden_by = ${because}, updated_at = ${now}, revision = revision + 1
      where store_id = ${storeId} and seller_id = ${sellerId} and deleted_at is null and hidden_by is distinct from 'plan'
        and (visibility = 'visible' or hidden_by = 'seller_suspended')
    `
  ).count

/** Puts back what a suspension hid, as each product was before. */
export const restoreSupplierProducts = async (tx: ScopedSql, storeId: string, sellerId: string, now: Date): Promise<number> =>
  (
    await tx`
      update product set visibility = coalesce(status_before_hide, visibility), status_before_hide = null, hidden_by = null, updated_at = ${now}, revision = revision + 1
      where store_id = ${storeId} and seller_id = ${sellerId} and deleted_at is null and hidden_by = 'seller_suspended'
    `
  ).count

/** Its people lose access at once, and its open invitations close (ACCESS §7.5). */
export const endSupplierAccess = async (tx: ScopedSql, storeId: string, sellerId: string, now: Date): Promise<void> => {
  await tx`update membership set status = 'removed' where store_id = ${storeId} and seller_id = ${sellerId} and status <> 'removed'`
  await tx`update invitation set revoked_at = ${now} where store_id = ${storeId} and seller_id = ${sellerId} and accepted_at is null and revoked_at is null`
}

/** A person already in this store on the merchant side or in this supplier, who can't be invited into it. */
export const holdsSeatHere = async (tx: ScopedSql, storeId: string, sellerId: string | null, email: string): Promise<boolean> =>
  (
    await tx`
      select 1 from membership m join "user" u on u.id = m.user_id
      where m.store_id = ${storeId} and lower(u.email) = lower(${email}) and m.status in ('active', 'suspended')
        and (m.seller_id is null or m.seller_id is not distinct from ${sellerId}::uuid)
    `
  ).length > 0

export const insertSupplierInvitation = async (tx: ScopedSql, i: { storeId: string; sellerId: string; email: string; role: 'supplier-admin' | 'supplier-member'; expiresAt: Date; invitedBy: { id: string; label: string }; now: Date }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into invitation (store_id, seller_id, email, role_key, expires_at, invited_by_user_id, invited_by_label, created_at)
    values (${i.storeId}, ${i.sellerId}, ${i.email}, ${i.role}, ${i.expiresAt}, ${i.invitedBy.id}, ${i.invitedBy.label}, ${i.now}) returning id
  `
  if (!row) throw new Error('invitation: insert returned no row')
  return row.id
}

/** The person's held seat in the supplier, made or reopened, waiting for them to join. */
export const holdInvitedSupplierSeat = async (tx: ScopedSql, storeId: string, sellerId: string, userId: string, role: 'supplier-admin' | 'supplier-member', invitedBy: string): Promise<void> => {
  const updated = await tx`
    update membership set status = 'invited', role_key = ${role}, invited_by_user_id = ${invitedBy}
    where store_id = ${storeId} and user_id = ${userId} and seller_id = ${sellerId} and status in ('invited', 'removed')
  `
  if (updated.count === 0) {
    await tx`insert into membership (user_id, store_id, seller_id, role_key, status, invited_by_user_id) values (${userId}, ${storeId}, ${sellerId}, ${role}, 'invited', ${invitedBy})`
  }
}
