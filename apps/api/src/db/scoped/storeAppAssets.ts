import type { ScopedSql } from './index'

// Settings › Mobile apps (mobile-app/README.md §3; DATA-MODEL §2.5's pattern, migration 0369): the store's apps' icon, splash and listing text.
// Append-only: the newest version is the live one, and no role may change or delete one.

export interface StoreAppAssetsRow {
  version: number
  app_icon_key: string | null
  app_icon_foreground_key: string | null
  splash_key: string | null
  app_name: string | null
  short_description: string | null
  long_description: string | null
  created_at: Date
}

export type StoreAppAssetsFields = Omit<StoreAppAssetsRow, 'version' | 'created_at'>

const columns = (tx: ScopedSql) => tx`version, app_icon_key, app_icon_foreground_key, splash_key, app_name, short_description, long_description, created_at`

/** Whether an upload of this file succeeded for the store: its entry is written in the transaction that stores the file, so one exists only for a file that passed its checks (saas/storeApps). */
export const appFileWasUploaded = async (tx: ScopedSql, storeId: string, key: string, action: string): Promise<boolean> =>
  (await tx`select 1 from activity_log where store_id = ${storeId} and action = ${action} and target_type = 'file' and target_id = ${key} limit 1`).length > 0

export const selectLatestAppAssets = async (tx: ScopedSql, storeId: string): Promise<StoreAppAssetsRow | null> =>
  (await tx<StoreAppAssetsRow[]>`select ${columns(tx)} from store_app_assets where store_id = ${storeId} order by version desc limit 1`)[0] ?? null

/** The next version, numbered here: callers hold the store's lock, and the unique index refuses two with one number. */
export const insertAppAssets = async (tx: ScopedSql, storeId: string, createdBy: string, fields: StoreAppAssetsFields): Promise<StoreAppAssetsRow> => {
  const [row] = await tx<StoreAppAssetsRow[]>`
    insert into store_app_assets (store_id, version, app_icon_key, app_icon_foreground_key, splash_key, app_name, short_description, long_description, created_by_user_id)
    values (
      ${storeId},
      (select coalesce(max(version), 0) + 1 from store_app_assets where store_id = ${storeId}),
      ${fields.app_icon_key}, ${fields.app_icon_foreground_key}, ${fields.splash_key}, ${fields.app_name}, ${fields.short_description}, ${fields.long_description}, ${createdBy}
    )
    returning ${columns(tx)}
  `
  if (!row) throw new Error('store apps: the insert returned no row')
  return row
}
