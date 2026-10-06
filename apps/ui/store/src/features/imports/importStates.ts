import type { CatalogExport, CatalogImport, ShopifyProduct } from '../../api/imports'
import { liveImportApi, type ImportApi } from './importApi'
import type { FileError } from './ImportStart'

// Import & export's states under ?state= (ui/README.md §6), CatImport's own: start, fileError, checking, shopify,
// shopifyExpired, pick, check, running, done, stopped, readOnly and denied, each answered with samples, never the API.
export const importStates = ['start', 'fileError', 'checking', 'shopify', 'shopifyExpired', 'pick', 'check', 'running', 'done', 'stopped', 'readOnly', 'denied'] as const

export type ImportScreenState = (typeof importStates)[number]

export interface ImportSample {
  api: ImportApi
  mode: 'file' | 'shopify' | null
  picking: string | null
  job: CatalogImport | null
  run: CatalogImport | null
  fileError: FileError | null
  fileName: string
  checking: boolean
}

const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const job = (patch: Partial<CatalogImport>): CatalogImport => ({
  id: 'sample',
  state: 'ready',
  source: 'csv',
  products: 10,
  ready: 8,
  matched: 2,
  done: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  photosPending: 0,
  problemCount: 2,
  problems: harness
    ? [
        { line: 14, column: 'price', code: 'BAD_PRICE', message: 'Price is empty. Add a price so shoppers can buy this.' },
        { line: 22, column: 'barcode', code: 'BAD_NUMBER', message: 'The barcode’s last digit doesn’t check out — probably a typo.' },
      ]
    : [],
  problemsCsv: null,
  ...patch,
})

const shopProducts: ShopifyProduct[] = harness
  ? ['Organic Cotton Tee', 'Linen Camp Shirt', 'Ribbed Tank', 'Cotton Poplin Dress', 'Wool Scarf', 'Canvas Cap'].map((title, i) => ({ id: `gid://shopify/Product/${i + 1}`, title, status: i === 5 ? 'DRAFT' : 'ACTIVE', versions: i % 3 === 0 ? 4 : 1, imageUrl: null }))
  : []

const exportsSample: CatalogExport[] = harness ? [{ id: 'e1', state: 'ready', entries: 128, url: 'data:text/csv,', expiresAt: null, truncated: false, kind: 'products', requestedAt: '2026-10-06T09:12:00Z' }] : []

const never = <T>() => new Promise<T>(() => undefined)

const sampleApi = (state: ImportScreenState): ImportApi => ({
  ...liveImportApi,
  loadImport: async () => job({}),
  startFileImport: never,
  confirmImport: async () => undefined,
  loadImportTemplate: async () => 'handle,name,price\n',
  loadShopifyConnection: async () => ({ available: true, status: state === 'shopifyExpired' ? 'expired' : 'none', shop: null }),
  loadShopifyProducts: async () => ({ nodes: shopProducts, next: null }),
  connectShopify: never,
  finishShopifyConnect: never,
  startShopifyImport: never,
  loadCatalogExports: async () => exportsSample,
  requestProductExport: never,
  loadPlaces: async () => [
    { id: 'w1', name: 'Main location', isDefault: true, units: 0, revision: 1, address: null, supplierId: null },
    { id: 'w2', name: 'Shop floor', isDefault: false, units: 0, revision: 1, address: null, supplierId: null },
  ],
  loadProductCounts: async () => ({ all: 128, visible: 121, hidden: 7, pending: 0, sentBack: 0, lowStock: 0, missingInfo: 0, fromSuppliers: 0, outOfStock: 0 }),
})

export const importSample = (state: ImportScreenState | null): ImportSample | null => {
  if (!state) return null
  const base: ImportSample = { api: sampleApi(state), mode: null, picking: null, job: null, run: null, fileError: null, fileName: '', checking: false }
  switch (state) {
    case 'fileError':
      return { ...base, mode: 'file', fileError: { kind: 'type', name: 'product-photos.zip' } }
    case 'checking':
      return { ...base, mode: 'file', checking: true }
    case 'shopify':
    case 'shopifyExpired':
      return { ...base, mode: 'shopify' }
    case 'pick':
      return { ...base, mode: 'shopify', picking: 'kesari-threads.myshopify.com' }
    case 'check':
      return { ...base, mode: 'file', job: job({}), fileName: 'spring-range.csv' }
    case 'running':
      return { ...base, run: job({ state: 'running', done: 5 }) }
    case 'done':
      return { ...base, run: job({ state: 'done', done: 8, created: 6, updated: 2, photosPending: 1 }) }
    case 'stopped':
      return { ...base, run: job({ state: 'failed', problems: [{ line: 0, column: null, code: 'SHOPIFY_EXPIRED', message: 'Your Shopify connection has expired. Connect your shop again.' }] }) }
    default:
      return base
  }
}
