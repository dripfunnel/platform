import type { PageWindow } from '#core/paging'
import type { ScopedSql } from './index'
import { likePattern } from './stores'

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

/** A shopper with something on their wishlist, for the Carts screen's Wishlists tab. */
export interface WishlistShopperRow {
  customer_id: string
  name: string | null
  email: string | null
  items: number
  last_saved_at: Date
  /** The newest saved product's name. */
  first_product: string | null
  sent: number
  last_sent_at: Date | null
  stopped_at: Date | null
  stopped_note: string | null
  stopped_by: string | null
}

/** The Wishlists tab's three views: nobody has reminded them yet, they were reminded, or the team stopped their reminders. */
export const wishlistTabs = ['waiting', 'reminded', 'stopped'] as const
export type WishlistTab = (typeof wishlistTabs)[number]

const inTab = (tx: ScopedSql, tab: WishlistTab | null) =>
  tab === 'stopped' ? tx`s.stopped_at is not null` : tab === 'reminded' ? tx`s.stopped_at is null and s.sent > 0` : tab === 'waiting' ? tx`s.stopped_at is null and s.sent = 0` : tx`true`

/** A page of the store's shoppers with a wishlist in a tab (all when null), the newest saved first; search finds a name, an email or a product. Erased accounts are left out. */
export const selectWishlistShoppers = (tx: ScopedSql, storeId: string, tab: WishlistTab | null, search: string | null, window: PageWindow): Promise<WishlistShopperRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<WishlistShopperRow[]>`
    select * from (
      select cu.id as customer_id, cu.name, cu.email, count(*)::int as items, date_trunc('milliseconds', max(w.created_at)) as last_saved_at,
        (select count(*)::int from wishlist_reminder r where r.store_id = w.store_id and r.customer_id = cu.id and r.state = 'sent') as sent,
        (select max(r.sent_at) from wishlist_reminder r where r.store_id = w.store_id and r.customer_id = cu.id and r.state = 'sent') as last_sent_at,
        cu.wishlist_reminders_stopped_at as stopped_at, cu.wishlist_reminders_stopped_note as stopped_note,
        (select coalesce(u.name, u.email) from "user" u where u.id = cu.wishlist_reminders_stopped_by_user_id) as stopped_by,
        (select p.name from wishlist_item w2 join product p on p.id = w2.product_id where w2.store_id = w.store_id and w2.customer_id = w.customer_id order by w2.created_at desc, w2.product_id limit 1) as first_product
      from wishlist_item w join customer cu on cu.id = w.customer_id and cu.store_id = w.store_id and cu.status <> 'deleted'
      where w.store_id = ${storeId}
        and ${
          search
            ? tx`(cu.name ilike ${likePattern(search)} or cu.email ilike ${likePattern(search)}
                or exists (select 1 from wishlist_item w3 join product p3 on p3.id = w3.product_id where w3.store_id = w.store_id and w3.customer_id = w.customer_id and p3.name ilike ${likePattern(search)}))`
            : tx`true`
        }
      group by cu.id, w.store_id, w.customer_id
    ) s
    where ${inTab(tx, tab)} and ${window.after ? tx`(s.last_saved_at, s.customer_id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(s.last_saved_at, s.customer_id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by s.last_saved_at ${backwards ? tx`asc` : tx`desc`}, s.customer_id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

/** How many shoppers each tab holds, by the rule the list uses. */
export const countWishlistTabs = async (tx: ScopedSql, storeId: string): Promise<Record<WishlistTab, number>> => {
  const [row] = await tx<{ waiting: number; reminded: number; stopped: number }[]>`
    select count(*) filter (where s.stopped_at is null and s.sent = 0)::int as waiting, count(*) filter (where s.stopped_at is null and s.sent > 0)::int as reminded, count(*) filter (where s.stopped_at is not null)::int as stopped
    from (
      select cu.wishlist_reminders_stopped_at as stopped_at, (select count(*) from wishlist_reminder r where r.store_id = cu.store_id and r.customer_id = cu.id and r.state = 'sent') as sent
      from customer cu where cu.store_id = ${storeId} and cu.status <> 'deleted' and exists (select 1 from wishlist_item w where w.store_id = cu.store_id and w.customer_id = cu.id)
    ) s
  `
  return { waiting: row?.waiting ?? 0, reminded: row?.reminded ?? 0, stopped: row?.stopped ?? 0 }
}

export interface WishlistSummaryRow {
  shoppers: number
  products: number
  reachable: number
  reminders_sent: number
  reminded: number
}

/** The tiles above the tabs: everyone with a wishlist now, and what the reminders did since a date. */
export const selectWishlistSummary = async (tx: ScopedSql, storeId: string, since: Date): Promise<WishlistSummaryRow> => {
  const [row] = await tx<WishlistSummaryRow[]>`
    select
      (select count(distinct w.customer_id)::int from wishlist_item w join customer cu on cu.id = w.customer_id and cu.store_id = w.store_id and cu.status <> 'deleted' where w.store_id = ${storeId}) as shoppers,
      (select count(*)::int from wishlist_item w join customer cu on cu.id = w.customer_id and cu.store_id = w.store_id and cu.status <> 'deleted' where w.store_id = ${storeId}) as products,
      (select count(distinct w.customer_id)::int from wishlist_item w join customer cu on cu.id = w.customer_id and cu.store_id = w.store_id and cu.status <> 'deleted'
        where w.store_id = ${storeId} and cu.email is not null and cu.wishlist_reminders_stopped_at is null) as reachable,
      (select count(*)::int from wishlist_reminder r where r.store_id = ${storeId} and r.state = 'sent' and r.sent_at >= ${since}) as reminders_sent,
      (select count(distinct r.customer_id)::int from wishlist_reminder r where r.store_id = ${storeId} and r.state = 'sent' and r.sent_at >= ${since}) as reminded
  `
  if (!row) throw new Error('wishlist summary: no row')
  return row
}

export interface WishlistShopperDetailRow extends WishlistShopperRow {
  language: string
  currency: string
  features: Record<string, boolean>
  product_ids: string[]
}

/** One shopper with their wishlist's products (newest first) and the store's language and currency to show them in; null for one with none, or erased. */
export const selectWishlistShopper = async (tx: ScopedSql, storeId: string, customerId: string): Promise<WishlistShopperDetailRow | null> =>
  (
    await tx<WishlistShopperDetailRow[]>`
      select cu.id as customer_id, cu.name, cu.email, count(*)::int as items, date_trunc('milliseconds', max(w.created_at)) as last_saved_at, null::text as first_product,
        (select count(*)::int from wishlist_reminder r where r.store_id = w.store_id and r.customer_id = cu.id and r.state = 'sent') as sent,
        (select max(r.sent_at) from wishlist_reminder r where r.store_id = w.store_id and r.customer_id = cu.id and r.state = 'sent') as last_sent_at,
        cu.wishlist_reminders_stopped_at as stopped_at, cu.wishlist_reminders_stopped_note as stopped_note,
        (select coalesce(u.name, u.email) from "user" u where u.id = cu.wishlist_reminders_stopped_by_user_id) as stopped_by,
        (select s.main_language from store s where s.id = w.store_id) as language, (select s.pricing_currency from store s where s.id = w.store_id) as currency,
        coalesce((select json_object_agg(sf.key, sf.enabled) from store_feature sf where sf.store_id = w.store_id), '{}'::json) as features,
        coalesce((select json_agg(x.product_id) from (select w2.product_id from wishlist_item w2 where w2.store_id = w.store_id and w2.customer_id = cu.id order by w2.created_at desc, w2.product_id limit ${maxWishlist}) x), '[]'::json) as product_ids
      from wishlist_item w join customer cu on cu.id = w.customer_id and cu.store_id = w.store_id and cu.status <> 'deleted'
      where w.store_id = ${storeId} and w.customer_id = ${customerId}
      group by cu.id, w.store_id
    `
  )[0] ?? null
