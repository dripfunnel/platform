import type { PageWindow } from '#core/paging'
import { pgArray, type ScopedSql } from './index'

// What a storefront reads (PLATFORM-PROMPT §5.5), as app_shop in shop scope (migration 0064): RLS keeps every row to the
// storefront's store and to what shoppers may see, and the role to the public columns.

/** A field in the shopper's language, falling back to the main-language text on the row (CATALOG facts 19–20). */
const translated = (tx: ScopedSql, entity: string, id: ReturnType<ScopedSql>, field: string, fallback: ReturnType<ScopedSql>, language: string) => tx`
  coalesce((select t.text from translation t where t.entity = ${entity} and t.entity_id = ${id}::text and t.field = ${field} and t.language = ${language}), ${fallback})
`

export interface ShopStoreRow {
  name: string
  description: string | null
  logo_asset_id: string | null
  address: { street?: string; city?: string; postal?: string; region?: string }
  contact_email: string | null
  contact_phone: string | null
  time_zone: string | null
  country: string | null
  unit_system: 'metric' | 'imperial'
  pricing_currency: string
  main_language: string
  tax_inclusive: boolean
  languages: string[]
  currencies: { currency: string; mode: 'manual' | 'convert' }[]
  markets: { id: string; parent_id: string | null; name: string; is_primary: boolean; is_fallback: boolean; countries: string[]; currency: string; language: string | null; web_mode: 'main' | 'path'; path_prefix: string | null }[]
}

export const selectShopStore = async (tx: ScopedSql, storeId: string): Promise<ShopStoreRow | null> =>
  (
    await tx<ShopStoreRow[]>`
      select s.name, s.description, s.logo_asset_id, s.address, s.contact_email, s.contact_phone, s.time_zone, s.country, s.unit_system,
        s.pricing_currency::text as pricing_currency, s.main_language, s.tax_inclusive,
        coalesce((select json_agg(l.language order by l.position, l.language) from store_language l where l.store_id = s.id), '[]'::json) as languages,
        coalesce((select json_agg(json_build_object('currency', c.currency, 'mode', c.mode) order by c.position, c.currency) from store_currency c where c.store_id = s.id), '[]'::json) as currencies,
        coalesce((select json_agg(json_build_object('id', m.id, 'parent_id', m.parent_id, 'name', m.name, 'is_primary', m.is_primary, 'is_fallback', m.is_fallback,
            'countries', m.countries, 'currency', m.currency, 'language', m.language, 'web_mode', m.web_mode, 'path_prefix', m.path_prefix) order by m.position, m.name)
          from market m where m.store_id = s.id), '[]'::json) as markets
      from store s where s.id = ${storeId}
    `
  )[0] ?? null

export interface ShopMenuItemRow {
  id: string
  parent_id: string | null
  label: string
  kind: 'collection' | 'page' | 'url'
  collection_slug: string | null
  url: string | null
}

/**
 * The main menu in order, one level of nesting; an item linking a collection shoppers can't see is left out, with its
 * children.
 */
/** Served on every storefront page from a public API: a menu longer than this shows its first items (WORKFLOW §7). */
export const maxMenuItems = 300

export const selectShopMenu = (tx: ScopedSql, storeId: string, language: string): Promise<ShopMenuItemRow[]> =>
  tx<ShopMenuItemRow[]>`
    with items as (
      select i.id, i.parent_id, i.label, i.kind, i.url, i.position, c.id as collection_id,
        case when c.id is null then null else ${translated(tx, 'collection', tx`c.id`, 'slug', tx`c.slug`, language)} end as collection_slug
      from menu m join menu_item i on i.menu_id = m.id
      left join collection c on c.id = i.collection_id
      where m.store_id = ${storeId} and m.key = 'main' and (i.kind <> 'collection' or c.id is not null)
    )
    select i.id, i.parent_id, i.label, i.kind, i.collection_slug, i.url from items i
    where i.parent_id is null or exists (select 1 from items p where p.id = i.parent_id)
    order by i.parent_id nulls first, i.position
    limit ${maxMenuItems}
  `

