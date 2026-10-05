import { pgArray, type ScopedSql } from './index'

// The store's catalogue imports as jobs (migrations/0059; FIRST-RELEASE §13): uploaded, checked, confirmed, run a
// chunk at a time in the importer's own scope. Row security keeps a supplier to its own imports.

export type CatalogImportState = 'checking' | 'ready' | 'running' | 'done' | 'failed'

export interface CatalogImportRow {
  id: string
  store_id: string
  seller_id: string | null
  source: 'csv' | 'shopify'
  state: CatalogImportState
  file: string | null
  plan: unknown
  match_mode: 'update' | 'skip' | null
  warehouse_id: string | null
  products: number
  ready: number
  matched: number
  problems: unknown
  done: number
  created: number
  updated: number
  skipped: number
  failed: number
  photos_pending: number
  problems_csv: string | null
  requested_by_id: string
  requested_by_label: string
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
  expires_at: Date | null
}

export type CatalogImportSummary = Omit<CatalogImportRow, 'file' | 'plan' | 'problems' | 'problems_csv'>

const summary = (tx: ScopedSql) =>
  tx`id, store_id, seller_id, source, state, match_mode, warehouse_id, products, ready, matched, done, created, updated, skipped, failed, photos_pending,
    requested_by_id, requested_by_label, created_at, started_at, finished_at, expires_at`

export const insertCatalogImport = async (tx: ScopedSql, i: { storeId: string; sellerId: string | null; source: 'csv' | 'shopify'; file: string; byId: string; byLabel: string }): Promise<string> => {
  const id = crypto.randomUUID()
  await tx`
    insert into catalog_import (id, store_id, seller_id, source, file, requested_by_id, requested_by_label)
    values (${id}, ${i.storeId}, ${i.sellerId}, ${i.source}, ${i.file}, ${i.byId}, ${i.byLabel})
  `
  return id
}

export const selectCatalogImport = async (tx: ScopedSql, storeId: string, id: string): Promise<CatalogImportRow | null> =>
  (await tx<CatalogImportRow[]>`select * from catalog_import where id = ${id} and store_id = ${storeId}`)[0] ?? null

/** The row held to the end of the transaction, so a run's chunk and its photos never finish it twice. */
export const lockCatalogImport = async (tx: ScopedSql, storeId: string, id: string): Promise<CatalogImportRow | null> =>
  (await tx<CatalogImportRow[]>`select * from catalog_import where id = ${id} and store_id = ${storeId} for update`)[0] ?? null

export const selectCatalogImports = (tx: ScopedSql, storeId: string, requesterId: string, limit: number): Promise<CatalogImportSummary[]> =>
  tx<CatalogImportSummary[]>`
    select ${summary(tx)} from catalog_import where store_id = ${storeId} and requested_by_id = ${requesterId}
    order by created_at desc, id desc limit ${limit}
  `

export const saveImportCheck = async (
  tx: ScopedSql,
  id: string,
  c: { source: 'csv' | 'shopify'; plan: unknown; products: number; ready: number; matched: number; problems: unknown },
): Promise<void> => {
  await tx`
    update catalog_import set state = 'ready', source = ${c.source}, plan = ${JSON.stringify(c.plan)}::text::jsonb, products = ${c.products},
      ready = ${c.ready}, matched = ${c.matched}, problems = ${JSON.stringify(c.problems)}::text::jsonb
    where id = ${id} and state = 'checking'
  `
}

/** False when it isn't ready any more: confirmed twice, or failed meanwhile. */
export const startImportRun = async (tx: ScopedSql, id: string, r: { matchMode: 'update' | 'skip'; warehouseId: string | null; at: Date }): Promise<boolean> =>
  (await tx`update catalog_import set state = 'running', match_mode = ${r.matchMode}, warehouse_id = ${r.warehouseId}, started_at = ${r.at} where id = ${id} and state = 'ready' returning id`).length === 1

