import type { ScopedSql } from './index'
import { publicOffer } from './promotions'
import { goneThrough } from './storeOrders'

// What the studio's AI knows of its own store (storefront ARCHITECTURE §6.2; #1242), read on the merchant side in the
// store's scope, one statement each. Never a customer, a single order, an address or a code (SAAS §9.2).

export const summaryDays = 90
/** A city is named only with this many shoppers' orders behind it, so one repeat shopper never names their own. */
export const minCityOrders = 5
export const summaryLimits = { collections: 30, bestSellers: 10, topCollections: 5, cities: 5, offers: 20, newest: 8 } as const
export const maxLookupProducts = 24
export const maxLookupCollections = 50
export const maxLookupPhotos = 4

/** A product as the AI reads it: the lowest price in the pricing currency, minor units as text. */
export interface SummaryProductRow {
  name: string
  slug: string
  amount: string | null
  units?: string | null
}

export interface StoreSummaryRow {
  name: string
  city: string | null
  country: string | null
  currency: string
  tax_inclusive: boolean
  languages: string[]
  currencies: string[]
  shipping: { free: 'never' | 'always' | 'over'; free_over: string | null; flat: string | null; pickup: boolean; courier: boolean; currency: string } | null
  payments: string[]
  brand: { tagline: string | null; description: string | null; voice: string | null; colours: (string | null)[] } | null
  products: number
  collection_count: number
  collections: { name: string; slug: string; products: number; image: boolean }[]
  best_sellers: SummaryProductRow[]
  top_collections: { name: string; slug: string; units: string }[]
  cities: { city: string; orders: number }[]
  offers: { name: string; ends_at: string | null; operation: string }[]
  newest: SummaryProductRow[]
}

const visible = (tx: ScopedSql, alias: 'p' | 'c') => (alias === 'p' ? tx`p.visibility = 'visible' and p.deleted_at is null` : tx`c.visibility = 'visible' and c.deleted_at is null`)
const lowest = (tx: ScopedSql) => tx`(select min(vp.amount)::text from product_version v join version_price vp on vp.version_id = v.id and vp.currency = s.pricing_currency where v.product_id = p.id)`

export const selectStoreSummary = async (tx: ScopedSql, storeId: string, now: Date): Promise<StoreSummaryRow | null> => {
  const since = new Date(now.getTime() - summaryDays * 24 * 60 * 60 * 1000)
  const l = summaryLimits
  const [row] = await tx<StoreSummaryRow[]>`
    select s.name, nullif(btrim(s.address ->> 'city'), '') as city, s.country, s.pricing_currency::text as currency, s.tax_inclusive,
      coalesce((select json_agg(x.language order by x.position, x.language) from store_language x where x.store_id = s.id and x.status = 'active'), '[]'::json) as languages,
      coalesce((select json_agg(x.currency order by x.position, x.currency) from store_currency x where x.store_id = s.id and x.status = 'active'), '[]'::json) as currencies,
      (select json_build_object('free', h.free_mode, 'free_over', h.free_threshold_amount::text, 'flat', case when h.flat_enabled then h.flat_amount::text end,
          'pickup', h.pickup_enabled, 'courier', h.courier_enabled, 'currency', h.currency) from store_shipping h where h.store_id = s.id) as shipping,
      coalesce((select json_agg(distinct a.provider) from payment_provider_account a where a.store_id = s.id and a.mode = 'live' and a.status = 'live' and not a.paused_by_plan), '[]'::json) as payments,
      (select json_build_object('tagline', b.tagline, 'description', coalesce(b.description, s.description), 'voice', b.voice, 'colours', json_build_array(b.primary_colour, b.secondary_colour))
        from storefront_brand b where b.store_id = s.id) as brand,
      (select count(*)::int from product p where p.store_id = s.id and ${visible(tx, 'p')}) as products,
      (select count(*)::int from collection c where c.store_id = s.id and ${visible(tx, 'c')}) as collection_count,
      coalesce((select json_agg(json_build_object('name', c.name, 'slug', c.slug, 'products', c.n, 'image', c.image) order by c.created_at, c.id) from (
        select c.name, c.slug, c.created_at, c.id, c.image_asset_id is not null as image,
          (select count(*)::int from collection_product cp join product p on p.id = cp.product_id and ${visible(tx, 'p')} where cp.collection_id = c.id) as n
        from collection c where c.store_id = s.id and ${visible(tx, 'c')} order by c.created_at, c.id limit ${l.collections}) c), '[]'::json) as collections,
      coalesce((select json_agg(json_build_object('name', b.name, 'slug', b.slug, 'amount', b.amount, 'units', b.units) order by b.position) from (
        select p.name, p.slug, ${lowest(tx)} as amount, r.units::text as units, r.position
        from product_rank r join product p on p.id = r.product_id and ${visible(tx, 'p')}
        where r.store_id = s.id order by r.position limit ${l.bestSellers}) b), '[]'::json) as best_sellers,
      coalesce((select json_agg(json_build_object('name', t.name, 'slug', t.slug, 'units', t.units) order by t.n desc, t.slug) from (
        select c.name, c.slug, sum(r.units) as n, sum(r.units)::text as units
        from product_rank r join collection_product cp on cp.product_id = r.product_id join collection c on c.id = cp.collection_id and ${visible(tx, 'c')}
        where r.store_id = s.id group by c.id, c.name, c.slug order by n desc, c.slug limit ${l.topCollections}) t), '[]'::json) as top_collections,
      coalesce((select json_agg(json_build_object('city', y.city, 'orders', y.orders) order by y.orders desc, y.city) from (
        select initcap(lower(btrim(o.shipping_address ->> 'city'))) as city, count(*)::int as orders
        from "order" o
        where o.store_id = s.id and o.state = 'placed' and o.placed_at >= ${since} and o.placed_at <= ${now} and ${goneThrough(tx)}
          and nullif(btrim(o.shipping_address ->> 'city'), '') is not null
        group by 1 having count(distinct coalesce(o.customer_id::text, lower(o.email), o.id::text)) >= ${minCityOrders}
        order by 2 desc, 1 limit ${l.cities}) y), '[]'::json) as cities,
      coalesce((select json_agg(json_build_object('name', p.name, 'ends_at', p.ends_at, 'operation', p.operation) order by p.ends_at nulls last, p.created_at, p.id) from (
        select p.name, p.ends_at, p.created_at, p.id, (select x.operation from promotion_action x where x.promotion_id = p.id order by x.position limit 1) as operation
        from promotion p where ${publicOffer(tx, tx`s.id`, now)} order by p.ends_at nulls last, p.created_at, p.id limit ${l.offers}) p), '[]'::json) as offers,
      coalesce((select json_agg(json_build_object('name', n.name, 'slug', n.slug, 'amount', n.amount) order by n.created_at desc, n.id desc) from (
        select p.name, p.slug, p.created_at, p.id, ${lowest(tx)} as amount from product p where p.store_id = s.id and ${visible(tx, 'p')}
        order by p.created_at desc, p.id desc limit ${l.newest}) n), '[]'::json) as newest
    from store s where s.id = ${storeId}
  `
  return row ?? null
}

