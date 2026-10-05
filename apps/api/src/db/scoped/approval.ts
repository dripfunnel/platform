import type { ScopedSql } from './index'

// Approval of suppliers' products (ACCESS §7.2, migration 0050): the store's switch and the queue's moves.
// What a supplier's own save may do is 0050's guard's; these are the merchant side's but submitting.

/** The acting store's switch, which a supplier reads too (it reads no store row). */
export const approvalRequired = async (tx: ScopedSql): Promise<boolean> =>
  (await tx<{ on: boolean }[]>`select store_vendor_approval() as on`)[0]?.on ?? false

/** Through 0050's definer: the merchant side writes no other column of the store row. */
export const setApprovalRequired = async (tx: ScopedSql, on: boolean): Promise<void> => {
  await tx`select set_store_vendor_approval(${on})`
}

/** A supplier's live product back in the queue and off the storefront until approved; false when it was already waiting. */
export const submitForApproval = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<boolean> =>
  (
    await tx`
      update product set approval_status = 'pending', visibility = 'hidden', sent_back_reason = null, updated_at = ${now}
      where id = ${id} and store_id = ${storeId} and seller_id is not null and deleted_at is null and approval_status is distinct from 'pending'
    `
  ).count > 0

/** Approved and shown, unless something else hides it (the plan, a suspension); null when it isn't waiting. */
export const approveProduct = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<{ name: string } | null> =>
  (
    await tx<{ name: string }[]>`
      update product set approval_status = 'approved', sent_back_reason = null,
        visibility = case when hidden_by is null then 'visible' else visibility end, updated_at = ${now}, revision = revision + 1
      where id = ${id} and store_id = ${storeId} and seller_id is not null and approval_status = 'pending' and deleted_at is null
      returning name
    `
  )[0] ?? null

/** Sent back with the reason its supplier sees; it stays hidden. Null when it isn't waiting. */
export const sendBackProduct = async (tx: ScopedSql, storeId: string, id: string, reason: string, now: Date): Promise<{ name: string } | null> =>
  (
    await tx<{ name: string }[]>`
      update product set approval_status = 'sent_back', sent_back_reason = ${reason}, updated_at = ${now}, revision = revision + 1
      where id = ${id} and store_id = ${storeId} and seller_id is not null and approval_status = 'pending' and deleted_at is null
      returning name
    `
  )[0] ?? null

/** Suppliers' products waiting for the merchant's review: the Products row's badge. */
export const countAwaitingApproval = async (tx: ScopedSql, storeId: string): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from product where store_id = ${storeId} and approval_status = 'pending' and deleted_at is null`)[0]?.n ?? 0
