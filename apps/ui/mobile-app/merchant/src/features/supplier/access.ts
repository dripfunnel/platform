// What a supplier's seat may do (ACCESS.md §5.2, §7; FIRST-RELEASE (store) §17). Built from the permissions the API lists for the seat: the four tiers
// differ in them, and a Supplier admin adds `supplier.team`. A control a seat lacks is absent, and the server decides every call again.

export type SupplierAccess = {
  /** To ship and an order's page: the two orders tiers. */
  canRead: boolean
  /** Mark shipped or sent: `vendor-orders-fulfil` only. */
  canShip: boolean
  canExport: boolean
  canSeeSales: boolean
  /** Your team opens for a Supplier admin; a read-only store still lists it but changes nothing. */
  canOpenTeam: boolean
  canChangeTeam: boolean
  readOnly: boolean
}

export const supplierAccessOf = (acting: { permissions: readonly string[]; supplier: boolean }, readOnly: boolean): SupplierAccess => {
  const has = (permission: string) => acting.supplier && acting.permissions.includes(permission)
  return {
    canRead: has('orders.read'),
    canShip: has('orders.fulfil') && !readOnly,
    canExport: has('exports.orders'),
    canSeeSales: has('sales.read'),
    canOpenTeam: has('supplier.team'),
    canChangeTeam: has('supplier.team') && !readOnly,
    readOnly,
  }
}
