// Who may do what with orders (ACCESS.md §5.1; FIRST-RELEASE.md §6). Built from the permissions the API lists for the seat; a control a seat
// lacks is absent, not disabled (DESIGN.md §2), and the server decides every write again. A supplier's To ship is MA 13 (#506), so its seat reads none here.

export type OrdersAccess = {
  canRead: boolean
  canShip: boolean
  /** The Owner's `shippingSettings` is where the connected couriers are read, so only a seat that holds it can book a label. */
  canBook: boolean
  canMarkPaid: boolean
  canCancel: boolean
  canRefund: boolean
  canExport: boolean
  canOpenCustomer: boolean
  readOnly: boolean
}

export const ordersAccessOf = (acting: { permissions: readonly string[]; supplier: boolean }, readOnly: boolean): OrdersAccess => {
  const has = (permission: string) => !acting.supplier && acting.permissions.includes(permission)
  return {
    canRead: has('orders.read'),
    canShip: has('orders.fulfil') && !readOnly,
    canBook: has('orders.fulfil') && has('shipping.configure') && !readOnly,
    canMarkPaid: has('orders.mark_paid') && !readOnly,
    canCancel: has('orders.write') && !readOnly,
    canRefund: has('orders.refund') && !readOnly,
    canExport: has('exports'),
    canOpenCustomer: has('customers.read'),
    readOnly,
  }
}
