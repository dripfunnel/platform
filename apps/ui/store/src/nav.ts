import type { IconName } from '@dripfunnel/shared/ui'

// The menu per role and supplier tier (FIRST-RELEASE.md §3.1), in the prototype's order. A row a
// role can't use is absent; inside a screen it is disabled with the reason (ui/README.md §5).

export const merchantRoles = ['owner', 'manager', 'staff'] as const
export type MerchantRole = (typeof merchantRoles)[number]
export const supplierTiers = ['vendor-stock', 'vendor-catalogue', 'vendor-orders-read', 'vendor-orders-fulfil'] as const
export type SupplierTier = (typeof supplierTiers)[number]

export type Seat = { side: 'merchant'; role: MerchantRole } | { side: 'supplier'; admin: boolean; tier: SupplierTier }

export type NavKey = 'home' | 'orders' | 'customers' | 'offers' | 'carts' | 'reports' | 'products' | 'collections' | 'storefront' | 'settings' | 'billing' | 'yourProducts' | 'toShip' | 'sales' | 'team'
export type NavGroup = 'catalogue' | 'shop' | 'admin'
export type NavBadgeSource = 'ordersToShip' | 'productsToApprove'

export interface NavRow {
  key: NavKey
  to: string
  icon: IconName
  group?: NavGroup
  badge?: NavBadgeSource
}

const row = (key: NavKey, to: string, icon: IconName, extra: Partial<Pick<NavRow, 'group' | 'badge'>> = {}): NavRow => ({ key, to, icon, ...extra })

const merchantRows = (role: MerchantRole): NavRow[] => [
  row('home', '/home', 'house'),
  row('orders', '/orders', 'orders', { badge: 'ordersToShip' }),
  row('customers', '/customers', 'customers'),
  row('offers', '/offers', 'offers'),
  row('carts', '/carts', 'carts'),
  ...(role === 'staff' ? [] : [row('reports', '/reports', 'reports')]),
  row('products', '/products', 'products', { group: 'catalogue', badge: 'productsToApprove' }),
  row('collections', '/collections', 'collections', { group: 'catalogue' }),
  ...(role === 'staff' ? [] : [row('storefront', '/storefront', 'storefront', { group: 'shop' })]),
  ...(role === 'owner' ? [row('settings', '/settings', 'settings', { group: 'admin' }), row('billing', '/billing', 'billing', { group: 'admin' })] : []),
]

const ordersTiers: readonly SupplierTier[] = ['vendor-orders-read', 'vendor-orders-fulfil']

const supplierRows = (tier: SupplierTier, admin: boolean): NavRow[] => [
  row('yourProducts', '/products', 'products'),
  ...(ordersTiers.includes(tier) ? [row('toShip', '/orders', 'orders', { badge: 'ordersToShip' }), row('sales', '/sales', 'sales')] : []),
  ...(admin ? [row('team', '/team', 'team')] : []),
]

export const navFor = (seat: Seat): readonly NavRow[] => (seat.side === 'merchant' ? merchantRows(seat.role) : supplierRows(seat.tier, seat.admin))
