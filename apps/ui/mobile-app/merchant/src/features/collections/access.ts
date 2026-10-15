// Who may do what in Collections (FIRST-RELEASE.md §12): the merchant side reads with `catalog.read` and changes with
// `catalog.write`, unless the store is read-only, so Staff, which has no write, looks only. A supplier's seat has neither.
// The server decides every write again.
export const collectionsAccess = (acting: { permissions: readonly string[]; supplier: boolean }, readOnly: boolean) => ({
  canRead: !acting.supplier && acting.permissions.includes('catalog.read'),
  canEdit: !acting.supplier && acting.permissions.includes('catalog.write') && !readOnly,
})
