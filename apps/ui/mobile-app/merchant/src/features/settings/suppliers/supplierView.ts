import type { Supplier } from '../../../api/settingsPeople'

export type SupplierFilter = 'all' | 'active' | 'invited' | 'suspended'

/** How many companies are in each state: active ones have signed up, invited ones have not yet, suspended ones are held. */
export const supplierCounts = (suppliers: readonly Supplier[]): { active: number; invited: number; suspended: number } => ({
  active: suppliers.filter((supplier) => supplier.status === 'active').length,
  invited: suppliers.filter((supplier) => supplier.status === 'invited').length,
  suspended: suppliers.filter((supplier) => supplier.status === 'suspended').length,
})

export const suppliersShown = (suppliers: readonly Supplier[], filter: SupplierFilter): readonly Supplier[] =>
  filter === 'all' ? suppliers : suppliers.filter((supplier) => supplier.status === filter)
