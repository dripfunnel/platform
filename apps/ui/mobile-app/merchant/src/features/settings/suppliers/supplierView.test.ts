import type { Supplier } from '../../../api/settingsPeople'
import { supplierCounts, suppliersShown } from './supplierView'

const supplier = (id: string, status: Supplier['status']): Supplier => ({ id, name: id, accessLevel: 'vendor-catalogue', shippingMode: 'to-store', labelAccount: 'store', status, users: 1, products: 0 })
const list = [supplier('a', 'active'), supplier('b', 'invited'), supplier('c', 'suspended'), supplier('d', 'active')]

describe('the suppliers filter', () => {
  it('counts each state on its own: an invited company is not active', () => {
    expect(supplierCounts(list)).toEqual({ active: 2, invited: 1, suspended: 1 })
  })

  it('shows every company, or only those in the chosen state', () => {
    expect(suppliersShown(list, 'all')).toHaveLength(4)
    expect(suppliersShown(list, 'active').map((s) => s.id)).toEqual(['a', 'd'])
    expect(suppliersShown(list, 'invited').map((s) => s.id)).toEqual(['b'])
    expect(suppliersShown(list, 'suspended').map((s) => s.id)).toEqual(['c'])
  })
})
