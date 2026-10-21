// Who may do what with offers (FIRST-RELEASE (store) §8; ACCESS.md §5.1): the merchant side reads with `offers.read`, changes with
// `offers.write` unless the store is read-only, and gets a run of single-use codes as a file with `offers.export` (Owner and Manager).
// A supplier's seat has none. The server decides every call again.
export type OffersAccess = { canRead: boolean; canEdit: boolean; canExport: boolean; /** Reads without changing: Staff, told so. */ viewOnly: boolean; readOnly: boolean }

export const offersAccessOf = (acting: { permissions: readonly string[]; supplier: boolean }, readOnly: boolean): OffersAccess => {
  const has = (permission: string) => !acting.supplier && acting.permissions.includes(permission)
  return { canRead: has('offers.read'), canEdit: has('offers.write') && !readOnly, canExport: has('offers.export'), viewOnly: has('offers.read') && !has('offers.write'), readOnly }
}
