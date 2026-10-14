import type { EditorProduct, EditorVersion, ProductInput } from '../../../api/products'
import type { StockLevel } from '../../../api/inventory'
import { minorOf, moneyText } from '../../../format'

// A product as the phone's form edits it (FIRST-RELEASE.md §11): text as typed, so a half-typed price is kept, and the versions
// as combinations of the choices. Whatever the phone doesn't edit travels in `carried` and goes back as it came, because a save
// writes every field it names (apps/api src/engine/modules/catalog/index.ts `update`). The API checks it all again.

export const maxOptions = 3
export const maxVersions = 100
/** The API's limit (CATALOG-DESIGN.md F); `TOO_MANY_PHOTOS` says it again. */
export const maxPhotos = 20

export type DraftOption = { id: string | null; name: string; values: { id: string | null; name: string }[] }

type VersionCarry = Pick<EditorVersion, 'barcode' | 'name' | 'weightGrams' | 'lengthMm' | 'widthMm' | 'heightMm' | 'hsCode' | 'customsDescription' | 'taxClassId' | 'trackStock' | 'continueSelling'> & {
  otherPrices: { currency: string; amount: string; compareAtAmount: string | null }[]
  otherCost: { amount: string; currency: string } | null
}

export type DraftVersion = {
  id: string | null
  /** One value name per option, in the options' order; none for a product without choices. */
  choices: string[]
  price: string
  compareAt: string
  cost: string
  sku: string
  visible: boolean
  /** "We don't make this": left out of the save, and back with "Add back". */
  removed: boolean
  carry: VersionCarry
}

type PhotoStatus = 'ready' | 'uploading' | 'failed'

export type DraftPhoto = {
  key: string
  assetId: string | null
  /** The API's path to a saved photo, or the phone's own file while it uploads. */
  path: string | null
  localUri: string | null
  alt: string
  /** The version this photo shows, by its choices, or null for the product's own. */
  versionChoices: string[] | null
  status: PhotoStatus
  /** The API's refusal when `failed`. */
  code: string | null
}

type ProductCarry = Pick<EditorProduct, 'productType' | 'category' | 'warrantyText' | 'returnsText' | 'seoTitle' | 'seoDescription' | 'slug'>

export type Draft = {
  name: string
  description: string
  visible: boolean
  options: DraftOption[]
  versions: DraftVersion[]
  photos: DraftPhoto[]
  /** Quantities as typed, by version key then location id; saved with `setStock` after the product. */
  stock: Record<string, Record<string, string>>
  carry: ProductCarry
}

const keyOf = (choices: readonly string[]) => choices.map((choice) => choice.toLowerCase()).join('\u0000')

/** A version's key in `stock` and for its photos: its choices, whatever their case, so it holds across "Update versions". */
export const versionKey = keyOf

const noCarry: VersionCarry = { barcode: null, name: null, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsCode: null, customsDescription: null, taxClassId: null, trackStock: true, continueSelling: false, otherPrices: [], otherCost: null }

const blankVersion = (choices: string[], like?: DraftVersion): DraftVersion => ({
  id: null,
  choices,
  price: like?.price ?? '',
  compareAt: like?.compareAt ?? '',
  cost: like?.cost ?? '',
  sku: '',
  visible: true,
  removed: false,
  // A new version takes its siblings' shipping and tax; never their product code or barcode, which are unique.
  carry: like ? { ...like.carry, barcode: null, name: null, otherPrices: [] } : noCarry,
})

export const blankDraft = (): Draft => ({
  name: '',
  description: '',
  visible: true,
  options: [],
  versions: [blankVersion([])],
  photos: [],
  stock: {},
  carry: { productType: 'physical', category: null, warrantyText: null, returnsText: null, seoTitle: null, seoDescription: null, slug: '' },
})

const textOf = (amount: string | null | undefined, currency: string) => (amount ? moneyText({ amount, currency }) : '')

