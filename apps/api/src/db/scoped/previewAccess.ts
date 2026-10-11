import { pgArray, type ScopedSql } from './index'

// A preview host's store and whether a link's issuer may still open it (storefront PREVIEW.md §5 step 4), read in system
// scope before any tenant exists, as the Shop API's own preview lookup is (shopCaller.ts).

export interface PreviewStoreRow {
  store_id: string
  partner_id: string
  preview_key: string
  preview_epoch: number
  folder: string | null
}

/** The store a preview key names, unless its partner or the store is closed. */
export const selectPreviewStore = async (tx: ScopedSql, previewKey: string): Promise<PreviewStoreRow | null> =>
  (
    await tx<PreviewStoreRow[]>`
      select f.store_id, s.partner_id, f.preview_key, f.preview_epoch, d.preview_deploy_ref as folder
      from storefront f join store s on s.id = f.store_id join partner p on p.id = s.partner_id
      left join design_draft d on d.store_id = f.store_id
      where f.preview_key = ${previewKey} and p.state <> 'closed' and s.status <> 'closed'`
  )[0] ?? null

/** The user still holds an active merchant seat in the store with one of these roles, and their account is active. */
export const holdsMerchantRole = async (tx: ScopedSql, userId: string, storeId: string, roles: readonly string[]): Promise<boolean> =>
  (
    await tx`
      select 1 from membership m join "user" u on u.id = m.user_id
      where m.user_id = ${userId} and m.store_id = ${storeId} and m.seller_id is null and m.status = 'active'
        and m.role_key = any(${pgArray(roles)}::text[]) and u.status = 'active'`
  ).length > 0

/** The store's preview key and revocation number, for signing its link. */
export const selectPreviewKey = async (tx: ScopedSql, storeId: string): Promise<{ preview_key: string; preview_epoch: number } | null> =>
  (await tx<{ preview_key: string; preview_epoch: number }[]>`select preview_key, preview_epoch from storefront where store_id = ${storeId}`)[0] ?? null
