// What the acting seat may do in the editor (ACCESS §5, §7.2; CatEditor's banners). The server decides every
// write again; this only shapes the form.

export interface EditorAccess {
  side: 'merchant' | 'supplier'
  /** Every field: catalog.write, or a Stock-only supplier's new product, which it proposes (#337). */
  canEdit: boolean
  proposes: boolean
  /** Typed quantities and reasoned changes (stock.write): every tier, even Stock-only on a product it can't edit. */
  canStock: boolean
  /** The store's own settings on a product: whether it shows, its tax category, deleting it. */
  storeFields: boolean
  viewOnly: boolean
  readOnlyStore: boolean
}

export const editorAccessOf = (acting: { permissions: readonly string[]; seller: unknown }, readOnly: boolean, isNew: boolean): EditorAccess => {
  const has = (p: string) => acting.permissions.includes(p)
  const supplier = acting.seller !== null
  const writes = has('catalog.write')
  const proposes = supplier && !writes && has('catalog.propose')
  const canEdit = !readOnly && (writes || (proposes && isNew))
  return {
    side: supplier ? 'supplier' : 'merchant',
    canEdit,
    proposes,
    canStock: !readOnly && has('stock.write'),
    storeFields: canEdit && !supplier,
    viewOnly: !readOnly && !canEdit,
    readOnlyStore: readOnly,
  }
}