export const draftOf = (product: EditorProduct, currency: string, levels: ReadonlyMap<string, readonly StockLevel[]> = new Map()): Draft => {
  const versions = product.versions.map((version): DraftVersion => {
    const own = version.prices.find((price) => price.currency === currency)
    return {
      id: version.id,
      choices: version.choices,
      price: textOf(own?.amount, currency),
      compareAt: textOf(own?.compareAtAmount, currency),
      cost: version.cost && version.cost.currency === currency ? textOf(version.cost.amount, currency) : '',
      sku: version.sku ?? '',
      visible: version.visible,
      removed: false,
      carry: {
        barcode: version.barcode,
        name: version.name,
        weightGrams: version.weightGrams,
        lengthMm: version.lengthMm,
        widthMm: version.widthMm,
        heightMm: version.heightMm,
        hsCode: version.hsCode,
        customsDescription: version.customsDescription,
        taxClassId: version.taxClassId,
        trackStock: version.trackStock,
        continueSelling: version.continueSelling,
        otherPrices: version.prices.filter((price) => price.currency !== currency),
        otherCost: version.cost && version.cost.currency !== currency ? version.cost : null,
      },
    }
  })
  return {
    name: product.name,
    description: product.description,
    visible: product.visible,
    options: product.options.map((option) => ({ id: option.id, name: option.name, values: option.values.map((value) => ({ id: value.id, name: value.name })) })),
    versions: versions.length > 0 ? versions : [blankVersion([])],
    photos: product.photos.map((photo) => ({
      key: photo.id,
      assetId: photo.assetId,
      path: photo.url,
      localUri: null,
      alt: photo.alt ?? '',
      versionChoices: photo.versionId ? (product.versions.find((version) => version.id === photo.versionId)?.choices ?? null) : null,
      status: 'ready',
      code: null,
    })),
    stock: Object.fromEntries(product.versions.map((version) => [keyOf(version.choices), Object.fromEntries((levels.get(version.id) ?? []).map((level) => [level.warehouseId, String(level.onHand)]))])),
    carry: { productType: product.productType, category: product.category, warrantyText: product.warrantyText, returnsText: product.returnsText, seoTitle: product.seoTitle, seoDescription: product.seoDescription, slug: product.slug },
  }
}

/** Whole units, 0 to a million, as typed; empty is "not counted here". */
export const quantityOf = (text: string): number | null | 'invalid' => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  return /^\d{1,7}$/.test(trimmed) && Number(trimmed) <= 1_000_000 ? Number(trimmed) : 'invalid'
}

/** The typed quantities that differ from `saved`, for versions that now have an id. */
export const stockChangesOf = (draft: Draft, saved: Draft, idOf: (key: string) => string | undefined): { versionId: string; warehouseId: string; quantity: number }[] =>
  draft.versions
    .filter((version) => !version.removed)
    .flatMap((version) => {
      const key = keyOf(version.choices)
      const versionId = idOf(key)
      if (!versionId) return []
      return Object.entries(draft.stock[key] ?? {}).flatMap(([warehouseId, text]) => {
        const quantity = quantityOf(text)
        return typeof quantity === 'number' && text !== saved.stock[key]?.[warehouseId] ? [{ versionId, warehouseId, quantity }] : []
      })
    })

/** Every combination of the options' values, in their order: what "Create versions" makes. */
export const combinationsOf = (options: readonly DraftOption[]): string[][] =>
  options.reduce<string[][]>((acc, option) => acc.flatMap((combo) => option.values.map((value) => [...combo, value.name])), [[]])

/** How many versions the options make, 0 while any kind has no choice yet. */
export const versionCountOf = (options: readonly DraftOption[]): number => (options.length === 0 || options.some((option) => option.values.length === 0) ? 0 : combinationsOf(options).length)

/** The versions the options now make: kept where they match, new ones priced like the first, the rest dropped. */
export const syncVersions = (draft: Draft): DraftVersion[] => {
  if (draft.options.length === 0) return [draft.versions.find((version) => version.choices.length === 0) ?? blankVersion([], draft.versions[0])]
  const existing = new Map(draft.versions.map((version) => [keyOf(version.choices), version]))
  const template = draft.versions.find((version) => !version.removed)
  return combinationsOf(draft.options).map((choices) => {
    const kept = existing.get(keyOf(choices))
    return kept ? { ...kept, choices } : blankVersion(choices, template)
  })
}

/** How many versions "Update versions" would add. */
export const newVersionCount = (draft: Draft): number => {
  if (versionCountOf(draft.options) === 0) return 0
  const existing = new Set(draft.versions.map((version) => keyOf(version.choices)))
  return combinationsOf(draft.options).filter((choices) => !existing.has(keyOf(choices))).length
}

/** The live versions (not "We don't make this"). */
export const liveVersions = (draft: Draft): DraftVersion[] => draft.versions.filter((version) => !version.removed)

export type DraftProblem = 'name' | 'price' | 'compare' | 'cost' | 'options' | 'versions' | 'tooMany' | 'stock' | 'photosBusy'

