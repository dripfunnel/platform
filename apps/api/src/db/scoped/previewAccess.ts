import { pgArray, type ScopedSql } from './index'

// A preview host's store and whether a link's issuer may still open it (storefront PREVIEW.md §5 step 4), read in system
// scope before any tenant exists, as the Shop API's own preview lookup is (shopCaller.ts).

export interface PreviewStoreRow {
  store_id: string
  partner_id: string
  slug: string
  preview_epoch: number
  folder: string | null
}

/** The store a preview slug names, unless its partner or the store is closed. */
export const selectPreviewStore = async (tx: ScopedSql, slug: string): Promise<PreviewStoreRow | null> =>
  (
    await tx<PreviewStoreRow[]>`
      select f.store_id, s.partner_id, s.slug, f.preview_epoch, d.preview_deploy_ref as folder
      from storefront f join store s on s.id = f.store_id join partner p on p.id = s.partner_id
      left join design_draft d on d.store_id = f.store_id
      where lower(s.slug) = ${slug} and p.state <> 'closed' and s.status <> 'closed'`
  )[0] ?? null

/** The user still holds an active merchant seat in the store with one of these roles, and their account is active. */
export const holdsMerchantRole = async (tx: ScopedSql, userId: string, storeId: string, roles: readonly string[]): Promise<boolean> =>
  (
    await tx`
      select 1 from membership m join "user" u on u.id = m.user_id
      where m.user_id = ${userId} and m.store_id = ${storeId} and m.seller_id is null and m.status = 'active'
        and m.role_key = any(${pgArray(roles)}::text[]) and u.status = 'active'`
  ).length > 0

/** The store's slug and revocation number, for signing its preview link. */
export const selectPreviewKey = async (tx: ScopedSql, storeId: string): Promise<{ slug: string; preview_epoch: number } | null> =>
  (await tx<{ slug: string; preview_epoch: number }[]>`select s.slug, f.preview_epoch from storefront f join store s on s.id = f.store_id where f.store_id = ${storeId}`)[0] ?? null

export const movePreviewEpoch = async (tx: ScopedSql, storeId: string): Promise<boolean> =>
  (await tx`update storefront set preview_epoch = preview_epoch + 1 where store_id = ${storeId}`).count === 1
