import type { SampleDetail, SampleItemsInput } from '../../api/storeCategorySample'
import { messages } from '../../messages'

// The sample editor's unsaved state (admin FIRST-RELEASE §11b): products and collections as staff change them, sent
// whole on Save. The API checks it again as a merchant's import would (CATALOG-DESIGN K13a).

const words = messages.storeCategories.editor

export const maxProducts = 50
export const maxCollections = 10

export interface DraftPhoto {
  ref: string
  previewUrl: string | null
}

export interface DraftProduct {
  /** React's key only; a product has no id until it's in a store. */
  key: string
  name: string
  description: string
  sku: string
  price: string
  stock: string
  visible: boolean
  photo: DraftPhoto | null
  collections: string[]
}

export interface SampleDraft {
  currency: string
  products: DraftProduct[]
  collections: string[]
}

let next = 0
const keyOf = () => `p${++next}`

export const emptyProduct = (collections: readonly string[]): DraftProduct => ({
  key: keyOf(),
  name: '',
  description: '',
  sku: '',
  price: '',
  stock: '10',
  visible: true,
  photo: null,
  collections: collections.slice(0, 1),
})

export const draftOf = (detail: SampleDetail | null, fallbackCurrency = 'INR'): SampleDraft => ({
  currency: detail?.currency ?? fallbackCurrency,
  collections: detail?.collections.map((c) => c.name) ?? [],
  products:
    detail?.products.map((p) => ({
      key: keyOf(),
      name: p.name,
      description: p.description,
      sku: p.sku,
      price: p.price,
      stock: p.stock === null ? '' : String(p.stock),
      visible: p.visible,
      photo: p.photo,
      collections: p.collections,
    })) ?? [],
})

export const putProduct = (draft: SampleDraft, product: DraftProduct): SampleDraft => {
  const at = draft.products.findIndex((p) => p.key === product.key)
  return { ...draft, products: at < 0 ? [...draft.products, product] : draft.products.map((p, i) => (i === at ? product : p)) }
}

export const dropProduct = (draft: SampleDraft, key: string): SampleDraft => ({ ...draft, products: draft.products.filter((p) => p.key !== key) })

export const addCollection = (draft: SampleDraft, name: string): SampleDraft => ({ ...draft, collections: [...draft.collections, name.trim()] })

/** A rename follows into every product in it. */
export const renameCollection = (draft: SampleDraft, from: string, to: string): SampleDraft => {
  const name = to.trim()
  return {
    ...draft,
    collections: draft.collections.map((c) => (c === from ? name : c)),
    products: draft.products.map((p) => ({ ...p, collections: p.collections.map((c) => (c === from ? name : c)) })),
  }
}

/** Deleting a collection takes it off every product; the products stay. */
export const dropCollection = (draft: SampleDraft, name: string): SampleDraft => ({
  ...draft,
  collections: draft.collections.filter((c) => c !== name),
  products: draft.products.map((p) => ({ ...p, collections: p.collections.filter((c) => c !== name) })),
})

export const productsIn = (draft: SampleDraft, name: string): number => draft.products.filter((p) => p.collections.includes(name)).length

/** Why a collection name won't do, or null. */
export const collectionProblem = (draft: SampleDraft, name: string, renaming: string | null = null): string | null => {
  const trimmed = name.trim()
  if (trimmed === '') return words.collectionRequired
  if (trimmed.length > 100) return words.collectionTooLong
  if (draft.collections.some((c) => c !== renaming && c.toLowerCase() === trimmed.toLowerCase())) return words.collectionTaken
  return null
}

/** Why the product form won't do yet, or null: the API checks the same again. */
export const productProblem = (draft: SampleDraft, product: DraftProduct): string | null => {
  if (product.name.trim() === '') return words.nameRequired
  if (product.sku.trim() === '') return words.skuRequired
  if (draft.products.some((p) => p.key !== product.key && p.sku.trim().toLowerCase() === product.sku.trim().toLowerCase())) return words.skuTaken
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(product.price.trim())) return words.priceInvalid
  if (product.stock.trim() !== '' && !/^\d{1,7}$/.test(product.stock.trim())) return words.stockInvalid
  if (product.collections.length === 0) return words.collectionNeeded
  return null
}

/** Why the whole sample can't be saved yet, or null. */
export const draftProblem = (draft: SampleDraft): string | null => {
  if (draft.products.length === 0) return words.noProducts
  if (draft.collections.length === 0) return words.noCollections
  const empty = draft.collections.find((c) => productsIn(draft, c) === 0)
  if (empty !== undefined) return words.emptyCollection.replace('{name}', empty)
  if (!/^[A-Z]{3}$/.test(draft.currency)) return words.currencyInvalid
  return null
}

export const inputOf = (draft: SampleDraft): SampleItemsInput => ({
  currency: draft.currency,
  collections: draft.collections,
  products: draft.products.map((p) => ({
    name: p.name.trim(),
    description: p.description.trim(),
    sku: p.sku.trim(),
    price: p.price.trim(),
    stock: p.stock.trim() === '' ? null : Number(p.stock.trim()),
    visible: p.visible,
    photo: p.photo?.ref ?? null,
    collections: p.collections,
  })),
})

/** Whether the draft differs from what was loaded, for the leave guard. */
export const sameDraft = (a: SampleDraft, b: SampleDraft): boolean => JSON.stringify(inputOf(a)) === JSON.stringify(inputOf(b))
