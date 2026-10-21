// Who may do what with abandoned carts (FIRST-RELEASE (store) §9; ACCESS.md §5.1): the merchant side reads with `carts.read` and sends,
// stops, resumes and saves reminders with `carts.write` unless the store is read-only. Staff has no write, a supplier has neither.
// The server decides every call again.
export type CartsAccess = {
  canRead: boolean
  canEdit: boolean
  /** Can read but holds no `carts.write` (Staff). */
  viewOnly: boolean
  readOnly: boolean
  canOpenOrder: boolean
  canOpenCustomer: boolean
}

export const cartsAccessOf = (acting: { permissions: readonly string[]; supplier: boolean }, readOnly: boolean): CartsAccess => {
  const has = (permission: string) => !acting.supplier && acting.permissions.includes(permission)
  return {
    canRead: has('carts.read'),
    canEdit: has('carts.write') && !readOnly,
    viewOnly: has('carts.read') && !has('carts.write'),
    readOnly,
    canOpenOrder: has('orders.read'),
    canOpenCustomer: has('customers.read'),
  }
}
