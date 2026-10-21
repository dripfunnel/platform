import { describe, expect, it } from 'vitest'
import { navFor, type Seat } from './nav'

// FIRST-RELEASE.md §3.1: the rows each role and supplier tier sees, in the prototype's order.
const cases: [string, Seat, readonly string[]][] = [
  ['Owner', { side: 'merchant', role: 'owner' }, ['home', 'orders', 'customers', 'offers', 'carts', 'reports', 'products', 'collections', 'storefront', 'settings', 'billing']],
  ['Manager', { side: 'merchant', role: 'manager' }, ['home', 'orders', 'customers', 'offers', 'carts', 'reports', 'products', 'collections', 'storefront']],
  ['Staff', { side: 'merchant', role: 'staff' }, ['home', 'orders', 'customers', 'offers', 'carts', 'products', 'collections']],
  ['Supplier, Stock only', { side: 'supplier', tier: 'vendor-stock', admin: false }, ['yourProducts']],
  ['Supplier, Products and stock', { side: 'supplier', tier: 'vendor-catalogue', admin: false }, ['yourProducts']],
  ['Supplier, their orders (read)', { side: 'supplier', tier: 'vendor-orders-read', admin: false }, ['yourProducts', 'toShip', 'sales']],
  ['Supplier, their orders (ship)', { side: 'supplier', tier: 'vendor-orders-fulfil', admin: false }, ['yourProducts', 'toShip', 'sales']],
  ['Supplier admin, Stock only', { side: 'supplier', tier: 'vendor-stock', admin: true }, ['yourProducts', 'team']],
  ['Supplier admin, their orders', { side: 'supplier', tier: 'vendor-orders-fulfil', admin: true }, ['yourProducts', 'toShip', 'sales', 'team']],
]

describe('navFor', () => {
  it.each(cases)('gives %s exactly its rows', (_name, seat, keys) => {
    expect(navFor(seat).map((row) => row.key)).toEqual(keys)
  })

  it('groups Catalogue, Your shop and Admin as the prototype does, for the merchant side only', () => {
    const groups = Object.fromEntries(navFor({ side: 'merchant', role: 'owner' }).filter((row) => row.group).map((row) => [row.key, row.group]))
    expect(groups).toEqual({ products: 'catalogue', collections: 'catalogue', storefront: 'shop', settings: 'admin', billing: 'admin' })
    expect(navFor({ side: 'supplier', tier: 'vendor-orders-fulfil', admin: true }).some((row) => row.group)).toBe(false)
  })

  it('badges only orders to ship and products waiting for approval (§3.1)', () => {
    const badges = Object.fromEntries(navFor({ side: 'merchant', role: 'owner' }).filter((row) => row.badge).map((row) => [row.key, row.badge]))
    expect(badges).toEqual({ orders: 'ordersToShip', products: 'productsToApprove' })
  })
})
