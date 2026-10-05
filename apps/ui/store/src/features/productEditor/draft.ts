import { minorOf, moneyText } from '@dripfunnel/shared/format'
import type { EditorProduct, ProductInput } from '../../api/productEditor'
import type { StockLevel } from '../../api/stock'

// The editor's draft (CatEditor): text as typed, so a half-typed price is kept until it is saved, and the
// product's versions as combinations of its choices. The API checks everything again on save.

export const productKinds = ['physical', 'digital', 'service', 'gift_card'] as const
export type ProductKind = (typeof productKinds)[number]

export const maxOptions = 3
export const maxVersions = 100

export interface DraftOption {
  id: string | null
  name: string
  values: { id: string | null; name: string }[]
}

export interface DraftVersion {
  id: string | null
  /** One value name per option, in the options' order; none for a product without choices. */
  choices: string[]
  price: string
  compareAt: string
  cost: string
  sku: string
  visible: boolean
  /** "We don't make this": left out of the save, and back with "Add back" (CatEditor). */
  removed: boolean
  /** Prices in other currencies, kept as they were: Markets sets them (#296). */
  otherPrices: { currency: string; amount: string; compareAtAmount: string | null }[]
  weightGrams: number | null
  lengthMm: number | null
  widthMm: number | null
  heightMm: number | null
  hsCode: string | null
  taxClassId: string | null
}

export interface DraftPhoto {
  assetId: string
  url: string
  alt: string
  /** The version this photo shows, by its choices, or null for the product's own photos. */
  versionChoices: string[] | null
}

export interface Draft {
  name: string
  description: string
  kind: ProductKind
  visible: boolean
  slug: string
  seoTitle: string
  seoDescription: string
  options: DraftOption[]
  versions: DraftVersion[]
  photos: DraftPhoto[]
  /** Shipping, as the prototype edits it once for the product: weight, box and the customs code. */
  weight: string
  box: string
  hsCode: string
  taxClassId: string | null
  /** Stock as typed, by version (versionKey) and then location id; saved with setStock after the product. */
  stock: Record<string, Record<string, string>>
}

const keyOf = (choices: readonly string[]) => choices.map((c) => c.toLowerCase()).join('\u0000')

/** A version's key in `stock`: its choices, whatever their case, so it holds across "Update versions". */
export const versionKey = keyOf

const blankVersion = (choices: string[], from?: DraftVersion): DraftVersion => ({
  id: null,
  choices,
  price: from?.price ?? '',
  compareAt: from?.compareAt ?? '',
  cost: from?.cost ?? '',
  sku: '',
  visible: true,
  removed: false,
  otherPrices: [],
  weightGrams: from?.weightGrams ?? null,
  lengthMm: from?.lengthMm ?? null,
  widthMm: from?.widthMm ?? null,
  heightMm: from?.heightMm ?? null,
  hsCode: from?.hsCode ?? null,
  taxClassId: from?.taxClassId ?? null,
})

export const blankDraft = (): Draft => ({
  name: '',
  description: '',
  kind: 'physical',
  visible: true,
  slug: '',
  seoTitle: '',
  seoDescription: '',
  options: [],
  versions: [blankVersion([])],
  photos: [],
  weight: '',
  box: '',
  hsCode: '',
  taxClassId: null,
  stock: {},
})

const isKind = (value: string): value is ProductKind => (productKinds as readonly string[]).includes(value)

/** Grams as typed: kilograms with up to three decimals ("0.4"), or nothing. */
export const gramsOf = (text: string): number | null | 'invalid' => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d{1,4}(\.\d{1,3})?$/.test(trimmed)) return 'invalid'
  return Math.round(Number(trimmed) * 1000)
}

/** "25 × 20 × 3" in centimetres to millimetres, each side; nothing for an empty box. */
export const boxOf = (text: string): [number, number, number] | null | 'invalid' => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const sides = trimmed.split(/\s*[x×*]\s*/i)
  if (sides.length !== 3 || !sides.every((s) => /^\d{1,4}(\.\d)?$/.test(s))) return 'invalid'
  const [l = 0, w = 0, h = 0] = sides.map((s) => Math.round(Number(s) * 10))
  return [l, w, h]
}

const boxText = (v: { lengthMm: number | null; widthMm: number | null; heightMm: number | null } | undefined) =>
  v && v.lengthMm !== null && v.widthMm !== null && v.heightMm !== null ? [v.lengthMm, v.widthMm, v.heightMm].map((mm) => String(mm / 10)).join(' × ') : ''

const textOf = (amount: string | null | undefined, currency: string) => (amount ? moneyText({ amount: Number(amount), currency }) : '')

