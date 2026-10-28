import type { ScopedSql } from './index'

// A store's delivery app APK (api/DELIVERY.md §5, migration 0371). Append-only: the newest version is the live one.

export interface StoreDeliveryAppRow {
  version: number
  apk_key: string
  version_name: string
  build_number: number
  /** A `bigint`, which the driver answers as text. */
  size_bytes: string
  minimum_build: number | null
  created_at: Date
}

export type StoreDeliveryAppFields = Omit<StoreDeliveryAppRow, 'version' | 'created_at'>

const columns = (tx: ScopedSql) => tx`version, apk_key, version_name, build_number, size_bytes, minimum_build, created_at`

export const selectLatestDeliveryApp = async (tx: ScopedSql, storeId: string): Promise<StoreDeliveryAppRow | null> =>
  (await tx<StoreDeliveryAppRow[]>`select ${columns(tx)} from store_delivery_app where store_id = ${storeId} order by version desc limit 1`)[0] ?? null

/** The next version, numbered here: callers hold the store's lock, and the unique index refuses two with one number. */
export const insertDeliveryApp = async (tx: ScopedSql, storeId: string, staffId: string, fields: StoreDeliveryAppFields): Promise<StoreDeliveryAppRow> => {
  const [row] = await tx<StoreDeliveryAppRow[]>`
    insert into store_delivery_app (store_id, version, apk_key, version_name, build_number, size_bytes, minimum_build, created_by_staff_id)
    values (
      ${storeId},
      (select coalesce(max(version), 0) + 1 from store_delivery_app where store_id = ${storeId}),
      ${fields.apk_key}, ${fields.version_name}, ${fields.build_number}, ${fields.size_bytes}, ${fields.minimum_build}, ${staffId}
    )
    returning ${columns(tx)}
  `
  if (!row) throw new Error('delivery app: the insert returned no row')
  return row
}