/** What stops a save, in the order the form shows it; the API checks it all again. A free product is asked about, not refused. */
export const problemsOf = (draft: Draft, currency: string): DraftProblem[] => {
  const live = liveVersions(draft)
  const problems: DraftProblem[] = []
  if (draft.name.trim() === '') problems.push('name')
  const priced = live.map((version) => minorOf(version.price, currency))
  if (live.length === 0) problems.push('versions')
  const optioned = draft.options.length > 0
  if (priced.some((price) => price === null || price === 'invalid' || (optioned && price === '0'))) problems.push('price')
  const lowCompare = live.some((version, i) => {
    const compare = minorOf(version.compareAt, currency)
    const price = priced[i]
    return compare === 'invalid' || (typeof compare === 'string' && typeof price === 'string' && BigInt(compare) <= BigInt(price))
  })
  if (lowCompare) problems.push('compare')
  if (live.some((version) => minorOf(version.cost, currency) === 'invalid')) problems.push('cost')
  const names = draft.options.map((option) => option.name.trim().toLowerCase())
  if (draft.options.length > maxOptions || names.some((name) => name === '') || new Set(names).size !== names.length || draft.options.some((option) => option.values.length === 0)) problems.push('options')
  if (live.length > 0 && (live.some((version) => version.choices.length !== draft.options.length) || newVersionCount(draft) > 0)) problems.push('versions')
  if (versionCountOf(draft.options) > maxVersions) problems.push('tooMany')
  if (live.some((version) => Object.values(draft.stock[keyOf(version.choices)] ?? {}).some((text) => quantityOf(text) === 'invalid'))) problems.push('stock')
  if (draft.photos.some((photo) => photo.status === 'uploading')) problems.push('photosBusy')
  return problems
}

/** Whether saving would leave the product "Visible" with every version hidden. */
export const hidesEveryVersion = (draft: Draft): boolean => {
  const live = liveVersions(draft)
  return draft.visible && live.length > 0 && live.every((version) => !version.visible)
}

/** A product with one version and no price typed or 0: the sheet asks "Selling for free?" before saving it. */
export const isFree = (draft: Draft, currency: string): boolean => {
  const live = liveVersions(draft)
  return live.length === 1 && minorOf(live[0]?.price ?? '', currency) === '0'
}

const amountOf = (text: string, currency: string): string | null => {
  const minor = minorOf(text, currency)
  return typeof minor === 'string' ? minor : null
}

/**
 * The save's input. A supplier never sends what's the store's to set (visibility, tax category, prices in other currencies);
 * a merchant's other-currency prices and cost go back as they came, since Markets sets them. Sections the phone doesn't edit
 * (listing, filters, size chart, video) are left out, which keeps them as the product has them.
 */
export const inputOf = (draft: Draft, currency: string, side: 'merchant' | 'supplier', isNew: boolean): ProductInput => {
  const live = liveVersions(draft)
  const indexOf = (choices: string[] | null) => (choices === null ? -1 : live.findIndex((version) => keyOf(version.choices) === keyOf(choices)))
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    productType: draft.carry.productType,
    ...(side === 'merchant' ? { visible: draft.visible } : {}),
    ...(isNew ? {} : { slug: draft.carry.slug }),
    category: draft.carry.category,
    warrantyText: draft.carry.warrantyText,
    returnsText: draft.carry.returnsText,
    seoTitle: draft.carry.seoTitle,
    seoDescription: draft.carry.seoDescription,
    options: draft.options.map((option) => ({ ...(option.id ? { id: option.id } : {}), name: option.name.trim(), values: option.values.map((value) => ({ ...(value.id ? { id: value.id } : {}), name: value.name })) })),
    versions: live.map((version) => {
      const compareAt = amountOf(version.compareAt, currency)
      const cost = amountOf(version.cost, currency)
      return {
        ...(version.id ? { id: version.id } : {}),
        choices: version.choices,
        name: version.carry.name,
        sku: version.sku.trim() || null,
        barcode: version.carry.barcode,
        visible: version.visible,
        prices: [
          { currency, amount: amountOf(version.price, currency) ?? '0', ...(compareAt ? { compareAtAmount: compareAt } : {}) },
          ...(side === 'merchant' ? version.carry.otherPrices.map((price) => ({ currency: price.currency, amount: price.amount, ...(price.compareAtAmount ? { compareAtAmount: price.compareAtAmount } : {}) })) : []),
        ],
        ...(cost ? { cost: { currency, amount: cost } } : version.cost.trim() === '' && version.carry.otherCost ? { cost: version.carry.otherCost } : {}),
        weightGrams: version.carry.weightGrams,
        lengthMm: version.carry.lengthMm,
        widthMm: version.carry.widthMm,
        heightMm: version.carry.heightMm,
        hsCode: version.carry.hsCode,
        customsDescription: version.carry.customsDescription,
        ...(side === 'merchant' ? { taxClassId: version.carry.taxClassId } : {}),
        trackStock: version.carry.trackStock,
        continueSelling: version.carry.continueSelling,
      }
    }),
    // A photo of a version no longer made goes with it; one still uploading or that failed is not sent.
    photos: draft.photos.flatMap((photo) => {
      if (photo.status !== 'ready' || photo.assetId === null) return []
      const at = indexOf(photo.versionChoices)
      if (photo.versionChoices !== null && at < 0) return []
      return [{ assetId: photo.assetId, ...(photo.alt.trim() ? { alt: photo.alt.trim() } : {}), ...(at >= 0 ? { version: at } : {}) }]
    }),
  }
}