export const draftOf = (product: EditorProduct, currency: string, levels: ReadonlyMap<string, readonly StockLevel[]> = new Map()): Draft => {
  const versions = product.versions.map((v): DraftVersion => {
    const own = v.prices.find((p) => p.currency === currency)
    return {
      id: v.id,
      choices: v.choices,
      price: textOf(own?.amount, currency),
      compareAt: textOf(own?.compareAtAmount, currency),
      cost: v.cost && v.cost.currency === currency ? textOf(v.cost.amount, currency) : '',
      sku: v.sku ?? '',
      visible: v.visible,
      removed: false,
      otherPrices: v.prices.filter((p) => p.currency !== currency),
      weightGrams: v.weightGrams,
      lengthMm: v.lengthMm,
      widthMm: v.widthMm,
      heightMm: v.heightMm,
      hsCode: v.hsCode,
      taxClassId: v.taxClassId,
    }
  })
  const first = product.versions[0]
  return {
    name: product.name,
    description: product.description,
    kind: isKind(product.productType) ? product.productType : 'physical',
    visible: product.visible,
    slug: product.slug,
    seoTitle: product.seoTitle ?? '',
    seoDescription: product.seoDescription ?? '',
    options: product.options.map((o) => ({ id: o.id, name: o.name, values: o.values.map((v) => ({ id: v.id, name: v.name })) })),
    versions: versions.length > 0 ? versions : [blankVersion([])],
    photos: product.photos.map((p) => ({ assetId: p.assetId, url: p.url, alt: p.alt ?? '', versionChoices: p.versionId ? (product.versions.find((v) => v.id === p.versionId)?.choices ?? null) : null })),
    weight: first?.weightGrams ? String(first.weightGrams / 1000) : '',
    box: boxText(first),
    hsCode: first?.hsCode ?? '',
    taxClassId: first?.taxClassId ?? null,
    stock: Object.fromEntries(product.versions.map((v) => [keyOf(v.choices), Object.fromEntries((levels.get(v.id) ?? []).map((l) => [l.warehouseId, String(l.onHand)]))])),
  }
}

/** Whole units, 0 to a million, as typed; empty is "not counted here". */
export const quantityOf = (text: string): number | null | 'invalid' => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  return /^\d{1,7}$/.test(trimmed) && Number(trimmed) <= 1_000_000 ? Number(trimmed) : 'invalid'
}

/** The typed quantities that changed since the last save, for versions that now have an id. */
export const stockChangesOf = (draft: Draft, saved: Draft, idOf: (key: string) => string | undefined): { versionId: string; warehouseId: string; quantity: number }[] =>
  draft.versions
    .filter((v) => !v.removed)
    .flatMap((v) => {
      const key = keyOf(v.choices)
      const versionId = idOf(key)
      if (!versionId) return []
      return Object.entries(draft.stock[key] ?? {}).flatMap(([warehouseId, text]) => {
        const quantity = quantityOf(text)
        return typeof quantity === 'number' && text !== saved.stock[key]?.[warehouseId] ? [{ versionId, warehouseId, quantity }] : []
      })
    })

/** Every combination of the options' values, in their order: what "Create versions" makes. */
export const combinationsOf = (options: readonly DraftOption[]): string[][] =>
  options.reduce<string[][]>((acc, option) => acc.flatMap((combo) => option.values.map((v) => [...combo, v.name])), [[]])

/** The versions the options now make: kept where they match, new ones priced like the first, the rest dropped. */
export const syncVersions = (draft: Draft): DraftVersion[] => {
  if (draft.options.length === 0) return [draft.versions.find((v) => v.choices.length === 0) ?? { ...blankVersion([], draft.versions[0]), id: draft.versions[0]?.id ?? null }]
  const existing = new Map(draft.versions.map((v) => [keyOf(v.choices), v]))
  const template = draft.versions.find((v) => !v.removed)
  return combinationsOf(draft.options).map((choices) => {
    const kept = existing.get(keyOf(choices))
    return kept ? { ...kept, choices } : blankVersion(choices, template)
  })
}

/** How many versions "Update versions" would add. */
export const newVersionCount = (draft: Draft): number => {
  if (draft.options.length === 0) return 0
  const existing = new Set(draft.versions.map((v) => keyOf(v.choices)))
  return combinationsOf(draft.options).filter((c) => !existing.has(keyOf(c))).length
}

export type DraftProblem = 'name' | 'price' | 'compare' | 'cost' | 'options' | 'versions' | 'tooMany' | 'weight' | 'box' | 'stock'

