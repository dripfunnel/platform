import { describe, expect, it } from 'vitest'
import { storePermissions, storeRoleHas, type StorePermission, type StoreRole } from './storePermissions'

const merchant = (role: 'owner' | 'manager' | 'staff'): StoreRole => ({ side: 'merchant', role })
const supplier = (tier: 'vendor-stock' | 'vendor-catalogue' | 'vendor-orders-read' | 'vendor-orders-fulfil', role: 'supplier-admin' | 'supplier-member' = 'supplier-member'): StoreRole => ({ side: 'supplier', role, tier })
const can = (role: StoreRole) => (p: StorePermission) => storeRoleHas(role, p)

describe('merchant roles (ACCESS.md §5.1)', () => {
  it('gives the Owner every merchant permission and no supplier-only one', () => {
    const owner = can(merchant('owner'))
    for (const p of ['settings', 'billing', 'invite', 'publish', 'store.export', 'activity.export', 'warehouses.write'] as const) expect(owner(p)).toBe(true)
    for (const p of ['sales.read', 'supplier.team'] as const) expect(owner(p)).toBe(false)
  })

  it('lets a Manager change stock but not warehouses, read the log but not export it, and allow support writes', () => {
    const manager = can(merchant('manager'))
    expect(manager('stock.write')).toBe(true)
    expect(manager('warehouses.write')).toBe(false)
    expect(manager('activity.read')).toBe(true)
    expect(manager('activity.export')).toBe(false)
    expect(manager('support.allow_write')).toBe(true)
    expect(manager('orders.mark_paid')).toBe(true)
    expect(manager('settings')).toBe(false)
    expect(manager('publish')).toBe(false)
  })

  it('lets Staff work orders and customers and export, and read offers without changing or exporting them', () => {
    const staff = can(merchant('staff'))
    for (const p of ['orders.write', 'orders.fulfil', 'customers.write', 'customers.export', 'exports', 'offers.read', 'carts.read'] as const) expect(staff(p)).toBe(true)
    for (const p of ['catalog.write', 'offers.write', 'offers.export', 'orders.refund', 'orders.mark_paid', 'reports.read', 'activity.read'] as const) expect(staff(p)).toBe(false)
  })
})

describe('supplier tiers (ACCESS.md §5.2)', () => {
  it('lets Stock only change quantities and never the catalogue', () => {
    const stock = can(supplier('vendor-stock'))
    expect(stock('stock.write')).toBe(true)
    expect(stock('catalog.read')).toBe(true)
    expect(stock('catalog.write')).toBe(false)
    expect(stock('orders.read')).toBe(false)
  })

  it('opens orders only to the order tiers, and fulfilling and refunds only to the fulfilling one', () => {
    expect(can(supplier('vendor-catalogue'))('orders.read')).toBe(false)
    expect(can(supplier('vendor-orders-read'))('orders.read')).toBe(true)
    expect(can(supplier('vendor-orders-read'))('orders.fulfil')).toBe(false)
    expect(can(supplier('vendor-orders-fulfil'))('orders.refund')).toBe(true)
  })

  it('never gives a supplier offers, customers, settings, billing or reports', () => {
    const fulfil = can(supplier('vendor-orders-fulfil', 'supplier-admin'))
    for (const p of ['offers.read', 'customers.read', 'settings', 'billing', 'reports.read', 'activity.read', 'invite'] as const) expect(fulfil(p)).toBe(false)
  })

  it('lets only a Supplier admin manage the supplier’s team', () => {
    expect(can(supplier('vendor-stock', 'supplier-admin'))('supplier.team')).toBe(true)
    expect(can(supplier('vendor-orders-fulfil', 'supplier-member'))('supplier.team')).toBe(false)
  })

  it('names every permission it checks', () => {
    expect(new Set(storePermissions).size).toBe(storePermissions.length)
  })
})
