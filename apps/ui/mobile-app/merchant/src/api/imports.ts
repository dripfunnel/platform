import { z } from 'zod'
import { typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { exportJobFields, exportJobSchema, readExportJob, type ExportJob } from './exportJob'

// Import and export on the Store API (FIRST-RELEASE.md §13; apps/api src/apis/store/catalogImports.ts, shopify.ts, catalogExports.ts):
// a CSV's text or a Shopify shop checked, then confirmed and run as a job; exports are jobs that answer with their CSV.

export const importStates = ['checking', 'ready', 'running', 'done', 'failed', 'unreadable'] as const
export type ImportState = (typeof importStates)[number]

const problemSchema = z.object({ line: z.number().int(), column: z.string().nullable(), code: z.string(), message: z.string() })
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
  problems: z.array(problemSchema),
  problemsCsv: z.string().nullable(),
})
export type CatalogImport = z.infer<typeof importSchema>

const importFields = 'id state source products ready matched done created updated skipped failed photosPending problemCount problems { line column code message } problemsCsv'

/** The largest file the API takes (FILE_TOO_LARGE), checked on the phone first so a big file isn't sent at all. */
export const maxImportBytes = 5 * 1024 * 1024

export const loadImport = async (client: ApiClient, id: string): Promise<CatalogImport | null> =>
  (await typedQuery(client)(`query Import($id: ID!) { catalogImport(id: $id) { ${importFields} } }`, z.object({ catalogImport: importSchema.nullable() }), { id })).catalogImport

/** The caller's own recent imports, newest first: a run still going is found here when the screen opens again. */
export const loadImports = async (client: ApiClient): Promise<CatalogImport[]> =>
  (await typedQuery(client)(`{ catalogImports { ${importFields} } }`, z.object({ catalogImports: z.array(importSchema).nullable() }))).catalogImports ?? []

/** The API takes the CSV's text itself, not a stored file. */
export const startFileImport = async (client: ApiClient, csv: string): Promise<string> =>
  (await typedQuery(client)('mutation StartImport($file: String!) { startCatalogImport(file: $file) }', z.object({ startCatalogImport: z.string() }), { file: csv })).startCatalogImport

export const confirmImport = async (client: ApiClient, id: string, matching: 'update' | 'skip', warehouseId: string | null): Promise<void> => {
  await typedQuery(client)(
    'mutation ConfirmImport($id: ID!, $matching: CatalogImportMatching!, $warehouse: ID) { confirmCatalogImport(id: $id, matching: $matching, warehouseId: $warehouse) }',
    z.object({ confirmCatalogImport: z.boolean().nullable() }),
    { id, matching, warehouse: warehouseId },
  )
}

export const loadImportTemplate = async (client: ApiClient): Promise<string> =>
  (await typedQuery(client)('{ catalogImportTemplate }', z.object({ catalogImportTemplate: z.string().nullable() }))).catalogImportTemplate ?? ''

const connectionSchema = z.object({ available: z.boolean(), status: z.enum(['none', 'pending', 'connected', 'expired']), shop: z.string().nullable() })
export type ShopifyConnection = z.infer<typeof connectionSchema>

export const loadShopifyConnection = async (client: ApiClient): Promise<ShopifyConnection> =>
  (await typedQuery(client)('{ shopifyConnection { available status shop } }', z.object({ shopifyConnection: connectionSchema }))).shopifyConnection

const shopProductSchema = z.object({ id: z.string(), title: z.string(), status: z.string(), versions: z.number().int(), imageUrl: z.string().nullable() })
export type ShopifyProduct = z.infer<typeof shopProductSchema>

export const loadShopifyProducts = async (client: ApiClient, after: string | null): Promise<{ nodes: ShopifyProduct[]; next: string | null }> =>
  (
    await typedQuery(client)(
      'query ShopifyProducts($after: String) { shopifyProducts(after: $after) { nodes { id title status versions imageUrl } next } }',
      z.object({ shopifyProducts: z.object({ nodes: z.array(shopProductSchema), next: z.string().nullable() }) }),
      { after },
    )
  ).shopifyProducts

/** Shopify's own address to approve the app on; the approval ends on the portal's page, which the phone's browser opens. */
export const connectShopify = async (client: ApiClient, shop: string): Promise<string> =>
  (await typedQuery(client)('mutation ConnectShopify($shop: String!) { connectShopify(shop: $shop) }', z.object({ connectShopify: z.string() }), { shop })).connectShopify

/** The picked products, or every one (`null`). */
export const startShopifyImport = async (client: ApiClient, productIds: string[] | null): Promise<string> =>
  (
    await typedQuery(client)(
      'mutation StartShopifyImport($ids: [ID!], $all: Boolean) { startShopifyImport(productIds: $ids, all: $all) }',
      z.object({ startShopifyImport: z.string() }),
      productIds ? { ids: productIds } : { all: true },
    )
  ).startShopifyImport

export type ExportKind = 'products' | 'stock'

const catalogExportSchema = exportJobSchema.extend({ kind: z.enum(['products', 'stock']), requestedAt: z.string() })
export type CatalogExport = ExportJob & { kind: ExportKind; requestedAt: string }

const readCatalogExport = (job: z.infer<typeof catalogExportSchema> | null): CatalogExport | null => {
  const read = readExportJob(job)
  return read && job ? { ...read, kind: job.kind, requestedAt: job.requestedAt } : null
}

export const loadCatalogExport = async (client: ApiClient, id: string): Promise<CatalogExport | null> =>
  readCatalogExport(
    (await typedQuery(client)(`query CatalogExport($id: ID!) { catalogExport(id: $id) { ${exportJobFields} kind requestedAt } }`, z.object({ catalogExport: catalogExportSchema.nullable() }), { id })).catalogExport,
  )

/** The caller's own recent exports, newest first. */
export const loadCatalogExports = async (client: ApiClient): Promise<CatalogExport[]> =>
  ((await typedQuery(client)(`{ catalogExports { ${exportJobFields} kind requestedAt } }`, z.object({ catalogExports: z.array(catalogExportSchema).nullable() }))).catalogExports ?? []).flatMap((job) => readCatalogExport(job) ?? [])

/** The caller's products or stock: the API serialises only what the caller's seat may read (a supplier's own rows). */
export const requestCatalogExport = async (client: ApiClient, kind: ExportKind): Promise<string> =>
  (await typedQuery(client)('mutation RequestExport($kind: CatalogExportKind!) { requestCatalogExport(kind: $kind) }', z.object({ requestCatalogExport: z.string() }), { kind })).requestCatalogExport
