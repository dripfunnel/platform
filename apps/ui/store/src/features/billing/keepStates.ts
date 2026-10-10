import type { PlanKeep } from '../../api/billing'
import type { ProductRow } from '../../api/products'

// Choose what to keep's states under ?state= (ui/README.md §6): loading, error, trial, current, nothing, readOnly, denied.
export const keepStates = ['loading', 'error', 'trial', 'current', 'nothing', 'readOnly', 'denied'] as const
export type KeepState = (typeof keepStates)[number]

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const names = harness
  ? ['Banarasi silk saree', 'Block-print kurta', 'Chanderi dupatta', 'Handloom stole', 'Ikat cushion cover', 'Kantha throw', 'Linen table runner', 'Madhubani wall art', 'Mulmul nightsuit', 'Phulkari jacket', 'Silk pocket square', 'Tussar silk scarf']
  : []

const row = (name: string, i: number): ProductRow => ({
  id: `p${i + 1}`,
  name,
  visible: i < 10,
  approval: null,
  productType: 'physical',
  supplier: i === 4 ? { id: 's1', name: 'Northwind Textiles' } : null,
  supplierRemoved: false,
  versionCount: 1,
  minPrice: null,
  maxPrice: null,
  photoUrl: null,
  stock: 5,
  lowStock: false,
  readiness: null,
})

export interface KeepSample {
  keep: PlanKeep | null
  rows: ProductRow[]
}

/** The sample for a state, or null for one drawn without data (loading, error, denied). */
export const keepSample = (state: KeepState | null): KeepSample | null => {
  if (!harness || !state) return null
  const rows = names.map(row)
  const keep: PlanKeep = { plan: { id: 'free', name: 'Free' }, limit: 10, from: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), products: rows.length, paused: 2, kept: rows.slice(0, 10).map((r) => r.id), waiting: ['p3'] }
  switch (state) {
    case 'trial':
    case 'readOnly':
      return { keep, rows }
    case 'current':
      return { keep: { ...keep, from: null }, rows }
    case 'nothing':
      return { keep: null, rows }
    default:
      return null
  }
}
