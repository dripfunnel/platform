// Who may do what on the Storefront (FIRST-RELEASE (store) §14; ACCESS.md §5.1): `storefront.read` looks, `publish` (the Owner) changes, and nothing changes
// in a read-only store. A Manager looks only; Staff and suppliers have no Storefront. The server decides every call again.
export type StorefrontAccess = {
  canRead: boolean
  canEdit: boolean
  /** Can look, but holds no `publish` (the Manager). */
  viewOnly: boolean
  readOnly: boolean
}

export const storefrontAccessOf = (acting: { permissions: readonly string[]; supplier: boolean }, readOnly: boolean): StorefrontAccess => {
  const has = (permission: string) => !acting.supplier && acting.permissions.includes(permission)
  return { canRead: has('storefront.read'), canEdit: has('publish') && !readOnly, viewOnly: has('storefront.read') && !has('publish'), readOnly }
}
