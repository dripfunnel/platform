import { pgArray, type ScopedSql } from './index'

// The store's product and stock exports as jobs (migrations/0058; FIRST-RELEASE §13): asked for, built after
// commit in the asker's own scope, read back by id. Row security keeps a supplier to its own jobs and rows.

/** The store's exports: products and stock (#301), orders (#310), customers (#312) and an offer's codes (#320), each a job read back by id. */
export type CatalogExportKind = 'products' | 'stock' | 'orders' | 'customers' | 'offer_codes'

export interface CatalogExportRow {
  id: string
  store_id: string
  seller_id: string | null
  kind: CatalogExportKind
  filter: Record<string, unknown>
  state: 'queued' | 'done' | 'failed'
  rows: number | null
  truncated: boolean
  csv: string | null
  requested_by_id: string
  requested_by_label: string
  created_at: Date
  finished_at: Date | null
  expires_at: Date | null
}

export const insertCatalogExport = async (
  tx: ScopedSql,
  e: { storeId: string; sellerId: string | null; kind: CatalogExportKind; filter: Record<string, unknown>; byId: string; byLabel: string },
): Promise<string> => {
  const id = crypto.randomUUID()
  await tx`
    insert into catalog_export (id, store_id, seller_id, kind, filter, requested_by_id, requested_by_label)
    values (${id}, ${e.storeId}, ${e.sellerId}, ${e.kind}, ${JSON.stringify(e.filter)}::text::jsonb, ${e.byId}, ${e.byLabel})
  `
  return id
}

export const selectCatalogExport = async (tx: ScopedSql, storeId: string, id: string): Promise<CatalogExportRow | null> =>
  (await tx<CatalogExportRow[]>`select * from catalog_export where id = ${id} and store_id = ${storeId}`)[0] ?? null

/** "Recent exports": the asker's own, newest first, without their files. */
export const selectCatalogExports = (tx: ScopedSql, storeId: string, requesterId: string, kinds: readonly CatalogExportKind[], limit: number): Promise<Omit<CatalogExportRow, 'csv'>[]> =>
  tx<Omit<CatalogExportRow, 'csv'>[]>`
    select id, store_id, seller_id, kind, filter, state, rows, truncated, requested_by_id, requested_by_label, created_at, finished_at, expires_at
    from catalog_export where store_id = ${storeId} and requested_by_id = ${requesterId} and kind = any (${pgArray([...kinds])}::text[])
    order by created_at desc, id desc limit ${limit}
  `

export const completeCatalogExport = async (tx: ScopedSql, id: string, r: { rows: number; truncated: boolean; csv: string; at: Date; expiresAt: Date }): Promise<void> => {
  await tx`
    update catalog_export set state = 'done', rows = ${r.rows}, truncated = ${r.truncated}, csv = ${r.csv}, finished_at = ${r.at}, expires_at = ${r.expiresAt}
    where id = ${id} and state = 'queued'
  `
}

export const failCatalogExport = async (tx: ScopedSql, id: string, at: Date, expiresAt: Date): Promise<void> => {
  await tx`update catalog_export set state = 'failed', finished_at = ${at}, expires_at = ${expiresAt} where id = ${id} and state = 'queued'`
}

/** Kept for its hour, and one never finished for a day at most (LOGGING §6), as the partner's exports are. */
export const deleteExpiredCatalogExports = async (tx: ScopedSql, now: Date): Promise<number> =>
  (await tx`delete from catalog_export where expires_at < ${now} or created_at < ${new Date(now.getTime() - 24 * 60 * 60 * 1000)} returning id`).length

/** A job whose outbox row the relay gave up on is failed, so the screen stops waiting (exportJobs.ts failDeadExports). */
export const failDeadCatalogExports = async (tx: ScopedSql, now: Date, expiresAt: Date): Promise<number> =>
  (
    await tx`
      update catalog_export set state = 'failed', finished_at = ${now}, expires_at = ${expiresAt}
      where state = 'queued' and id in (
        select (payload->>'jobId')::uuid from outbox where kind = 'export.catalog' and failed_at is not null
      )
      returning id
    `
  ).length

