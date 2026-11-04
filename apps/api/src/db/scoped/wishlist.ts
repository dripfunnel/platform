import type { ScopedSql } from './index'

// A signed-in shopper's wishlist (migration 0382; DATA-MODEL §7.6): read and written as app_shop for its own account, and
// read in store scope for an abandoned cart's page.

/** The most a shopper keeps (#1213). */
export const maxWishlist = 100

/** The shopper's products, newest first. */
export const selectWishlistProductIds = async (tx: ScopedSql, storeId: string, customerId: string): Promise<string[]> =>
  (await tx<{ product_id: string }[]>`select product_id from wishlist_item where store_id = ${storeId} and customer_id = ${customerId} order by created_at desc, product_id limit ${maxWishlist}`).map((r) => r.product_id)

export const countWishlist = async (tx: ScopedSql, storeId: string, customerId: string): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from wishlist_item where store_id = ${storeId} and customer_id = ${customerId}`)[0]?.n ?? 0

/** Whether this store has the product, as the shopper may see it (hidden and other stores' products are not there). */
export const selectProductSeen = async (tx: ScopedSql, storeId: string, productId: string): Promise<boolean> =>
  (await tx`select 1 from product where id = ${productId} and store_id = ${storeId}`).length > 0

/** False when it was already there. */
export const insertWishlistItem = async (tx: ScopedSql, storeId: string, customerId: string, productId: string, now: Date): Promise<boolean> =>
  (await tx`insert into wishlist_item (store_id, customer_id, product_id, created_at) values (${storeId}, ${customerId}, ${productId}, ${now}) on conflict do nothing`).count > 0

/** False when it wasn't there. */
export const deleteWishlistItem = async (tx: ScopedSql, storeId: string, customerId: string, productId: string): Promise<boolean> =>
  (await tx`delete from wishlist_item where store_id = ${storeId} and customer_id = ${customerId} and product_id = ${productId}`).count > 0

/** The products an account's wishlist holds that a cart's own lines don't, newest first; none for an erased account. */
export const selectWishlistBesideCart = async (tx: ScopedSql, storeId: string, customerId: string, orderId: string): Promise<string[]> =>
  (
    await tx<{ product_id: string }[]>`
      select w.product_id from wishlist_item w join customer c on c.id = w.customer_id and c.store_id = w.store_id and c.status <> 'deleted'
      where w.store_id = ${storeId} and w.customer_id = ${customerId}
        and not exists (select 1 from cart_line l join product_version v on v.id = l.version_id where l.order_id = ${orderId} and v.product_id = w.product_id)
      order by w.created_at desc, w.product_id limit ${maxWishlist}
    `
  ).map((r) => r.product_id)