/** What stops a save, in the order the form shows it; the API checks it all again. */
export const problemsOf = (draft: Draft, currency: string): DraftProblem[] => {
  const live = draft.versions.filter((v) => !v.removed)
  const problems: DraftProblem[] = []
  if (draft.name.trim() === '') problems.push('name')
  const priced = live.map((v) => minorOf(v.price, currency))
  if (live.length === 0) problems.push('versions')
  if (priced.some((p) => p === null || p === 'invalid' || p <= 0)) problems.push('price')
  if (live.some((v, i) => { const at = minorOf(v.compareAt, currency); const p = priced[i]; return at === 'invalid' || (typeof at === 'number' && typeof p === 'number' && at <= p) })) problems.push('compare')
  if (live.some((v) => minorOf(v.cost, currency) === 'invalid')) problems.push('cost')
  const names = draft.options.map((o) => o.name.trim().toLowerCase())
  if (draft.options.length > maxOptions || names.some((n) => n === '') || new Set(names).size !== names.length || draft.options.some((o) => o.values.length === 0)) problems.push('options')
  // Choices changed since the versions were made: "Update versions" first, as the prototype asks.
  if (live.length > 0 && (live.some((v) => v.choices.length !== draft.options.length) || newVersionCount(draft) > 0)) problems.push('versions')
  if (combinationsOf(draft.options).length > maxVersions) problems.push('tooMany')
  if (gramsOf(draft.weight) === 'invalid') problems.push('weight')
  if (boxOf(draft.box) === 'invalid') problems.push('box')
  if (live.some((v) => Object.values(draft.stock[keyOf(v.choices)] ?? {}).some((t) => quantityOf(t) === 'invalid'))) problems.push('stock')
  return problems
}

const amount = (text: string, currency: string): string | null => {
  const minor = minorOf(text, currency)
  return typeof minor === 'number' ? String(minor) : null
}

/**
 * The save's input. A supplier never sends what's the store's to set (visibility, tax category); the price
 * in other currencies goes back as it came, since Markets sets those (#296).
 */
export const inputOf = (draft: Draft, currency: string, side: 'merchant' | 'supplier'): ProductInput => {
  const live = draft.versions.filter((v) => !v.removed)
  const grams = gramsOf(draft.weight)
  const box = boxOf(draft.box)
  const physical = draft.kind === 'physical'
  const versions = live.map((v) => {
    const price = amount(v.price, currency) ?? '0'
    const compareAt = amount(v.compareAt, currency)
    const cost = amount(v.cost, currency)
    return {
      ...(v.id ? { id: v.id } : {}),
      choices: v.choices,
      sku: v.sku.trim() || null,
      visible: v.visible,
      prices: [{ currency, amount: price, ...(compareAt ? { compareAtAmount: compareAt } : {}) }, ...v.otherPrices.map((p) => ({ currency: p.currency, amount: p.amount, ...(p.compareAtAmount ? { compareAtAmount: p.compareAtAmount } : {}) }))],
      ...(cost ? { cost: { currency, amount: cost } } : {}),
      weightGrams: physical && typeof grams === 'number' ? grams : null,
      lengthMm: physical && Array.isArray(box) ? box[0] : null,
      widthMm: physical && Array.isArray(box) ? box[1] : null,
      heightMm: physical && Array.isArray(box) ? box[2] : null,
      hsCode: physical ? draft.hsCode.trim() || null : null,
      ...(side === 'merchant' ? { taxClassId: draft.taxClassId } : {}),
    }
  })
  const indexOf = (choices: string[] | null) => (choices === null ? -1 : live.findIndex((v) => keyOf(v.choices) === keyOf(choices)))
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    productType: draft.kind,
    ...(side === 'merchant' ? { visible: draft.visible } : {}),
    ...(draft.slug.trim() ? { slug: draft.slug.trim() } : {}),
    seoTitle: draft.seoTitle.trim(),
    seoDescription: draft.seoDescription.trim(),
    options: draft.options.map((o) => ({ ...(o.id ? { id: o.id } : {}), name: o.name.trim(), values: o.values.map((v) => ({ ...(v.id ? { id: v.id } : {}), name: v.name })) })),
    versions,
    // A photo of a version no longer made goes with it.
    photos: draft.photos.flatMap((p) => {
      const at = indexOf(p.versionChoices)
      if (p.versionChoices !== null && at < 0) return []
      return [{ assetId: p.assetId, ...(p.alt.trim() ? { alt: p.alt.trim() } : {}), ...(at >= 0 ? { version: at } : {}) }]
    }),
  }
}

/** Unsaved when it differs from what was loaded (or from a blank form). */
export const isDirty = (draft: Draft, saved: Draft): boolean => JSON.stringify(draft) !== JSON.stringify(saved)

/** The lowest and highest price among the versions made, in minor units, for the preview. */
export const priceRange = (draft: Draft, currency: string): { low: number; high: number } | null => {
  const prices = draft.versions.filter((v) => !v.removed).map((v) => minorOf(v.price, currency)).filter((p): p is number => typeof p === 'number' && p > 0)
  return prices.length === 0 ? null : { low: Math.min(...prices), high: Math.max(...prices) }
}
