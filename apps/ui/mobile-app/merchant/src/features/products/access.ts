// What the acting seat may do with products (ACCESS.md §5, §7.2; the editor's banners). Built from the permissions the API
// lists for the seat; hiding a control is a courtesy, and the server decides every write again.

export type ProductAccess = {
  side: 'merchant' | 'supplier'
  /** Every field: `catalog.write`, or a Stock-only supplier's new product, which it proposes (#337). */
  canEdit: boolean
  proposes: boolean
  /** Typed quantities and reasoned changes (`stock.write`): every supplier tier, and Owner and Manager. */
  canStock: boolean
  /** A merchant seat that may approve or send back a supplier's product. */
  canApprove: boolean
  /** The store's own settings on a product: whether it shows. */
  storeFields: boolean
  viewOnly: boolean
  readOnlyStore: boolean
}

export const productAccessOf = (acting: { permissions: readonly string[]; supplier: boolean }, readOnly: boolean, isNew: boolean): ProductAccess => {
  const has = (permission: string) => acting.permissions.includes(permission)
  const writes = has('catalog.write')
  const proposes = acting.supplier && !writes && has('catalog.propose')
  const canEdit = !readOnly && (writes || (proposes && isNew))
  return {
    side: acting.supplier ? 'supplier' : 'merchant',
    canEdit,
    proposes,
    canStock: !readOnly && has('stock.write'),
    canApprove: !readOnly && !acting.supplier && has('approve'),
    storeFields: canEdit && !acting.supplier,
    viewOnly: !readOnly && !canEdit,
    readOnlyStore: readOnly,
  }
}

/** Whether the list offers "Add product": a seat that writes the catalogue, or a Stock-only supplier that proposes. */
export const canAddProduct = (acting: { permissions: readonly string[] }, readOnly: boolean): boolean =>
  !readOnly && (acting.permissions.includes('catalog.write') || acting.permissions.includes('catalog.propose'))
