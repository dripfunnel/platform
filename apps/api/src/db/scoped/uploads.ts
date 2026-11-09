import { pgArray, type ScopedSql } from './index'

// Shoppers' uploaded files (migration 0393; DATA-MODEL §7.6): written and removed as the shopper under its own-cart policy,
// read in system scope only to stream one through a signed link. r2_key is never selected by a request role.

export type UploadMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'application/pdf'

/** Where a cart's file lives: from its ids alone, so a shopper never needs to read the column to queue its deletion. */
export const uploadKey = (storeId: string, orderId: string, id: string): string => `stores/${storeId}/shopper-uploads/${orderId}/${id}`

export const insertShopperUpload = async (tx: ScopedSql, u: { id: string; storeId: string; orderId: string; questionId: string; mime: UploadMime; bytes: number; checksum: string }): Promise<void> => {
  await tx`
    insert into shopper_upload (id, store_id, order_id, question_id, r2_key, mime, bytes, checksum)
    values (${u.id}, ${u.storeId}, ${u.orderId}, ${u.questionId}, ${uploadKey(u.storeId, u.orderId, u.id)}, ${u.mime}, ${u.bytes}, ${u.checksum})
  `
}

/** The cart's files and the question each answers, as the shopper reads them. */
export const selectCartUploads = (tx: ScopedSql, orderId: string): Promise<{ id: string; question_id: string | null; mime: UploadMime }[]> =>
  tx<{ id: string; question_id: string | null; mime: UploadMime }[]>`select id, question_id, mime from shopper_upload where order_id = ${orderId}`

/** The open cart holding this file, expired or not, as the shopper reads it, so its owner can erase it after the cart's life. */
export const selectUploadCart = async (tx: ScopedSql, storeId: string, id: string): Promise<{ order_id: string; named: boolean } | null> =>
  (await tx<{ order_id: string; named: boolean }[]>`
    select u.order_id, exists (select 1 from cart_line l where l.order_id = u.order_id and l.answers is not null
      and jsonb_path_exists(l.answers, '$[*].uploads[*] ? (@ == $id)', jsonb_build_object('id', u.id::text))) as named
    from shopper_upload u join "order" o on o.id = u.order_id
    where u.store_id = ${storeId} and u.id = ${id} and o.state = 'cart'
  `)[0] ?? null

/** Deletes those of these files no line of the cart names any more, as the shopper (its own-cart delete policy); each row's trigger queues its object's deletion (0393). */
export const releaseCartUploads = async (tx: ScopedSql, orderId: string, ids: readonly string[]): Promise<void> => {
  if (ids.length === 0) return
  await tx`
    delete from shopper_upload u where u.order_id = ${orderId} and u.id = any (${pgArray(ids)}::uuid[])
      and not exists (select 1 from cart_line l where l.order_id = u.order_id and l.answers is not null
        and jsonb_path_exists(l.answers, '$[*].uploads[*] ? (@ == $id)', jsonb_build_object('id', u.id::text)))
  `
}

/** Whether a row still names this key, in system scope: the deletion job never removes a file still on record. */
export const uploadKeyInUse = async (tx: ScopedSql, storeId: string, key: string): Promise<boolean> =>
  (await tx`select 1 from shopper_upload where store_id = ${storeId} and r2_key = ${key} limit 1`).length > 0

/** A file a signed link may still open: its store not suspended, cancelled or closed (the link outlives no store; #1369). */
export const selectServableUpload = async (tx: ScopedSql, storeId: string, id: string): Promise<{ id: string; mime: UploadMime; bytes: number; r2_key: string } | null> =>
  (await tx<{ id: string; mime: UploadMime; bytes: number; r2_key: string }[]>`
    select u.id, u.mime, u.bytes, u.r2_key from shopper_upload u join store s on s.id = u.store_id
    where u.store_id = ${storeId} and u.id = ${id} and s.status in ('trial', 'active', 'past_due')
  `)[0] ?? null

/** One order's files its lines' answers name, for the merchant side or the line's supplier, in system scope by store and order. */
export const selectUploadFiles = async (tx: ScopedSql, storeId: string, orderId: string, ids: readonly string[]): Promise<{ id: string; order_id: string; mime: UploadMime; bytes: number; r2_key: string }[]> =>
  ids.length === 0 ? [] : tx<{ id: string; order_id: string; mime: UploadMime; bytes: number; r2_key: string }[]>`
    select id, order_id, mime, bytes, r2_key from shopper_upload where store_id = ${storeId} and order_id = ${orderId} and id = any (${pgArray(ids)}::uuid[])
  `