export interface ShopCollectionRow {
  id: string
  name: string
  slug: string
  description: string
  image_asset_id: string | null
  parent_id: string | null
  seo_title: string | null
  seo_description: string | null
  sort: 'manual' | 'newest' | 'price_asc' | 'price_desc' | 'best_selling'
  created_at: Date
}

const collectionColumns = (tx: ScopedSql, language: string) => tx`
  c.id, ${translated(tx, 'collection', tx`c.id`, 'name', tx`c.name`, language)} as name,
  ${translated(tx, 'collection', tx`c.id`, 'slug', tx`c.slug`, language)} as slug,
  ${translated(tx, 'collection', tx`c.id`, 'description', tx`c.description`, language)} as description,
  c.image_asset_id, c.parent_id, c.seo_title, c.seo_description, c.sort, c.created_at
`

/** Oldest first, as the merchant made them; a sub-collection whose parent shoppers can't see is still listed on its own. */
export const selectShopCollections = (tx: ScopedSql, storeId: string, language: string, window: PageWindow): Promise<ShopCollectionRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<ShopCollectionRow[]>`
    select ${collectionColumns(tx, language)} from collection c
    where c.store_id = ${storeId}
      and ${window.after ? tx`(c.created_at, c.id) > (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(c.created_at, c.id) < (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by c.created_at ${backwards ? tx`desc` : tx`asc`}, c.id ${backwards ? tx`desc` : tx`asc`}
    limit ${window.limit + 1}
  `
}

/** By its web address in the shopper's language, or the main language's (an old link keeps working). */
export const selectShopCollection = async (tx: ScopedSql, storeId: string, language: string, slug: string): Promise<ShopCollectionRow | null> =>
  (
    await tx<ShopCollectionRow[]>`
      select ${collectionColumns(tx, language)} from collection c
      where c.store_id = ${storeId} and (c.slug = ${slug} or exists (
        select 1 from translation t where t.entity = 'collection' and t.entity_id = c.id::text and t.field = 'slug' and t.language = ${language} and t.text = ${slug}
      ))
      order by (c.slug = ${slug}) desc
      limit 1
    `
  )[0] ?? null

export interface ShopAssetRow {
  r2_key: string
  mime: string
  bytes: number
}

export const selectShopAsset = async (tx: ScopedSql, storeId: string, id: string): Promise<ShopAssetRow | null> =>
  (await tx<ShopAssetRow[]>`select r2_key, mime, bytes from asset where id = ${id} and store_id = ${storeId}`)[0] ?? null

export interface ShopPricingRow {
  pricing_currency: string
  currencies: { currency: string; mode: 'manual' | 'convert'; rounding: 'none' | 'nearest' | 'ends-99' }[]
  rates: { currency: string; per_euro: string }[]
}

/** What prices are worked out from: the store's currencies and the reference rates (CATALOG facts 25–26). */
export const selectShopPricing = async (tx: ScopedSql, storeId: string): Promise<ShopPricingRow | null> =>
  (
    await tx<ShopPricingRow[]>`
      select s.pricing_currency::text as pricing_currency,
        coalesce((select json_agg(json_build_object('currency', c.currency, 'mode', c.mode, 'rounding', c.rounding)) from store_currency c where c.store_id = s.id), '[]'::json) as currencies,
        coalesce((select json_agg(json_build_object('currency', r.currency, 'per_euro', r.per_euro::text)) from exchange_rate r), '[]'::json) as rates
      from store s where s.id = ${storeId}
    `
  )[0] ?? null

export interface ShopMarketRow {
  id: string
  countries: string[]
  currency: string
  price_adjustment_bps: number
}

/** The shopper's market, or the store's primary one. */
export const selectShopMarket = async (tx: ScopedSql, storeId: string, marketId: string | null): Promise<ShopMarketRow | null> =>
  (
    await tx<ShopMarketRow[]>`
      select id, countries, currency::text as currency, price_adjustment_bps from market
      where store_id = ${storeId} and ${marketId ? tx`id = ${marketId}` : tx`is_primary`}
    `
  )[0] ?? null

export type ShopSort = 'newest' | 'price_low' | 'price_high' | 'name' | 'collection'

export interface ShopProductQuery {
  language: string
  market: ShopMarketRow
  /** The cart's currency, and whether a price in it can be worked out from the pricing currency's. */
  currency: string
  convertible: boolean
  pricingCurrency: string
  collectionId: string | null
  filterValueIds: readonly string[]
  search: string | null
}

export interface ShopSortWindow {
  limit: number
  after: { value: string; id: string } | null
  before: { value: string; id: string } | null
}

const shopSortOf = (tx: ScopedSql, sort: ShopSort, q: ShopProductQuery) => {
  const minPrice = tx`(select min(vp.amount) from version_price vp join product_version v on v.id = vp.version_id where v.product_id = p.id and vp.currency = ${q.pricingCurrency})`
  switch (sort) {
    case 'price_low':
      return { key: tx`coalesce(${minPrice}, 9223372036854775807)`, type: 'bigint', descending: false }
    case 'price_high':
      return { key: tx`coalesce(${minPrice}, -1)`, type: 'bigint', descending: true }
    case 'name':
      return { key: tx`lower(${translated(tx, 'product', tx`p.id`, 'name', tx`p.name`, q.language)})`, type: 'text', descending: false }
    case 'collection':
      return { key: tx`(select cp.position from collection_product cp where cp.collection_id = ${q.collectionId} and cp.product_id = p.id)`, type: 'int', descending: false }
    case 'newest':
      return { key: tx`p.created_at`, type: 'timestamptz', descending: true }
  }
}

/** Products the market sells: not left out of it, and some of its countries allowed by the product's own rule (fact 42). */
const soldIn = (tx: ScopedSql, market: ShopMarketRow) => {
  const countries = tx`${tx.json(market.countries)}::jsonb`
  return tx`
    not exists (select 1 from market_excluded_product e where e.market_id = ${market.id} and e.product_id = p.id)
    and not exists (
      select 1 from product_market_rule r where r.product_id = p.id
        and not exists (select 1 from jsonb_array_elements_text(${countries}) m where (r.mode = 'only') = (r.countries ? m))
    )
  `
}

/** The query's products without its filter choices: what a page lists and what its facets count. */
const matching = (tx: ScopedSql, storeId: string, q: ShopProductQuery) => tx`
  p.store_id = ${storeId} and ${soldIn(tx, q.market)}
  and exists (
    select 1 from product_version v join version_price vp on vp.version_id = v.id
    where v.product_id = p.id and (vp.currency = ${q.currency} or (${q.convertible} and vp.currency = ${q.pricingCurrency}))
  )
  and ${q.collectionId ? tx`exists (select 1 from collection_product cp where cp.collection_id = ${q.collectionId} and cp.product_id = p.id)` : tx`true`}
  and ${
    q.search
      ? tx`(p.search @@ plainto_tsquery('simple', ${q.search}) or ${translated(tx, 'product', tx`p.id`, 'name', tx`p.name`, q.language)} ilike ${`%${q.search.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%`})`
      : tx`true`
  }
`

/** Whether the market sells this product in the cart's currency, as a listing would include it. */
export const selectShopSellable = async (tx: ScopedSql, storeId: string, q: ShopProductQuery, productId: string): Promise<boolean> =>
  (await tx`select 1 from product p where p.id = ${productId} and ${matching(tx, storeId, q)}`).length > 0

/** Which of these products the listing would include, so related and compared products keep its rules. */
export const selectShopListed = async (tx: ScopedSql, storeId: string, q: ShopProductQuery, ids: readonly string[]): Promise<Set<string>> =>
  ids.length === 0 ? new Set() : new Set((await tx<{ id: string }[]>`select p.id from product p where p.id = any (${pgArray(ids)}::uuid[]) and ${matching(tx, storeId, q)}`).map((r) => r.id))

export interface ShopProductListRow {
  id: string
  sort_key: string
}

/** One page of the query's products in the sort's order; a filter's values are alternatives, filters all apply (CATALOG H4). */
export const selectShopProducts = (tx: ScopedSql, storeId: string, q: ShopProductQuery, sort: ShopSort, window: ShopSortWindow): Promise<ShopProductListRow[]> => {
  const order = shopSortOf(tx, sort, q)
  const backwards = window.before !== null && window.after === null
  const beyond = (key: { value: string; id: string }, forward: boolean) =>
    order.descending === forward ? tx`(sort_value, id) < (${key.value}::${tx.unsafe(order.type)}, ${key.id}::uuid)` : tx`(sort_value, id) > (${key.value}::${tx.unsafe(order.type)}, ${key.id}::uuid)`
  const direction = order.descending !== backwards ? tx`desc` : tx`asc`
  // A choice the shopper can't see (another store's) matches nothing, never everything.
  const values = q.filterValueIds
  return tx<ShopProductListRow[]>`
    with listed as (
      select p.id, ${order.key} as sort_value from product p
      where ${matching(tx, storeId, q)}
        and ${
          values.length === 0
            ? tx`true`
            : tx`(select count(*) from filter_value v where v.id = any (${pgArray(values)}::uuid[])) = ${values.length} and not exists (
                select 1 from filter_value chosen where chosen.id = any (${pgArray(values)}::uuid[])
                  and not exists (
                    select 1 from product_filter_value pf join filter_value x on x.id = pf.filter_value_id
                    where pf.product_id = p.id and x.filter_id = chosen.filter_id and x.id = any (${pgArray(values)}::uuid[])
                  )
              )`
        }
    )
    select id, sort_value::text as sort_key from listed
    where ${window.after ? beyond(window.after, true) : tx`true`} and ${window.before ? beyond(window.before, false) : tx`true`}
    order by sort_value ${direction}, id ${direction}
    limit ${window.limit + 1}
  `
}

export interface ShopFacetRow {
  id: string
  name: string
  values: { id: string; name: string; count: number }[]
}

/** The shopper-visible filters with how many of the query's products carry each value, before any choice narrows them. */
export const selectShopFacets = (tx: ScopedSql, storeId: string, q: ShopProductQuery): Promise<ShopFacetRow[]> =>
  tx<ShopFacetRow[]>`
    with listed as (select p.id from product p where ${matching(tx, storeId, q)})
    select f.id, ${translated(tx, 'filter', tx`f.id`, 'name', tx`f.name`, q.language)} as name,
      coalesce((
        select json_agg(json_build_object('id', v.id, 'name', ${translated(tx, 'filter_value', tx`v.id`, 'name', tx`v.name`, q.language)},
          'count', (select count(distinct pf.product_id) from product_filter_value pf join listed l on l.id = pf.product_id where pf.filter_value_id = v.id)) order by v.position)
        from (select v.id, v.name, v.position from filter_value v where v.filter_id = f.id order by v.position limit 100) v
      ), '[]'::json) as values
    from filter f where f.store_id = ${storeId}
    order by f.position
    limit 200
  `

export const selectShopProductId = async (tx: ScopedSql, storeId: string, language: string, slug: string): Promise<string | null> =>
  (
    await tx<{ id: string }[]>`
      select p.id from product p
      where p.store_id = ${storeId} and (p.slug = ${slug} or exists (
        select 1 from translation t where t.entity = 'product' and t.entity_id = p.id::text and t.field = 'slug' and t.language = ${language} and t.text = ${slug}
      ))
      order by (p.slug = ${slug}) desc limit 1
    `
  )[0]?.id ?? null

export interface ShopVersionRow {
  id: string
  name: string | null
  sku: string | null
  weight_grams: number | null
  track_stock: boolean
  continue_selling: boolean
  prices: { currency: string; amount: string; compare_at_amount: string | null }[]
  choices: { option_id: string; value_id: string }[]
}

export interface ShopProductRow {
  id: string
  name: string
  slug: string
  description: string
  product_type: string
  created_at: Date
  seo_title: string | null
  seo_description: string | null
  warranty_text: string | null
  returns_text: string | null
  size_chart_id: string | null
  versions: ShopVersionRow[]
  photos: { asset_id: string; alt: string | null; version_id: string | null }[]
  manual_badges: string[]
}

/** The products named, in no particular order: their versions with every price they carry, photos and hand-given badges. */
export const selectShopProductRows = (tx: ScopedSql, storeId: string, ids: readonly string[], language: string): Promise<ShopProductRow[]> =>
  tx<ShopProductRow[]>`
    select p.id, ${translated(tx, 'product', tx`p.id`, 'name', tx`p.name`, language)} as name,
      ${translated(tx, 'product', tx`p.id`, 'slug', tx`p.slug`, language)} as slug,
      ${translated(tx, 'product', tx`p.id`, 'description', tx`p.description`, language)} as description,
      p.product_type, p.created_at, p.seo_title, p.seo_description, p.warranty_text, p.returns_text, p.size_chart_id,
      coalesce((select json_agg(json_build_object('id', v.id, 'name', ${translated(tx, 'version', tx`v.id`, 'name', tx`v.name`, language)}, 'sku', v.sku,
          'weight_grams', v.weight_grams, 'track_stock', v.track_stock, 'continue_selling', v.continue_selling,
          'prices', coalesce((select json_agg(json_build_object('currency', vp.currency, 'amount', vp.amount::text, 'compare_at_amount', vp.compare_at_amount::text)) from version_price vp where vp.version_id = v.id), '[]'::json),
          'choices', coalesce((select json_agg(json_build_object('option_id', ov.option_id, 'value_id', ov.value_id)) from product_version_option_value ov where ov.version_id = v.id), '[]'::json)
        ) order by v.position, v.id) from product_version v where v.product_id = p.id), '[]'::json) as versions,
      coalesce((select json_agg(json_build_object('asset_id', ph.asset_id, 'alt', ph.alt, 'version_id', ph.version_id) order by ph.position) from product_photo ph where ph.product_id = p.id), '[]'::json) as photos,
      coalesce((select json_agg(pb.badge_id) from product_badge pb where pb.product_id = p.id), '[]'::json) as manual_badges
    from product p where p.store_id = ${storeId} and p.id = any (${pgArray(ids)}::uuid[])
  `

export interface ShopBadgeRow {
  id: string
  label: string
  tone: string
  rule: 'new_30_days' | 'top_5_this_month' | 'below_compare_price' | 'few_left' | 'manual'
}

export const selectShopBadges = (tx: ScopedSql, storeId: string): Promise<ShopBadgeRow[]> =>
  tx<ShopBadgeRow[]>`select id, label, tone, rule from badge where store_id = ${storeId} order by position, id`

export interface ShopStockRow {
  version_id: string
  available: number | null
  low: boolean
}

export const selectShopStock = (tx: ScopedSql, versionIds: readonly string[]): Promise<ShopStockRow[]> =>
  versionIds.length === 0 ? Promise.resolve([]) : tx<ShopStockRow[]>`select version_id, available, low from shop_stock(${pgArray(versionIds)}::uuid[])`

export interface ShopProductExtrasRow {
  options: { id: string; name: string; values: { id: string; name: string }[] }[]
  specs: { name: string; value: string; version_id: string | null }[]
  highlights: string[]
  faqs: { question: string; answer: string }[]
  related: string[]
  video: { asset_id: string | null; url: string | null } | null
  flags: { age_restricted: boolean; hazardous: boolean } | null
  compliance: { region: string; field: string; value: string }[]
  filters: { filter: string; value: string }[]
  size_chart: { name: string; unit: string; systems: string[]; measurements: string[]; rows: { size: string; values: string[] }[]; how_to_measure: { measurement: string; text: string }[]; fit_notes: string | null; model_info: string | null } | null
  story: { template: string | null; modules: unknown[] } | null
  blocks: { id: string; content: { title: string; body: string; photo: { assetId: string | null; alt: string | null } | null } }[]
}

/** A product page's sections, each only what shoppers see (migration 0064). */
export const selectShopProductExtras = async (tx: ScopedSql, productId: string, language: string): Promise<ShopProductExtrasRow | null> =>
  (
    await tx<ShopProductExtrasRow[]>`
      select
        coalesce((select json_agg(json_build_object('id', o.id, 'name', ${translated(tx, 'option_name', tx`lower(o.name)`, 'name', tx`o.name`, language)},
            'values', coalesce((select json_agg(json_build_object('id', v.id, 'name', ${translated(tx, 'choice_name', tx`lower(v.name)`, 'name', tx`v.name`, language)}) order by v.position) from product_option_value v where v.option_id = o.id), '[]'::json)
          ) order by o.position) from product_option o where o.product_id = p.id), '[]'::json) as options,
        coalesce((select json_agg(json_build_object('name', s.name, 'value', s.value, 'version_id', s.version_id) order by s.position) from product_spec s where s.product_id = p.id), '[]'::json) as specs,
        coalesce((select json_agg(h.text order by h.position) from product_highlight h where h.product_id = p.id), '[]'::json) as highlights,
        coalesce((select json_agg(json_build_object('question', f.question, 'answer', f.answer) order by f.position) from product_faq f where f.product_id = p.id), '[]'::json) as faqs,
        coalesce((select json_agg(r.related_product_id order by r.position) from product_related r where r.product_id = p.id), '[]'::json) as related,
        (select json_build_object('asset_id', v.asset_id, 'url', v.url) from product_video v where v.product_id = p.id) as video,
        (select json_build_object('age_restricted', f.age_restricted, 'hazardous', f.hazardous) from product_flag f where f.product_id = p.id) as flags,
        coalesce((select json_agg(json_build_object('region', c.region, 'field', c.field, 'value', c.value) order by c.region, c.field) from product_compliance c where c.product_id = p.id), '[]'::json) as compliance,
        coalesce((select json_agg(json_build_object('filter', ${translated(tx, 'filter', tx`f.id`, 'name', tx`f.name`, language)}, 'value', ${translated(tx, 'filter_value', tx`v.id`, 'name', tx`v.name`, language)}) order by f.position, v.position)
          from product_filter_value pf join filter_value v on v.id = pf.filter_value_id join filter f on f.id = v.filter_id where pf.product_id = p.id and pf.version_id is null), '[]'::json) as filters,
        (select json_build_object('name', c.name, 'unit', c.unit, 'systems', c.systems, 'measurements', c.measurements, 'rows', c.rows, 'how_to_measure', c.how_to_measure,
            'fit_notes', c.fit_notes, 'model_info', c.model_info) from size_chart c where c.id = p.size_chart_id) as size_chart,
        (select json_build_object('template', s.template, 'modules', s.live) from product_story s where s.product_id = p.id) as story,
        coalesce((select json_agg(json_build_object('id', b.id, 'content', b.content)) from story_block b
          where b.id in (select unnest(s.block_ids) from product_story s where s.product_id = p.id)), '[]'::json) as blocks
      from product p where p.id = ${productId}
    `
  )[0] ?? null
