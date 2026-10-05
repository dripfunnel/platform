// The Store API's permissions: merchant roles (ACCESS.md §5.1) and supplier tiers (§5.2).
// A supplier's are the tier's, applied to its own rows by SellerScope; its team role adds
// managing its own team (`supplier.team`).
export const merchantRoles = ['owner', 'manager', 'staff'] as const
export type MerchantRole = (typeof merchantRoles)[number]

export const supplierRoles = ['supplier-admin', 'supplier-member'] as const
export type SupplierRole = (typeof supplierRoles)[number]

export const supplierTiers = ['vendor-stock', 'vendor-catalogue', 'vendor-orders-read', 'vendor-orders-fulfil'] as const
export type SupplierTier = (typeof supplierTiers)[number]

export const storePermissions = [
  'catalog.read',
  'catalog.write',
  'catalog.import',
  'stock.read',
  'stock.write',
  'warehouses.write',
  'orders.read',
  'orders.write',
  'orders.fulfil',
  'orders.refund',
  'orders.mark_paid',
  'customers.read',
  'customers.write',
  'customers.export',
  'exports',
  'exports.products',
  'exports.orders',
  'offers.read',
  'offers.write',
  'offers.export',
  'carts.read',
  'carts.write',
  'reports.read',
  'sales.read',
  'store.export',
  'activity.read',
  'activity.export',
  'payments.configure',
  'shipping.configure',
  'tax.configure',
  'support.allow_write',
  'invite',
  'manage-vendors',
  'approve',
  'publish',
  'billing',
  'settings',
  'supplier.team',
] as const

export type StorePermission = (typeof storePermissions)[number]

export const isStorePermission = (value: string): value is StorePermission => (storePermissions as readonly string[]).includes(value)

const staffSet: readonly StorePermission[] = ['catalog.read', 'stock.read', 'orders.read', 'orders.write', 'customers.read', 'customers.write', 'customers.export', 'exports', 'offers.read', 'carts.read']

const managerSet: readonly StorePermission[] = [
  ...staffSet,
  'catalog.write',
  'catalog.import',
  'stock.write',
  'orders.refund',
  'orders.mark_paid',
  'offers.write',
  'offers.export',
  'carts.write',
  'reports.read',
  'activity.read',
  'support.allow_write',
]

const supplierOnly: readonly StorePermission[] = ['orders.fulfil', 'exports.products', 'exports.orders', 'sales.read', 'supplier.team']

export const merchantRolePermissions: Record<MerchantRole, readonly StorePermission[]> = {
  owner: storePermissions.filter((p) => !supplierOnly.includes(p)),
  manager: managerSet,
  staff: staffSet,
}

const everyTier: readonly StorePermission[] = ['catalog.read', 'stock.read', 'stock.write', 'warehouses.write', 'exports.products']
const writesCatalogue: readonly StorePermission[] = [...everyTier, 'catalog.write', 'catalog.import']
const readsOrders: readonly StorePermission[] = [...writesCatalogue, 'orders.read', 'sales.read', 'exports.orders']

export const supplierTierPermissions: Record<SupplierTier, readonly StorePermission[]> = {
  'vendor-stock': everyTier,
  'vendor-catalogue': writesCatalogue,
  'vendor-orders-read': readsOrders,
  'vendor-orders-fulfil': [...readsOrders, 'orders.fulfil', 'orders.refund'],
}

export type StoreRole =
  | { side: 'merchant'; role: MerchantRole }
  | { side: 'supplier'; role: SupplierRole; tier: SupplierTier }

export const storeRoleHas = (role: StoreRole, permission: StorePermission): boolean => {
  if (role.side === 'merchant') return merchantRolePermissions[role.role].includes(permission)
  if (permission === 'supplier.team') return role.role === 'supplier-admin'
  return supplierTierPermissions[role.tier].includes(permission)
}

export const isMerchantRole = (value: string): value is MerchantRole => (merchantRoles as readonly string[]).includes(value)
export const isSupplierRole = (value: string): value is SupplierRole => (supplierRoles as readonly string[]).includes(value)
export const isSupplierTier = (value: string): value is SupplierTier => (supplierTiers as readonly string[]).includes(value)
