// The tabs and the More items per role and supplier tier, as data (DESIGN.md §2, FIRST-RELEASE.md §3.1). An item a role
// can't use is absent, never disabled. Hiding is a courtesy: the API decides access.

export type MerchantRole = 'owner' | 'manager' | 'staff'

// The API's four supplier tiers (apps/api src/auth/storePermissions.ts); only the two "orders" tiers can read orders.
export const supplierTiers = ['vendor-stock', 'vendor-catalogue', 'vendor-orders-read', 'vendor-orders-fulfil'] as const
export type SupplierTier = (typeof supplierTiers)[number]

export type Seat = { side: 'merchant'; role: MerchantRole } | { side: 'supplier'; admin: boolean; tier: SupplierTier }

const merchantRoles: readonly string[] = ['owner', 'manager', 'staff']
const isSupplierTier = (value: string | null): value is SupplierTier => (supplierTiers as readonly (string | null)[]).includes(value)

/** The seat a membership gives: its role, and for a supplier its tier. Null for anything the app doesn't know. */
export const seatOf = (acting: { role: string; tier: string | null }): Seat | null => {
  if (merchantRoles.includes(acting.role)) return { side: 'merchant', role: acting.role as MerchantRole }
  if (acting.role.startsWith('supplier') && isSupplierTier(acting.tier)) return { side: 'supplier', admin: acting.role === 'supplier-admin', tier: acting.tier }
  return null
}

export type BadgeSource = 'ordersToShip' | 'productsToApprove'

/** `route` is the name of the tab's folder under `app/(tabs)`. */
export type Tab = { key: string; route: string; badge: BadgeSource | null }

export type MoreItem =
  | { key: string; kind: 'route'; href: string; note: 'viewOnly' | null }
  | { key: string; kind: 'action'; action: 'switchStore' | 'signOut' }

export type MoreGroup = { key: 'shop' | 'account'; items: readonly MoreItem[] }

const ordersTiers: readonly SupplierTier[] = ['vendor-orders-read', 'vendor-orders-fulfil']
const hasOrders = (seat: Seat): boolean => seat.side === 'supplier' && ordersTiers.includes(seat.tier)

export const tabsFor = (seat: Seat | null): readonly Tab[] => {
  const more: Tab = { key: 'more', route: 'more', badge: null }
  if (!seat) return [more]
  if (seat.side === 'merchant') {
    return [
      { key: 'home', route: 'home', badge: null },
      { key: 'orders', route: 'orders', badge: 'ordersToShip' },
      { key: 'catalogue', route: 'catalogue', badge: seat.role === 'staff' ? null : 'productsToApprove' },
      { key: 'offers', route: 'offers', badge: null },
      more,
    ]
  }
  return [{ key: 'products', route: 'products', badge: null }, ...(hasOrders(seat) ? [{ key: 'toShip', route: 'to-ship', badge: 'ordersToShip' as const }] : []), more]
}

/** Every screen under More that some role has; one a role lacks is access denied, one nobody has is a 404. */
export const moreRouteKeys = ['customers', 'carts', 'reports', 'storefront', 'settings', 'activity', 'sales', 'team'] as const

const route = (key: string, note: 'viewOnly' | null = null): MoreItem => ({ key, kind: 'route', href: `/more/${key}`, note })

const shopItems = (seat: Seat | null): readonly MoreItem[] => {
  if (!seat) return []
  if (seat.side === 'merchant') {
    if (seat.role === 'staff') return [route('customers'), route('carts', 'viewOnly')]
    return [route('customers'), route('carts'), route('reports'), route('storefront', seat.role === 'manager' ? 'viewOnly' : null)]
  }
  return [...(hasOrders(seat) ? [route('sales')] : []), ...(seat.admin ? [route('team')] : [])]
}

// My profile is for everyone; Settings only for the Owner, whose Activity log is a Settings tab, so the Manager's Store activity is an item of its own
// (FIRST-RELEASE.md §15). Billing is not in the app (FIRST-RELEASE.md §1).
const accountItems = (seat: Seat | null): readonly MoreItem[] => [
  { key: 'profile', kind: 'route', href: '/profile', note: null },
  ...(seat?.side === 'merchant' && seat.role === 'owner' ? [route('settings')] : []),
  ...(seat?.side === 'merchant' && seat.role === 'manager' ? [route('activity')] : []),
  { key: 'switchStore', kind: 'action', action: 'switchStore' },
  { key: 'signOut', kind: 'action', action: 'signOut' },
]

export const moreFor = (seat: Seat | null): readonly MoreGroup[] => {
  const shop = shopItems(seat)
  return [...(shop.length > 0 ? [{ key: 'shop' as const, items: shop }] : []), { key: 'account', items: accountItems(seat) }]
}

/** The tab a route belongs to, so a screen under More keeps More active. */
export const tabOfRoute = (name: string, tabs: readonly Tab[]): string => (tabs.some((tab) => tab.route === name) ? name : 'more')

/** The tab bar is hidden only in the full storefront designer, which is every screen below the compact Storefront (DESIGN.md §2). */
export const tabBarHiddenAt = (segments: readonly string[]): boolean => segments[1] === 'more' && segments[2] === 'storefront' && segments.length > 3