/** Unsaved when it differs from what was loaded, or from a blank form. */
export const isDirty = (draft: Draft, saved: Draft): boolean => JSON.stringify(draft) !== JSON.stringify(saved)

// The stock typed for each version follows it when its choices change: a version's key is its choices.
const restock = (stock: Draft['stock'], before: readonly DraftVersion[], after: readonly DraftVersion[]): Draft['stock'] =>
  Object.fromEntries(
    after.flatMap((version, i) => {
      const counts = before[i] ? stock[keyOf((before[i] as DraftVersion).choices)] : undefined
      return counts ? [[keyOf(version.choices), counts] as const] : []
    }),
  )

const without = <T>(items: readonly T[], at: number): T[] => items.filter((_, i) => i !== at)

/** A kind of choice moves one place up; every version's choices, and its typed stock, follow. */
export const moveOptionUp = (draft: Draft, at: number): Draft => {
  if (at <= 0 || at >= draft.options.length) return draft
  const swap = <T>(items: readonly T[]): T[] => items.map((item, i) => (i === at - 1 ? (items[at] as T) : i === at ? (items[at - 1] as T) : item))
  const versions = draft.versions.map((version) => (version.choices.length === draft.options.length ? { ...version, choices: swap(version.choices) } : version))
  return { ...draft, options: swap(draft.options), versions, stock: restock(draft.stock, draft.versions, versions) }
}

/** A new kind of choice on versions that already exist: they all take `firstChoice` (CATALOG-DESIGN.md D8). */
export const addKindToVersions = (draft: Draft, name: string, firstChoice: string): Draft => {
  const versions = draft.versions.map((version) => ({ ...version, choices: [...version.choices, firstChoice] }))
  return { ...draft, options: [...draft.options, { id: null, name, values: [{ id: null, name: firstChoice }] }], versions, stock: restock(draft.stock, draft.versions, versions) }
}

/** The live versions that carry this choice of the kind at `at`. */
export const versionsWith = (draft: Draft, at: number, choice: string): DraftVersion[] => liveVersions(draft).filter((version) => version.choices[at] === choice)

/** A choice removed with the versions that had it (CATALOG-DESIGN.md D7). */
export const removeChoice = (draft: Draft, at: number, choice: string): Draft => {
  const gone = new Set(draft.versions.filter((version) => version.choices[at] === choice).map((version) => keyOf(version.choices)))
  return {
    ...draft,
    options: draft.options.map((option, i) => (i === at ? { ...option, values: option.values.filter((value) => value.name !== choice) } : option)),
    versions: draft.versions.filter((version) => version.choices[at] !== choice),
    stock: Object.fromEntries(Object.entries(draft.stock).filter(([key]) => !gone.has(key))),
  }
}

const quantity = (text: string | undefined): number => {
  const parsed = quantityOf(text ?? '')
  return typeof parsed === 'number' ? parsed : 0
}

/** A whole kind of choice removed: versions that now match merge, keeping the first one's price and adding the typed stock (D9). */
export const removeKind = (draft: Draft, at: number): Draft => {
  const groups = new Map<string, DraftVersion[]>()
  for (const version of liveVersions(draft)) {
    const key = keyOf(without(version.choices, at))
    groups.set(key, [...(groups.get(key) ?? []), version])
  }
  const merged = [...groups.values()].map((group) => ({ ...(group[0] as DraftVersion), choices: without((group[0] as DraftVersion).choices, at) }))
  const stock = Object.fromEntries(
    [...groups.values()].map((group) => {
      const totals: Record<string, number> = {}
      for (const version of group) for (const [warehouseId, text] of Object.entries(draft.stock[keyOf(version.choices)] ?? {})) if (text.trim() !== '') totals[warehouseId] = (totals[warehouseId] ?? 0) + quantity(text)
      return [keyOf(without((group[0] as DraftVersion).choices, at)), Object.fromEntries(Object.entries(totals).map(([warehouseId, total]) => [warehouseId, String(total)]))]
    }),
  )
  return { ...draft, options: without(draft.options, at), versions: merged.length > 0 ? merged : [blankVersion([])], stock }
}

/** Whether versions have been made from the choices (rather than a single version with none). */
export const versionsMade = (draft: Draft): boolean => draft.options.length > 0 && draft.versions.some((version) => !version.removed && version.choices.length > 0)
