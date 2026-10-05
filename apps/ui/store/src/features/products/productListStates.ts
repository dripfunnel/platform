import type { ProductCounts, ProductRow } from '../../api/products'

// The Products list's states under ?state= (ui/README.md §6): loading, error, empty (a new store's first
// product), list, waiting (supplier products to approve), noResults, readOnly, staff, supplier, supplierEmpty.
export const productListStates = ['loading', 'error', 'empty', 'list', 'waiting', 'noResults', 'readOnly', 'staff', 'supplier', 'supplierEmpty'] as const

export type ProductListState = (typeof productListStates)[number]

export interface ProductListSample {
  rows: ProductRow[]
  counts: ProductCounts
  suppliers: { id: string; name: string }[]
}

const inr = (amount: string) => ({ amount, currency: 'INR' })
const ready = (missing: string[] = []) => [{ marketName: 'India', ready: missing.length === 0, missing }]
const row = (r: Partial<ProductRow> & Pick<ProductRow, 'id' | 'name'>): ProductRow => ({
  visible: true,
  approval: null,
  productType: 'physical',
  supplier: null,
  supplierRemoved: false,
  versionCount: 1,
  minPrice: inr('129900'),
  maxPrice: inr('129900'),
  photoUrl: null,
  stock: 24,
  lowStock: false,
  readiness: ready(),
  ...r,
})

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const rows: ProductRow[] =
  import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'
    ? [
        row({ id: 's1', name: 'Mara Linen Shirt', versionCount: 6, minPrice: inr('249900'), maxPrice: inr('279900'), stock: 41 }),
        row({ id: 's2', name: 'Block-print Cushion Cover', stock: 3, lowStock: true, readiness: ready(['compare']) }),
        row({ id: 's3', name: 'Indigo Table Runner', visible: false, stock: 0 }),
        row({ id: 's4', name: 'Handloom Cotton Dupatta', supplier: { id: 'v1', name: 'Northwind Textiles' }, approval: 'pending', visible: false, readiness: ready(['origin']) }),
        row({ id: 's5', name: 'Sanganer Print Tote', supplier: { id: 'v2', name: 'Sanganer Prints' }, approval: 'sent_back', visible: false }),
        row({ id: 's6', name: 'Gift card', productType: 'gift_card', minPrice: inr('100000'), maxPrice: inr('500000'), versionCount: 3, stock: 0 }),
        row({ id: 's7', name: 'Brass Diya Set', supplier: { id: 'v3', name: 'Moradabad Brass' }, supplierRemoved: true, visible: false }),
      ]
    : []

const counts = (list: ProductRow[]): ProductCounts => ({
  all: list.length,
  visible: list.filter((r) => r.visible).length,
  hidden: list.filter((r) => !r.visible).length,
  pending: list.filter((r) => r.approval === 'pending').length,
  sentBack: list.filter((r) => r.approval === 'sent_back').length,
  lowStock: list.filter((r) => r.lowStock).length,
  missingInfo: list.filter((r) => !r.photoUrl).length,
  fromSuppliers: list.filter((r) => r.supplier).length,
  outOfStock: list.filter((r) => r.productType === 'physical' && r.stock <= 0).length,
})

const suppliers = [
  { id: 'v1', name: 'Northwind Textiles' },
  { id: 'v2', name: 'Sanganer Prints' },
]

export const productListSample = (state: ProductListState | null): ProductListSample | null => {
  if (rows.length === 0 || !state || state === 'loading' || state === 'error') return null
  switch (state) {
    case 'empty':
    case 'supplierEmpty':
      return { rows: [], counts: counts([]), suppliers }
    case 'noResults':
      return { rows: [], counts: counts(rows), suppliers }
    case 'supplier': {
      const own = rows.filter((r) => r.supplier?.id === 'v1').map((r) => ({ ...r, readiness: null }))
      return { rows: own, counts: counts(own), suppliers: [] }
    }
    case 'waiting':
      return { rows: rows.filter((r) => r.approval === 'pending'), counts: counts(rows), suppliers }
    default:
      return { rows, counts: counts(rows), suppliers }
  }
}
