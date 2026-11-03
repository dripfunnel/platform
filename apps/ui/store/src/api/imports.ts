import { exportJobFields, exportJobSchema, readExportJob, type ExportJob } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'
import type { ProductQuery } from './products'

// Import and export (CATALOG K; FIRST-RELEASE §13; apps/api/schema/store.graphql, src/apis/store/catalogImports.ts,
// shopify.ts, catalogExports.ts): a file or a Shopify shop checked, then confirmed, run as a job; exports as jobs.

export const importStates = ['checking', 'ready', 'running', 'done', 'failed', 'unreadable'] as const
export type ImportState = (typeof importStates)[number]

const problemSchema = z.object({ line: z.number().int(), column: z.string().nullable(), code: z.string(), message: z.string(), file: z.string().nullable() })
export type ImportProblem = z.infer<typeof problemSchema>

const importSchema = z.object({
  id: z.string(),
  state: z.enum(importStates),
  source: z.enum(['csv', 'shopify']).nullable(),
  products: z.number().int(),
  ready: z.number().int(),
  matched: z.number().int(),
  done: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  photosPending: z.number().int(),
  problemCount: z.number().int(),
  /** The Shopify locations an inventory file gave counts for, to match to warehouses. */
  locations: z.array(z.string()),
  /** Set when the file's prices were converted to the store's pricing currency, at the rates of day `on`. */
  conversion: z.object({ from: z.string(), to: z.string(), on: z.string() }).nullable(),
  stockCounted: z.boolean(),
  problems: z.array(problemSchema),
  problemsCsv: z.string().nullable(),
})
export type CatalogImport = z.infer<typeof importSchema>

const importFields = 'id state source products ready matched done created updated skipped failed photosPending problemCount locations conversion { from to on } stockCounted problems { line column code message file } problemsCsv'

/** The largest file the API takes (FILE_TOO_LARGE), checked here first so a big file isn't sent at all. */
export const maxImportBytes = 5 * 1024 * 1024

export const loadImport = async (id: string): Promise<CatalogImport | null> =>
  (await query(`query I($id: ID!) { catalogImport(id: $id) { ${importFields} } }`, z.object({ catalogImport: importSchema.nullable() }), { id })).catalogImport

/** The caller's own recent imports, newest first: the shell finds a run still going here after a reload. */
export const loadImports = async (): Promise<CatalogImport[]> => (await query(`{ catalogImports { ${importFields} } }`, z.object({ catalogImports: z.array(importSchema).nullable() }))).catalogImports ?? []

/**
 * `source` is the option the file came from, so the server refuses the other kind; `inventory` is Shopify's inventory
 * file; `currency` is the one the file's prices are in when it isn't the store's pricing currency.
 */
export const startFileImport = async (file: string, source: 'csv' | 'shopify', inventory: string | null, currency: string | null): Promise<string> =>
  (
    await query(
      'mutation S($f: String!, $s: CatalogImportSource, $i: String, $c: String) { startCatalogImport(file: $f, source: $s, inventory: $i, currency: $c) }',
      z.object({ startCatalogImport: z.string() }),
      { f: file, s: source, i: inventory, c: currency },
    )
  ).startCatalogImport

/** The currencies a Shopify file's prices can be in: the store's pricing currency, and every other one with an exchange rate (the euro is always one). */
export const loadImportCurrencies = async (): Promise<{ pricing: string | null; others: string[] }> => {
  const { storeLocale } = await query(
    '{ storeLocale { pricingCurrency examples { currency } } }',
    z.object({ storeLocale: z.object({ pricingCurrency: z.string().nullable(), examples: z.array(z.object({ currency: z.string() })) }).nullable() }),
  )
  const pricing = storeLocale?.pricingCurrency ?? null
  return { pricing, others: pricing ? [...new Set(['EUR', ...(storeLocale?.examples ?? []).map((r) => r.currency)])].filter((c) => c !== pricing).sort() : [] }
}

export type LocationWarehouse = { location: string; warehouseId: string | null }

/** `locations` when the check found Shopify locations: each one's warehouse, or null to leave it out. */
export const confirmImport = async (id: string, matching: 'update' | 'skip', warehouseId: string | null, locations: LocationWarehouse[] | null = null): Promise<void> => {
  await query(
    'mutation C($id: ID!, $m: CatalogImportMatching!, $w: ID, $l: [CatalogImportLocationInput!]) { confirmCatalogImport(id: $id, matching: $m, warehouseId: $w, locations: $l) }',
    z.object({ confirmCatalogImport: z.boolean().nullable() }),
    { id, m: matching, w: warehouseId, l: locations },
  )
}

