import type { PageWindow } from '#core/paging'
import type { ScopedSql } from './index'

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
  created_at: Date
}

const collectionColumns = (tx: ScopedSql, language: string) => tx`
  c.id, ${translated(tx, 'collection', tx`c.id`, 'name', tx`c.name`, language)} as name,
  ${translated(tx, 'collection', tx`c.id`, 'slug', tx`c.slug`, language)} as slug,
  ${translated(tx, 'collection', tx`c.id`, 'description', tx`c.description`, language)} as description,
  c.image_asset_id, c.parent_id, c.seo_title, c.seo_description, c.created_at
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
