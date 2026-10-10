import { pgArray, type ScopedSql } from './index'

// What a download, a service and a gift card hold beyond a physical item (migration 0110; CATALOG-DESIGN T14), on the
// product row and in its licence-key pool, which the merchant's people count and never read back.

export interface ProductKindRow {
  id: string
  name: string
  seller_id: string | null
  product_type: 'physical' | 'digital' | 'service' | 'gift_card'
  revision: number
  download_mode: 'file' | 'keys' | null
  download_asset_id: string | null
  download_mime: string | null
  download_bytes: number | null
  download_limit: number
  download_days: number
  service_duration: string | null
  service_location: string | null
  gift_card_expiry_months: number | null
  keys_left: number
  keys_sold: number
}

export const selectProductKind = async (tx: ScopedSql, storeId: string, productId: string): Promise<ProductKindRow | null> =>
  (
    await tx<ProductKindRow[]>`
      select p.id, p.name, p.seller_id, p.product_type, p.revision, p.download_mode, p.download_asset_id, a.mime as download_mime, a.bytes as download_bytes,
        p.download_limit, p.download_days, p.service_duration, p.service_location, p.gift_card_expiry_months,
        (select count(*) from licence_key k where k.product_id = p.id and k.order_line_id is null)::int as keys_left,
        (select count(*) from licence_key k where k.product_id = p.id and k.order_line_id is not null)::int as keys_sold
      from product p left join asset a on a.id = p.download_asset_id
      where p.id = ${productId} and p.store_id = ${storeId} and p.deleted_at is null
    `
  )[0] ?? null

/** A download's file: the merchant's own upload kept as `file`; null for anything else. */
export const selectDownloadFile = async (tx: ScopedSql, storeId: string, assetId: string): Promise<{ id: string } | null> =>
  (await tx<{ id: string }[]>`select id from asset where id = ${assetId} and store_id = ${storeId} and kind = 'file' and seller_id is null`)[0] ?? null

export interface KindFields {
  downloadMode: 'file' | 'keys' | null
  downloadAssetId: string | null
  downloadLimit: number
  downloadDays: number
  serviceDuration: string | null
  serviceLocation: string | null
  giftCardExpiryMonths: number | null
}

/** Only at the revision the editor read (CATALOG E4); false when it was stale or isn't here. */
export const updateProductKind = async (tx: ScopedSql, storeId: string, productId: string, revision: number, f: KindFields, now: Date): Promise<boolean> =>
  (
    await tx`
      update product set download_mode = ${f.downloadMode}, download_asset_id = ${f.downloadAssetId}, download_limit = ${f.downloadLimit},
        download_days = ${f.downloadDays}, service_duration = ${f.serviceDuration}, service_location = ${f.serviceLocation},
        gift_card_expiry_months = ${f.giftCardExpiryMonths}, updated_at = ${now}, revision = revision + 1
      where id = ${productId} and store_id = ${storeId} and revision = ${revision} and deleted_at is null
    `
  ).count === 1

/** How many of the keys were new: one already in the pool is skipped, never told apart from a new one to anyone else. */
export const insertLicenceKeys = async (tx: ScopedSql, storeId: string, productId: string, keys: readonly string[], createdBy: string): Promise<number> =>
  (
    await tx`
      insert into licence_key (store_id, product_id, key, created_by)
      select ${storeId}, ${productId}, k, ${createdBy} from unnest(${pgArray(keys)}::text[]) as k
      on conflict do nothing
    `
  ).count
