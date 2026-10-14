import { moreFor, seatOf, supplierTiers, tabsFor, type Seat } from './nav'

const keys = (items: readonly { key: string }[]) => items.map((item) => item.key)
const seat = (role: string, tier: string | null = null): Seat => {
  const found = seatOf({ role, tier })
  if (!found) throw new Error(`no seat for ${role}`)
  return found
}
const shopKeys = (s: Seat | null) => keys(moreFor(s).find((group) => group.key === 'shop')?.items ?? [])
const accountKeys = (s: Seat | null) => keys(moreFor(s).find((group) => group.key === 'account')?.items ?? [])

describe('the tabs per role and supplier tier (DESIGN.md §2)', () => {
  it('gives an Owner, a Manager and Staff Home, Orders, Catalogue, Offers and More', () => {
    for (const role of ['owner', 'manager', 'staff']) {
      expect(keys(tabsFor(seat(role)))).toEqual(['home', 'orders', 'catalogue', 'offers', 'more'])
    }
  })

  it('gives a stock-only supplier Products and More', () => {
    expect(keys(tabsFor(seat('supplier-member', 'vendor-stock')))).toEqual(['products', 'more'])
  })

  it('gives a catalogue supplier Products and More, since it cannot read orders', () => {
    expect(keys(tabsFor(seat('supplier-member', 'vendor-catalogue')))).toEqual(['products', 'more'])
  })

  it('gives the two orders tiers Products, To ship and More', () => {
    expect(keys(tabsFor(seat('supplier-member', 'vendor-orders-read')))).toEqual(['products', 'toShip', 'more'])
    expect(keys(tabsFor(seat('supplier-admin', 'vendor-orders-fulfil')))).toEqual(['products', 'toShip', 'more'])
  })

  it('puts a badge on Orders and To ship for the orders to ship, and on Catalogue for products to approve, not for Staff', () => {
    const badge = (s: Seat, key: string) => tabsFor(s).find((tab) => tab.key === key)?.badge
    expect(badge(seat('owner'), 'orders')).toBe('ordersToShip')
    expect(badge(seat('manager'), 'catalogue')).toBe('productsToApprove')
    expect(badge(seat('staff'), 'catalogue')).toBeNull()
    expect(badge(seat('supplier-member', 'vendor-orders-fulfil'), 'toShip')).toBe('ordersToShip')
    expect(badge(seat('owner'), 'home')).toBeNull()
  })

  it('has a Products tab folder for every supplier tab, and only More for a seat the app does not know', () => {
    expect(tabsFor(seat('supplier-member', 'vendor-stock')).map((tab) => tab.route)).toEqual(['products', 'more'])
    expect(keys(tabsFor(null))).toEqual(['more'])
  })
})

describe('the More items per role and supplier tier', () => {
  it('shows an Owner Customers, Abandoned carts, Reports and Storefront, and Settings under Account', () => {
    expect(shopKeys(seat('owner'))).toEqual(['customers', 'carts', 'reports', 'storefront'])
    expect(accountKeys(seat('owner'))).toEqual(['profile', 'settings', 'switchStore', 'signOut'])
  })

  it('shows a Manager the same, with Storefront view only, and no Settings', () => {
    expect(shopKeys(seat('manager'))).toEqual(['customers', 'carts', 'reports', 'storefront'])
    const storefront = moreFor(seat('manager'))[0]?.items.find((item) => item.key === 'storefront')
    expect(storefront).toMatchObject({ note: 'viewOnly' })
    expect(accountKeys(seat('manager'))).toEqual(['profile', 'switchStore', 'signOut'])
  })

  it('shows Staff Customers and Abandoned carts (view only), and no Reports or Storefront', () => {
    expect(shopKeys(seat('staff'))).toEqual(['customers', 'carts'])
    expect(moreFor(seat('staff'))[0]?.items.find((item) => item.key === 'carts')).toMatchObject({ note: 'viewOnly' })
    expect(accountKeys(seat('staff'))).toEqual(['profile', 'switchStore', 'signOut'])
  })

  it('offers Settings only to the Owner, whatever else a role can do', () => {
    const roles = ['owner', 'manager', 'staff', 'supplier-admin', 'supplier-member']
    const withSettings = roles.filter((role) => accountKeys(seatOf({ role, tier: role.startsWith('supplier') ? 'vendor-orders-fulfil' : null })).includes('settings'))
    expect(withSettings).toEqual(['owner'])
  })

  it('has no Billing anywhere (FIRST-RELEASE.md §1)', () => {
    for (const role of ['owner', 'manager', 'staff']) {
      expect(JSON.stringify(moreFor(seat(role)))).not.toMatch(/billing/i)
    }
  })

  it('shows a supplier Your sales only on an orders tier, and Your team only to a supplier admin', () => {
    expect(shopKeys(seat('supplier-member', 'vendor-stock'))).toEqual([])
    expect(shopKeys(seat('supplier-member', 'vendor-catalogue'))).toEqual([])
    expect(shopKeys(seat('supplier-member', 'vendor-orders-read'))).toEqual(['sales'])
    expect(shopKeys(seat('supplier-admin', 'vendor-orders-fulfil'))).toEqual(['sales', 'team'])
    expect(shopKeys(seat('supplier-admin', 'vendor-stock'))).toEqual(['team'])
  })

  it('always ends with Account: My profile, Switch store and Sign out', () => {
    for (const tier of supplierTiers) {
      const groups = moreFor(seat('supplier-member', tier))
      expect(groups.at(-1)).toMatchObject({ key: 'account' })
      expect(accountKeys(seat('supplier-member', tier))).toEqual(['profile', 'switchStore', 'signOut'])
    }
    expect(moreFor(null)).toHaveLength(1)
  })
})

describe('the seat a membership gives', () => {
  it('reads a merchant role and a supplier tier, and nothing it does not know', () => {
    expect(seatOf({ role: 'owner', tier: null })).toEqual({ side: 'merchant', role: 'owner' })
    expect(seatOf({ role: 'supplier-admin', tier: 'vendor-catalogue' })).toEqual({ side: 'supplier', admin: true, tier: 'vendor-catalogue' })
    expect(seatOf({ role: 'supplier-member', tier: null })).toBeNull()
    expect(seatOf({ role: 'cashier', tier: null })).toBeNull()
  })
})
