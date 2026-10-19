import { loadProductStock, setStock, type StockLevel } from '../../../api/inventory'
import { saveProductKind, type ProductKindInput, type ProductKindView } from '../../../api/productKinds'
import { loadProduct, saveProduct, type EditorProduct, type SavedProduct } from '../../../api/products'
import type { ApiClient } from '../../../graphql'
import { inputOf, stockChangesOf, versionKey, type Draft } from './draft'

export type SaveRequest = {
  client: ApiClient
  /** Null for a new product. */
  product: Pick<EditorProduct, 'id' | 'revision'> | null
  draft: Draft
  /** What the form was last known to hold, so only counts typed since are sent. */
  baseline: Draft
  currency: string
  side: 'merchant' | 'supplier'
  /** A Stock-only supplier's new product is proposed, never saved directly. */
  propose: boolean
  /** False for a seat that may only count stock: the product itself is left alone. */
  writesProduct: boolean
  countsStock: boolean
  /** The kind's own card, saved after the product at the revision it answered; null when there is none to save. */
  kindInput: ProductKindInput | null
}

export type SaveOutcome = {
  id: string
  saved: SavedProduct | null
  /** The product as the API holds it now, or null if it could not be read back. */
  product: EditorProduct | null
  levels: Map<string, StockLevel[]> | null
  /** The product saved but its typed counts did not. */
  stockFailed: boolean
  /** What the API holds for the kind after its save, or null when it wasn't saved. */
  kind: ProductKindView | null
  /** The product saved but its kind's card did not. */
  kindFailed: { error: unknown } | null
}

// The product first, then its kind's card, then its typed counts at the versions that now have ids (the API answers a save with the product's id,
// not its versions'), then both read back so the form holds what the API holds. A failure of the counts after the product
// saved is reported, not thrown: the product is saved and the typed numbers are still in the form.
export async function runSave({ client, product, draft, baseline, currency, side, propose, writesProduct, countsStock, kindInput }: SaveRequest): Promise<SaveOutcome> {
  const saved = writesProduct ? await saveProduct(client, product?.id ?? null, product?.revision ?? null, inputOf(draft, currency, side, product === null), propose) : null
  const id = saved?.id ?? product?.id
  if (!id) throw new Error('A save with nothing to save and no product')

  let kind: ProductKindView | null = null
  let kindFailed: SaveOutcome['kindFailed'] = null
  if (kindInput && saved) {
    try {
      kind = await saveProductKind(client, id, saved.revision, kindInput)
    } catch (error) {
      kindFailed = { error }
    }
  }

  const read = await loadProduct(client, id).catch(() => null)
  let stockFailed = false
  if (countsStock && read) {
    const ids = new Map(read.versions.map((version) => [versionKey(version.choices), version.id]))
    const changes = stockChangesOf(draft, baseline, (key) => ids.get(key))
    try {
      await setStock(client, changes)
    } catch {
      stockFailed = true
    }
  }
  // Counts can only be sent to versions the API has answered with; typed ones that can't be sent are reported, never dropped.
  if (countsStock && !read && stockChangesOf(draft, baseline, () => 'unread').length > 0) stockFailed = true
  const levels = read ? await loadProductStock(client, id).catch(() => null) : null
  return { id, saved, product: read, levels, stockFailed, kind, kindFailed }
}
