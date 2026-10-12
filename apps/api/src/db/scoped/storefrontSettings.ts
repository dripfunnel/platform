import type postgres from 'postgres'
import type { CustomDomainRow } from '#db/schema/saas'
import { pgArray, type ScopedSql } from './index'
import type { StoreAddress } from './storeInfo'

// Storefront › Site settings (migration 0290; DATA-MODEL §7.8): the brand and the home page's search and sharing, read
// and written on the merchant side of the store in `tx`.

export interface BrandRow {
  shop_name: string
  logo_asset_id: string | null
  favicon_asset_id: string | null
  primary_colour: string | null
  secondary_colour: string | null
  tagline: string | null
  description: string | null
  social: Record<string, string>
  // Store info's own until the brand is saved with its own (FIRST-RELEASE §14).
  contact_email: string | null
  contact_phone: string | null
  contact_address: Partial<StoreAddress>
  voice: string | null
  saved: boolean
}

export const selectBrand = async (tx: ScopedSql, storeId: string): Promise<BrandRow | null> =>
  (
    await tx<BrandRow[]>`
      select s.name as shop_name, b.logo_asset_id, b.favicon_asset_id, b.primary_colour, b.secondary_colour, b.tagline, b.description,
        coalesce(b.social, '{}') as social, case when b.store_id is null then s.contact_email else b.contact_email end as contact_email,
        case when b.store_id is null then s.contact_phone else b.contact_phone end as contact_phone,
        case when b.store_id is null then s.address else coalesce(b.contact_address, '{}') end as contact_address,
        b.voice, b.store_id is not null as saved
      from store s left join storefront_brand b on b.store_id = s.id
      where s.id = ${storeId}`
  )[0] ?? null

export interface BrandWrite {
  logoAssetId: string
  faviconAssetId: string | null
  primaryColour: string | null
  secondaryColour: string | null
  tagline: string | null
  description: string | null
  social: Record<string, string>
  contactEmail: string | null
  contactPhone: string | null
  contactAddress: StoreAddress | null
  voice: string | null
}

export const upsertBrand = async (tx: ScopedSql, storeId: string, b: BrandWrite, at: Date): Promise<void> => {
  const row = {
    store_id: storeId,
    logo_asset_id: b.logoAssetId,
    favicon_asset_id: b.faviconAssetId,
    primary_colour: b.primaryColour,
    secondary_colour: b.secondaryColour,
    tagline: b.tagline,
    description: b.description,
    social: tx.json(b.social),
    contact_email: b.contactEmail,
    contact_phone: b.contactPhone,
    contact_address: b.contactAddress ? tx.json(b.contactAddress as unknown as postgres.JSONValue) : null,
    voice: b.voice,
    updated_at: at,
  }
  await tx`
    insert into storefront_brand ${tx(row)}
    on conflict (store_id) do update set logo_asset_id = excluded.logo_asset_id, favicon_asset_id = excluded.favicon_asset_id,
      primary_colour = excluded.primary_colour, secondary_colour = excluded.secondary_colour, tagline = excluded.tagline,
      description = excluded.description, social = excluded.social, contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone, contact_address = excluded.contact_address, voice = excluded.voice, updated_at = excluded.updated_at`
}

/** Through 0290's definer: the brand step's shop name is Store info's own column. */
export const saveStoreName = async (tx: ScopedSql, name: string): Promise<void> => {
  await tx`select save_store_name(${name})`
}

/** One of the store's own images on its merchant side, never a supplier's or another store's (DATA-MODEL §7.8). */
export const isMerchantImage = async (tx: ScopedSql, storeId: string, assetId: string): Promise<boolean> =>
  (await tx`select 1 from asset where id = ${assetId} and store_id = ${storeId} and seller_id is null and kind = 'image'`).length > 0

export interface SeoRow {
  title: string | null
  description: string | null
  share_asset_id: string | null
}

export const selectSeo = async (tx: ScopedSql, storeId: string): Promise<SeoRow> =>
  (await tx<SeoRow[]>`select title, description, share_asset_id from storefront_seo where store_id = ${storeId}`)[0] ?? { title: null, description: null, share_asset_id: null }

export const upsertSeo = async (tx: ScopedSql, storeId: string, s: { title: string | null; description: string | null; shareAssetId: string | null }, at: Date): Promise<void> => {
  await tx`
    insert into storefront_seo (store_id, title, description, share_asset_id, updated_at) values (${storeId}, ${s.title}, ${s.description}, ${s.shareAssetId}, ${at})
    on conflict (store_id) do update set title = excluded.title, description = excluded.description, share_asset_id = excluded.share_asset_id, updated_at = excluded.updated_at`
}

/** The share image is one of the store's product photos (SAAS §9.2). */
export const isProductPhoto = async (tx: ScopedSql, storeId: string, assetId: string): Promise<boolean> =>
  (await tx`select 1 from product_photo where asset_id = ${assetId} and store_id = ${storeId} limit 1`).length > 0

/** The home page in every language the store offers: `/` in the main one, `/{language}/` in each other (ARCHITECTURE §8). */
export const selectHomePaths = async (tx: ScopedSql, storeId: string): Promise<string[]> =>
  (
    await tx<{ path: string }[]>`
      select '/' as path
      union all
      select '/' || lower(l.language) || '/' from store_language l join store s on s.id = l.store_id
      where l.store_id = ${storeId} and l.status = 'active' and l.language <> s.main_language`
  ).map((r) => r.path)

/** 0287's single-page render, queued after commit and only once the store has a live build (LIVE-SHOP §7). */
export const queuePageRender = async (tx: ScopedSql, storeId: string, pages: readonly string[]): Promise<void> => {
  await tx`select storefront_render_queue(${storeId}, ${pgArray(pages)}::text[], '{}'::text[])`
}

// Site settings › Domains (migration 0291; SAAS §8): the store's own domain on `custom_domain`, merchant side.

export const selectStoreDomains = (tx: ScopedSql, storeId: string): Promise<CustomDomainRow[]> =>
  tx<CustomDomainRow[]>`select * from custom_domain where store_id = ${storeId} order by created_at, id limit 10`

export const selectStoreDomainForUpdate = async (tx: ScopedSql, storeId: string, id: string): Promise<CustomDomainRow | null> =>
  (await tx<CustomDomainRow[]>`select * from custom_domain where id = ${id} and store_id = ${storeId} for update`)[0] ?? null

/** Another store's domain, or a partner's address or a name under one (0291's definer). */
export const merchantHostTaken = async (tx: ScopedSql, host: string): Promise<boolean> =>
  (await tx<{ taken: boolean }[]>`select merchant_host_taken(${host}) as taken`)[0]?.taken ?? true

/** Null makes the free address primary again. */
export const setPrimaryDomain = async (tx: ScopedSql, storeId: string, id: string | null): Promise<void> => {
  await tx`update custom_domain set is_primary = (id = ${id}) is true where store_id = ${storeId} and is_primary is distinct from ((id = ${id}) is true)`
}

export const deleteStoreDomain = async (tx: ScopedSql, storeId: string, id: string): Promise<void> => {
  await tx`delete from custom_domain where id = ${id} and store_id = ${storeId}`
}