export type LookupSort = 'best-selling' | 'newest' | 'price-low' | 'price-high' | 'name'

export interface LookupProductRow {
  name: string
  slug: string
  amount: string | null
  currency: string
  description: string
  photos: string[]
  collections: string[]
  /** The ranking's position; null for a product that hasn't sold in the window. */
  rank: number | null
}

/** Products of a collection or the whole catalogue in a sort, at most 24: names, prices and photo asset ids. */
export const selectLookupProducts = (tx: ScopedSql, storeId: string, q: { collection: string | null; sort: LookupSort; limit: number }): Promise<LookupProductRow[]> => {
  const order = {
    'best-selling': tx`p.rank nulls last, p.created_at desc, p.id`,
    newest: tx`p.created_at desc, p.id`,
    'price-low': tx`p.amount::bigint nulls last, p.id`,
    'price-high': tx`p.amount::bigint desc nulls last, p.id`,
    name: tx`lower(p.name), p.id`,
  }[q.sort]
  return tx<LookupProductRow[]>`
    select p.name, p.slug, p.amount, p.currency, p.description, p.photos, p.collections, p.rank from (
      select p.id, p.created_at, p.name, p.slug, s.pricing_currency::text as currency, left(p.description, 200) as description, ${lowest(tx)} as amount,
        (select r.position from product_rank r where r.store_id = p.store_id and r.product_id = p.id) as rank,
        coalesce((select json_agg(f.asset_id order by f.position) from (select ph.asset_id, ph.position from product_photo ph where ph.product_id = p.id order by ph.position limit ${maxLookupPhotos}) f), '[]'::json) as photos,
        coalesce((select json_agg(k.name order by k.created_at) from (select c.name, c.created_at from collection_product cp join collection c on c.id = cp.collection_id and ${visible(tx, 'c')}
          where cp.product_id = p.id order by c.created_at limit 5) k), '[]'::json) as collections
      from product p join store s on s.id = p.store_id
      where p.store_id = ${storeId} and ${visible(tx, 'p')}
        and ${q.collection === null ? tx`true` : tx`exists (select 1 from collection_product cp join collection c on c.id = cp.collection_id and ${visible(tx, 'c')} where cp.product_id = p.id and c.slug = ${q.collection})`}
    ) p
    order by ${order}
    limit ${Math.min(q.limit, maxLookupProducts)}
  `
}

export interface LookupCollectionRow {
  name: string
  slug: string
  description: string
  products: number
  image_asset_id: string | null
}

export const selectLookupCollections = (tx: ScopedSql, storeId: string, limit: number): Promise<LookupCollectionRow[]> =>
  tx<LookupCollectionRow[]>`
    select c.name, c.slug, left(c.description, 200) as description, c.image_asset_id,
      (select count(*)::int from collection_product cp join product p on p.id = cp.product_id and ${visible(tx, 'p')} where cp.collection_id = c.id) as products
    from collection c where c.store_id = ${storeId} and ${visible(tx, 'c')}
    order by c.created_at, c.id limit ${Math.min(limit, maxLookupCollections)}
  `

export interface LookupPhotoRow {
  asset_id: string
  r2_key: string
  mime: string
}

/** A visible product's photos, at most 4, each small enough to send to a model as it is stored. */
export const selectLookupPhotos = (tx: ScopedSql, storeId: string, slug: string, maxBytes: number): Promise<LookupPhotoRow[]> =>
  tx<LookupPhotoRow[]>`
    select a.id as asset_id, a.r2_key, a.mime from product p
    join product_photo ph on ph.product_id = p.id join asset a on a.id = ph.asset_id and a.store_id = p.store_id
    where p.store_id = ${storeId} and p.slug = ${slug} and ${visible(tx, 'p')} and a.kind = 'image' and a.bytes <= ${maxBytes}
    order by ph.position limit ${maxLookupPhotos}
  `