export interface ExportVersionRow {
  sku: string | null
  barcode: string | null
  name: string | null
  weight: number | null
  cost: string | null
  cost_currency: string | null
  values: string[] | null
  prices: { currency: string; amount: string; compare: string | null; source: string }[] | null
  stock: number
}

export interface ExportProductRow {
  id: string
  slug: string
  name: string
  description: string
  product_type: string
  visibility: 'visible' | 'hidden'
  options: string[] | null
  versions: ExportVersionRow[] | null
  translations: { language: string; field: 'name' | 'description'; text: string }[] | null
}

/**
 * Products as a spreadsheet row each version (in the order given): options, codes, prices in every currency,
 * the count in the product's owner's default location, and the product's translations.
 */
export const selectExportProducts = (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<ExportProductRow[]> =>
  ids.length === 0
    ? Promise.resolve([])
    : tx<ExportProductRow[]>`
        select p.id, p.slug, p.name, p.description, p.product_type, p.visibility,
          (select json_agg(o.name order by o.position) from product_option o where o.product_id = p.id) as options,
          (select json_agg(json_build_object(
              'sku', v.sku, 'barcode', v.barcode, 'name', v.name, 'weight', v.weight_grams, 'cost', v.cost_amount::text, 'cost_currency', v.cost_currency,
              'values', (select json_agg(ov.name order by o.position) from product_version_option_value pv
                join product_option o on o.id = pv.option_id join product_option_value ov on ov.id = pv.value_id where pv.version_id = v.id),
              'prices', (select json_agg(json_build_object('currency', vp.currency, 'amount', vp.amount::text, 'compare', vp.compare_at_amount::text, 'source', vp.source) order by vp.currency)
                from version_price vp where vp.version_id = v.id),
              'stock', (select coalesce(sum(s.on_hand), 0) from stock_level s join warehouse w on w.id = s.warehouse_id
                where s.version_id = v.id and w.is_default and w.deleted_at is null and w.seller_id is not distinct from p.seller_id)
            ) order by v.position, v.id) from product_version v where v.product_id = p.id and v.deleted_at is null) as versions,
          (select json_agg(json_build_object('language', t.language, 'field', t.field, 'text', t.text) order by t.language, t.field)
            from translation t where t.store_id = p.store_id and t.entity = 'product' and t.entity_id = p.id::text and t.field in ('name', 'description')) as translations
        from product p
        where p.id = any(${pgArray(ids)}::uuid[]) and p.store_id = ${storeId} and p.deleted_at is null
        order by array_position(${pgArray(ids)}::uuid[], p.id)
      `

export interface ExportStockRow {
  product: string
  version: string | null
  values: string[] | null
  sku: string | null
  warehouse: string
  on_hand: number
  reserved: number
}

/** Every count of these products' versions in every location the caller reads, product by product. */
export const selectExportStock = (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<ExportStockRow[]> =>
  ids.length === 0
    ? Promise.resolve([])
    : tx<ExportStockRow[]>`
        select p.name as product, v.name as version, v.sku, w.name as warehouse, s.on_hand, s.reserved,
          (select json_agg(ov.name order by o.position) from product_version_option_value pv
            join product_option o on o.id = pv.option_id join product_option_value ov on ov.id = pv.value_id where pv.version_id = v.id) as values
        from product p
        join product_version v on v.product_id = p.id and v.deleted_at is null
        join stock_level s on s.version_id = v.id
        join warehouse w on w.id = s.warehouse_id and w.deleted_at is null
        where p.id = any(${pgArray(ids)}::uuid[]) and p.store_id = ${storeId} and p.deleted_at is null
        order by array_position(${pgArray(ids)}::uuid[], p.id), v.position, v.id, w.is_default desc, w.name, w.id
      `
