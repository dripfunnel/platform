import { minorOf, moneyText } from '@dripfunnel/shared/format'
import type { EditorProduct, ProductInput } from '../../api/productEditor'

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
  /** A cost kept in another currency, sent back as it came unless a cost is typed (#389). */
  otherCost: { amount: string; currency: string } | null
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
  /**
   * Shipping, as the prototype edits it once for the product: weight and box in the store's units, and the customs
   * code. Shown when every version agrees; a field changed here goes to every version, an untouched one keeps theirs.
   */
  units: Units
  weight: string
  box: string
  hsCode: string
  shippingChanged: { weight: boolean; box: boolean; hsCode: boolean }
  taxClassId: string | null
}

const keyOf = (choices: readonly string[]) => choices.map((c) => c.toLowerCase()).join('\u0000')

const blankVersion = (choices: string[], from?: DraftVersion): DraftVersion => ({
  id: null,
  choices,
  price: from?.price ?? '',
  compareAt: from?.compareAt ?? '',
  cost: from?.cost ?? '',
  otherCost: from?.otherCost ?? null,
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

export type Units = 'metric' | 'imperial'

const unchanged = { weight: false, box: false, hsCode: false }

export const blankDraft = (units: Units = 'metric'): Draft => ({
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
  units,
  weight: '',
  box: '',
  hsCode: '',
  shippingChanged: unchanged,
  taxClassId: null,
})

const isKind = (value: string): value is ProductKind => (productKinds as readonly string[]).includes(value)

const gramsPer: Record<Units, number> = { metric: 1000, imperial: 453.59237 }
const mmPer: Record<Units, number> = { metric: 10, imperial: 25.4 }

// A decimal typed with a point or a comma, whatever the shopper's locale writes.
const decimal = (text: string, places: number): number | null => {
  const t = text.trim().replace(',', '.')
  return new RegExp(`^\\d{1,4}(\\.\\d{1,${places}})?$`).test(t) ? Number(t) : null
}

/** Grams from the weight as typed: kilograms, or pounds for an imperial store; nothing for an empty field. */
export const gramsOf = (text: string, units: Units = 'metric'): number | null | 'invalid' => {
  if (text.trim() === '') return null
  const n = decimal(text, 3)
  return n === null ? 'invalid' : Math.round(n * gramsPer[units])
}

/** "25 × 20 × 3" in centimetres, or inches for an imperial store, to millimetres each side. */
export const boxOf = (text: string, units: Units = 'metric'): [number, number, number] | null | 'invalid' => {
  if (text.trim() === '') return null
  const sides = text.trim().split(/\s*[x×*]\s*/i).map((side) => decimal(side, 1))
  if (sides.length !== 3 || sides.some((n) => n === null)) return 'invalid'
  const [l = 0, w = 0, h = 0] = sides.map((n) => Math.round((n ?? 0) * mmPer[units]))
  return [l, w, h]
}

const trimmed = (n: number, places: number) => String(Number(n.toFixed(places)))

const weightText = (grams: number | null, units: Units) => (grams === null ? '' : trimmed(grams / gramsPer[units], 3))

const boxText = (v: { lengthMm: number | null; widthMm: number | null; heightMm: number | null } | undefined, units: Units) =>
  v && v.lengthMm !== null && v.widthMm !== null && v.heightMm !== null ? [v.lengthMm, v.widthMm, v.heightMm].map((mm) => trimmed(mm / mmPer[units], 1)).join(' × ') : ''

/** The one value every version shares, or null when they differ. */
const shared = <T,>(values: readonly T[]): T | null => (values.length > 0 && values.every((v) => JSON.stringify(v) === JSON.stringify(values[0])) ? (values[0] ?? null) : null)

const textOf = (amount: string | null | undefined, currency: string) => (amount ? moneyText({ amount: Number(amount), currency }) : '')

export const draftOf = (product: EditorProduct, currency: string, units: Units = 'metric'): Draft => {
  const versions = product.versions.map((v): DraftVersion => {
    const own = v.prices.find((p) => p.currency === currency)
    return {
      id: v.id,
      choices: v.choices,
      price: textOf(own?.amount, currency),
      compareAt: textOf(own?.compareAtAmount, currency),
      cost: v.cost && v.cost.currency === currency ? textOf(v.cost.amount, currency) : '',
      otherCost: v.cost && v.cost.currency !== currency ? v.cost : null,
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
  const weights = shared(product.versions.map((v) => v.weightGrams))
  const boxes = shared(product.versions.map((v) => ({ lengthMm: v.lengthMm, widthMm: v.widthMm, heightMm: v.heightMm })))
  const codes = shared(product.versions.map((v) => v.hsCode))
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
    units,
    weight: weightText(weights, units),
    box: boxes ? boxText(boxes, units) : '',
    hsCode: codes ?? '',
    shippingChanged: unchanged,
    taxClassId: product.versions[0]?.taxClassId ?? null,
  }
}

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

export type DraftProblem = 'name' | 'price' | 'compare' | 'cost' | 'options' | 'versions' | 'tooMany' | 'weight' | 'box'

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
  if (gramsOf(draft.weight, draft.units) === 'invalid') problems.push('weight')
  if (boxOf(draft.box, draft.units) === 'invalid') problems.push('box')
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
  const grams = gramsOf(draft.weight, draft.units)
  const box = boxOf(draft.box, draft.units)
  const changed = draft.shippingChanged
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
      ...(cost ? { cost: { currency, amount: cost } } : v.cost.trim() === '' && v.otherCost ? { cost: v.otherCost } : {}),
      // A field changed here goes to every version; an untouched one keeps each version's own.
      weightGrams: !physical ? null : changed.weight ? (typeof grams === 'number' ? grams : null) : v.weightGrams,
      lengthMm: !physical ? null : changed.box ? (Array.isArray(box) ? box[0] : null) : v.lengthMm,
      widthMm: !physical ? null : changed.box ? (Array.isArray(box) ? box[1] : null) : v.widthMm,
      heightMm: !physical ? null : changed.box ? (Array.isArray(box) ? box[2] : null) : v.heightMm,
      hsCode: !physical ? null : changed.hsCode ? draft.hsCode.trim() || null : v.hsCode,
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
