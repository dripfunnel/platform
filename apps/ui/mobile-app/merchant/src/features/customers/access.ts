// Who may do what with customers (FIRST-RELEASE (store) §7; ACCESS.md §5.1): the merchant side reads with `customers.read`,
// changes with `customers.write` unless the store is read-only, and exports with `customers.export`. A supplier's seat has none.
// The server decides every call again.
export type CustomersAccess = { canRead: boolean; canEdit: boolean; canExport: boolean; readOnly: boolean }

export const customersAccessOf = (acting: { permissions: readonly string[]; supplier: boolean }, readOnly: boolean): CustomersAccess => {
  const has = (permission: string) => !acting.supplier && acting.permissions.includes(permission)
  return { canRead: has('customers.read'), canEdit: has('customers.write') && !readOnly, canExport: has('customers.export'), readOnly }
}