export const saveImportProgress = async (
  tx: ScopedSql,
  id: string,
  p: { done: number; created: number; updated: number; skipped: number; failed: number; photos: number; problems: unknown[] },
): Promise<void> => {
  await tx`
    update catalog_import set done = ${p.done}, created = created + ${p.created}, updated = updated + ${p.updated}, skipped = skipped + ${p.skipped},
      failed = failed + ${p.failed}, photos_pending = photos_pending + ${p.photos}, problems = problems || ${JSON.stringify(p.problems)}::text::jsonb
    where id = ${id} and state = 'running'
  `
}

export const saveImportPhotos = async (tx: ScopedSql, id: string, problems: unknown[]): Promise<void> => {
  await tx`
    update catalog_import set photos_pending = greatest(photos_pending - 1, 0), problems = problems || ${JSON.stringify(problems)}::text::jsonb
    where id = ${id} and state = 'running'
  `
}

export const finishImport = async (tx: ScopedSql, id: string, f: { problemsCsv: string | null; at: Date; expiresAt: Date }): Promise<void> => {
  await tx`
    update catalog_import set state = 'done', file = null, plan = null, problems_csv = ${f.problemsCsv}, finished_at = ${f.at}, expires_at = ${f.expiresAt}
    where id = ${id} and state = 'running'
  `
}

export const failImport = async (tx: ScopedSql, id: string, at: Date, expiresAt: Date): Promise<void> => {
  await tx`
    update catalog_import set state = 'failed', file = null, plan = null, finished_at = ${at}, expires_at = ${expiresAt}
    where id = ${id} and state in ('checking', 'ready', 'running')
  `
}

/** Ended ones after their day; one never confirmed after a day too, with its file. */
export const deleteExpiredImports = async (tx: ScopedSql, now: Date): Promise<number> =>
  (await tx`delete from catalog_import where expires_at < ${now} or (state in ('checking', 'ready') and created_at < ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}) returning id`).length

/** A job whose outbox row the relay gave up on is failed, so the banner stops waiting (catalogExports.ts). */
export const failDeadImports = async (tx: ScopedSql, now: Date, expiresAt: Date): Promise<number> =>
  (
    await tx`
      update catalog_import set state = 'failed', file = null, plan = null, finished_at = ${now}, expires_at = ${expiresAt}
      where state in ('checking', 'running') and id in (
        select (payload->>'jobId')::uuid from outbox where kind in ('import.catalog', 'import.photos') and failed_at is not null
      )
      returning id
    `
  ).length

/** The caller's own products holding these SKUs (K4): an import matches only what its importer owns. */
export const selectOwnSkus = (tx: ScopedSql, storeId: string, sellerId: string | null, skus: readonly string[]): Promise<{ sku: string; product_id: string }[]> =>
  skus.length === 0
    ? Promise.resolve([])
    : tx<{ sku: string; product_id: string }[]>`
        select lower(v.sku) as sku, v.product_id from product_version v join product p on p.id = v.product_id
        where v.store_id = ${storeId} and v.deleted_at is null and p.deleted_at is null and p.seller_id is not distinct from ${sellerId}
          and lower(v.sku) = any(${pgArray(skus.map((s) => s.toLowerCase()))}::text[])
      `

/** The importer's own default location, where imported counts go unless it chose another (K5). */
export const selectOwnDefaultWarehouse = async (tx: ScopedSql, storeId: string, sellerId: string | null): Promise<string | null> =>
  (await tx<{ id: string }[]>`select id from warehouse where store_id = ${storeId} and seller_id is not distinct from ${sellerId} and is_default and deleted_at is null`)[0]?.id ?? null

/** The importer's own live location by id, or null. */
export const selectOwnWarehouse = async (tx: ScopedSql, storeId: string, sellerId: string | null, id: string): Promise<string | null> =>
  (await tx<{ id: string }[]>`select id from warehouse where id = ${id} and store_id = ${storeId} and seller_id is not distinct from ${sellerId} and deleted_at is null`)[0]?.id ?? null

/** Currencies the store prices by hand (CATALOG K11); converted ones are never imported. */
export const selectManualCurrencies = async (tx: ScopedSql, storeId: string): Promise<string[]> =>
  (await tx<{ currency: string }[]>`select trim(currency) as currency from store_currency where store_id = ${storeId} and mode = 'manual' and status = 'active' order by position`).map((r) => r.currency)