export const loadImportTemplate = async (): Promise<string> => (await query('{ catalogImportTemplate }', z.object({ catalogImportTemplate: z.string().nullable() }))).catalogImportTemplate ?? ''

const connectionSchema = z.object({ available: z.boolean(), status: z.enum(['none', 'pending', 'connected', 'expired']), shop: z.string().nullable() })
export type ShopifyConnection = z.infer<typeof connectionSchema>

export const loadShopifyConnection = async (): Promise<ShopifyConnection> =>
  (await query('{ shopifyConnection { available status shop } }', z.object({ shopifyConnection: connectionSchema }))).shopifyConnection

const shopProductSchema = z.object({ id: z.string(), title: z.string(), status: z.string(), versions: z.number().int(), imageUrl: z.string().nullable() })
export type ShopifyProduct = z.infer<typeof shopProductSchema>

export const loadShopifyProducts = async (after: string | null): Promise<{ nodes: ShopifyProduct[]; next: string | null }> =>
  (await query('query P($after: String) { shopifyProducts(after: $after) { nodes { id title status versions imageUrl } next } }', z.object({ shopifyProducts: z.object({ nodes: z.array(shopProductSchema), next: z.string().nullable() }) }), { after })).shopifyProducts

/** Shopify's address to approve the app on; the person comes back to /products/import with a one-time key. */
export const connectShopify = async (shop: string): Promise<string> => (await query('mutation C($s: String!) { connectShopify(shop: $s) }', z.object({ connectShopify: z.string() }), { s: shop })).connectShopify

export const finishShopifyConnect = async (key: string): Promise<string> => (await query('mutation F($k: String!) { finishShopifyConnect(key: $k) }', z.object({ finishShopifyConnect: z.string() }), { k: key })).finishShopifyConnect

/** Picked products, or every one (`null`). */
export const startShopifyImport = async (productIds: string[] | null): Promise<string> =>
  (await query('mutation S($ids: [ID!], $all: Boolean) { startShopifyImport(productIds: $ids, all: $all) }', z.object({ startShopifyImport: z.string() }), productIds ? { ids: productIds } : { all: true })).startShopifyImport

const catalogExportSchema = exportJobSchema.extend({ kind: z.enum(['products', 'stock']), requestedAt: z.string() })
export type CatalogExport = ExportJob & { kind: 'products' | 'stock'; requestedAt: string }

const readCatalogExport = (job: z.infer<typeof catalogExportSchema> | null): CatalogExport | null => {
  const read = readExportJob(job)
  return read && job ? { ...read, kind: job.kind, requestedAt: job.requestedAt } : null
}

export const loadCatalogExport = async (id: string): Promise<CatalogExport | null> =>
  readCatalogExport((await query(`query E($id: ID!) { catalogExport(id: $id) { ${exportJobFields} kind requestedAt } }`, z.object({ catalogExport: catalogExportSchema.nullable() }), { id })).catalogExport)

/** The caller's own recent exports, newest first. */
export const loadCatalogExports = async (): Promise<CatalogExport[]> =>
  ((await query(`{ catalogExports { ${exportJobFields} kind requestedAt } }`, z.object({ catalogExports: z.array(catalogExportSchema).nullable() }))).catalogExports ?? []).flatMap((job) => readCatalogExport(job) ?? [])

/** The caller's products as the list shows them: all, one filter, a search, a supplier. */
export const requestProductExport = async (filter: Partial<Pick<ProductQuery, 'filter' | 'search' | 'supplier'>> = {}): Promise<CatalogExport> => {
  const f = { ...(filter.filter && filter.filter !== 'all' ? { filter: filter.filter } : {}), ...(filter.search ? { search: filter.search } : {}), ...(filter.supplier ? { supplier: filter.supplier } : {}) }
  const { requestCatalogExport: id } = await query('mutation E($f: CatalogExportFilterInput) { requestCatalogExport(kind: products, filter: $f) }', z.object({ requestCatalogExport: z.string() }), { f })
  return { id, state: 'preparing', entries: null, url: null, expiresAt: null, kind: 'products', requestedAt: new Date().toISOString() }
}
