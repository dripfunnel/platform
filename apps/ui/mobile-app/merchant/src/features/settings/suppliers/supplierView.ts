import type { Supplier } from '../../../api/settingsPeople'

export type SupplierFilter = 'all' | 'active' | 'suspended'

export const supplierCounts = (suppliers: readonly Supplier[]): { active: number; suspended: number } => ({
  active: suppliers.filter((supplier) => supplier.status !== 'suspended').length,
  suspended: suppliers.filter((supplier) => supplier.status === 'suspended').length,
})

export const suppliersShown = (suppliers: readonly Supplier[], filter: SupplierFilter): readonly Supplier[] =>
  filter === 'active' ? suppliers.filter((supplier) => supplier.status !== 'suspended') : filter === 'suspended' ? suppliers.filter((supplier) => supplier.status === 'suspended') : suppliers
