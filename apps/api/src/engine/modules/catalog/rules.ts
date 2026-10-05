import { isCurrency, parseMinor } from '#core/money'
import type { ListingInput } from './listing'
import { isUuid } from '#core/ids'

// The catalogue's input rules (CATALOG-DESIGN §3 facts 1–5, 15; decided on #337): what a product must
// be before it is written. Pure, so the API and imports share them.

export const maxOptions = 3
export const maxVersions = 100
export const maxValuesPerOption = 100
export const maxPhotos = 20
export const maxFilterValues = 100

/** Refused outright (decided on #337); alcohol is allowed and carries an age check. */
export const refusedCategories = ['weapons', 'prescription_medicine', 'illegal_drugs', 'tobacco_vapes', 'adult', 'counterfeit'] as const

// A refused category is a phrase among a category's words, or the whole category on its own, so
// "Tobacco" or "Fire-arms" can't pass while "Prescription glasses" or "Hot glue guns" can.
const refusedPhrases = [
  'weapon', 'weapons', 'firearm', 'firearms', 'ammunition', 'narcotics', 'tobacco', 'cigarette', 'cigarettes', 'vape', 'vapes', 'vaping',
  'counterfeit', 'counterfeits', 'illegal drugs', 'prescription medicine', 'prescription medicines', 'prescription drugs', 'prescription medication',
  'prescription medications', 'adult content', 'adult products', 'adult toys', 'sex toys',
].map((phrase) => phrase.split(' '))
const refusedAlone = new Set(['gun', 'guns', 'adult', 'prescription', 'drugs', 'replica', 'replicas'])

/** A category in words, folded: lower case, accents gone, anything else a separator. */
const categoryWords = (category: string): string[] =>
  category
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const holds = (words: readonly string[], phrase: readonly string[]) => words.some((_, i) => phrase.every((p, j) => words[i + j] === p))

export const isRefusedCategory = (category: string): boolean => {
  const words = categoryWords(category)
  const joined = words.join('')
  return (
    refusedCategories.includes(words.join('_') as (typeof refusedCategories)[number]) ||
    (words.length === 1 && refusedAlone.has(joined)) ||
    refusedPhrases.some((phrase) => holds(words, phrase)) ||
    joined.includes('firearm')
  )
}

export const productTypes = ['physical', 'digital', 'service', 'gift_card'] as const
export type ProductType = (typeof productTypes)[number]

export interface PriceInput {
  currency: string
  amount: string
  compareAtAmount?: string | null | undefined
}

export interface VersionInput {
  id?: string | null | undefined
  /** One value name per option, in the options' order; empty for a simple product. */
  choices: readonly string[]
  sku?: string | null | undefined
  barcode?: string | null | undefined
  name?: string | null | undefined
  visible?: boolean | null | undefined
  prices: readonly PriceInput[]
  cost?: PriceInput | null | undefined
  weightGrams?: number | null | undefined
  lengthMm?: number | null | undefined
  widthMm?: number | null | undefined
  heightMm?: number | null | undefined
  hsCode?: string | null | undefined
  customsDescription?: string | null | undefined
  trackStock?: boolean | null | undefined
  continueSelling?: boolean | null | undefined
}

export interface OptionInput {
  id?: string | null | undefined
  name: string
  values: readonly { id?: string | null | undefined; name: string }[]
}

export interface PhotoInput {
  assetId: string
  alt?: string | null | undefined
  /** The version it shows, by its place in `versions`; null for the whole product. */
  version?: number | null | undefined
}

export interface FilterValueInput {
  valueId: string
  /** The version it describes, by its place in `versions`; null for the product (fact 13). */
  version?: number | null | undefined
}

export interface VideoInput {
  assetId?: string | null | undefined
  url?: string | null | undefined
}

export interface ProductInput {
  name: string
  description?: string | null | undefined
  slug?: string | null | undefined
  productType?: string | null | undefined
  category?: string | null | undefined
  visible?: boolean | null | undefined
  warrantyText?: string | null | undefined
  returnsText?: string | null | undefined
  seoTitle?: string | null | undefined
  seoDescription?: string | null | undefined
  options: readonly OptionInput[]
  versions: readonly VersionInput[]
  /** In order; the first is the main photo. Absent keeps the product's photos as they are. */
  photos?: readonly PhotoInput[] | null | undefined
  /** Absent keeps the video; `{}` with neither removes it. */
  video?: VideoInput | null | undefined
  /** Absent keeps the product's filter values. */
  filterValues?: readonly FilterValueInput[] | null | undefined
  /** The listing sections (CATALOG S); each one left out stays as it is (listing.ts). */
  listing?: ListingInput | null | undefined
  /** Absent keeps the product's chart; null removes it. */
  sizeChartId?: string | null | undefined
}

export type CatalogRefusal =
  | 'NAME_REQUIRED'
  | 'INVALID_INPUT'
  | 'CATEGORY_REFUSED'
  | 'TOO_MANY_OPTIONS'
  | 'TOO_MANY_VERSIONS'
  | 'OPTION_VALUES_REQUIRED'
  | 'DUPLICATE_OPTION'
  | 'DUPLICATE_VALUE'
  | 'VERSION_CHOICES'
  | 'DUPLICATE_VERSION'
  | 'VERSION_REQUIRED'
  | 'PRICE_REQUIRED'
  | 'INVALID_PRICE'
  | 'INVALID_BARCODE'
  | 'DUPLICATE_SKU'
  | 'TOO_MANY_PHOTOS'
  | 'INVALID_PHOTO'
  | 'INVALID_VIDEO'
  | 'INVALID_FILTER'
  | 'INVALID_LISTING'
  | 'LISTING_REFUSED'

export interface CleanPrice {
  currency: string
  amount: string
  compareAt: string | null
}

export interface CleanVersion {
  id: string | null
  choices: string[]
  sku: string | null
  barcode: string | null
  name: string | null
  visible: boolean
  prices: CleanPrice[]
  cost: { amount: string; currency: string } | null
  weightGrams: number | null
  lengthMm: number | null
  widthMm: number | null
  heightMm: number | null
  hsCode: string | null
  customsDescription: string | null
  trackStock: boolean | null
  continueSelling: boolean | null
}

export interface CleanOption {
  id: string | null
  name: string
  values: { id: string | null; name: string }[]
}

export interface CleanPhoto {
  assetId: string
  alt: string | null
  version: number | null
}

export interface CleanProduct {
  name: string
  description: string
  slug: string
  /** Whether the caller asked for this address; otherwise an update keeps the one it has (fact 15). */
  slugGiven: boolean
  productType: ProductType
  category: string | null
  visible: boolean | null
  warrantyText: string | null
  returnsText: string | null
  seoTitle: string | null
  seoDescription: string | null
  options: CleanOption[]
  versions: CleanVersion[]
  /** Null leaves the product's photos as they are. */
  photos: CleanPhoto[] | null
  /** Undefined leaves the video; null removes it. */
  video: { assetId: string | null; url: string | null } | null | undefined
  /** Null leaves the product's filter values as they are. */
  filterValues: { valueId: string; version: number | null }[] | null
}


/** A link to a video host: https, a host and a path, nothing to run (CATALOG S7). */
export const isVideoUrl = (value: string): boolean => {
  if (value.length > 500) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.includes('.') && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

const cleanPhotos = (photos: readonly PhotoInput[], versionCount: number): CleanPhoto[] | CatalogRefusal => {
  if (photos.length > maxPhotos) return 'TOO_MANY_PHOTOS'
  const seen = new Set<string>()
  const clean: CleanPhoto[] = []
  for (const p of photos) {
    if (!isUuid(p.assetId) || seen.has(p.assetId.toLowerCase())) return 'INVALID_PHOTO'
    seen.add(p.assetId.toLowerCase())
    const alt = text(p.alt, 250)
    if (alt === false) return 'INVALID_PHOTO'
    const version = p.version ?? null
    if (version !== null && (!Number.isInteger(version) || version < 0 || version >= versionCount)) return 'INVALID_PHOTO'
    clean.push({ assetId: p.assetId.toLowerCase(), alt, version })
  }
  return clean
}

const cleanVideo = (video: VideoInput | null | undefined): CleanProduct['video'] | CatalogRefusal => {
  if (video === undefined) return undefined
  if (video === null) return null
  const assetId = video.assetId?.trim() || null
  const url = video.url?.trim() || null
  if (assetId === null && url === null) return null
  if ((assetId !== null) === (url !== null)) return 'INVALID_VIDEO'
  if (assetId !== null && !isUuid(assetId)) return 'INVALID_VIDEO'
  if (url !== null && !isVideoUrl(url)) return 'INVALID_VIDEO'
  return { assetId: assetId?.toLowerCase() ?? null, url }
}

/** A web address from a name (fact 22): accents folded, lower-case words joined by hyphens. */
export const slugFrom = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/, '')

/** A supplier's web address carries a random suffix, so a clash never tells it what another supplier's is. */
export const supplierSlug = (base: string): string => `${base.slice(0, 112)}-${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')}`

/** A GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) whose check digit holds (fact 44). */
export const isBarcode = (value: string): boolean => {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false
  const digits = [...value].map(Number)
  const check = digits.pop()
  const sum = digits.reverse().reduce((total, d, i) => total + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

const text = (value: string | null | undefined, max: number): string | null | false => {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return null
  return trimmed.length <= max ? trimmed : false
}

const whole = (value: number | null | undefined, max: number): number | null | false => {
  if (value === null || value === undefined) return null
  return Number.isInteger(value) && value >= 0 && value <= max ? value : false
}

const keyOf = (name: string) => name.trim().toLowerCase()

const price = (p: PriceInput): CleanPrice | null => {
  const amount = parseMinor(p.amount, p.currency)
  if (!amount) return null
  const compareRaw = p.compareAtAmount ?? null
  if (compareRaw === null || compareRaw === '') return { currency: p.currency, amount: p.amount, compareAt: null }
  const compareAt = parseMinor(compareRaw, p.currency)
  // A "was" price below the price would mislead a shopper (fact 41).
  if (!compareAt || compareAt.amount <= amount.amount) return null
  return { currency: p.currency, amount: p.amount, compareAt: compareRaw }
}

const cleanVersion = (v: VersionInput, optionCount: number, pricingCurrency: string): CleanVersion | CatalogRefusal => {
  if (v.choices.length !== optionCount) return 'VERSION_CHOICES'
  const sku = text(v.sku, 64)
  const name = text(v.name, 255)
  const customs = text(v.customsDescription, 255)
  const barcode = text(v.barcode, 14)
  const hsCode = text(v.hsCode, 10)
  if (sku === false || name === false || customs === false || barcode === false || hsCode === false) return 'INVALID_INPUT'
  if (barcode !== null && !isBarcode(barcode)) return 'INVALID_BARCODE'
  if (hsCode !== null && !/^\d{6,10}$/.test(hsCode)) return 'INVALID_INPUT'
  const sizes = [whole(v.weightGrams, 10_000_000), whole(v.lengthMm, 100_000), whole(v.widthMm, 100_000), whole(v.heightMm, 100_000)]
  if (sizes.includes(false)) return 'INVALID_INPUT'
  const currencies = new Set<string>()
  const prices: CleanPrice[] = []
  for (const p of v.prices) {
    if (!isCurrency(p.currency) || currencies.has(p.currency)) return 'INVALID_PRICE'
    currencies.add(p.currency)
    const clean = price(p)
    if (!clean) return 'INVALID_PRICE'
    prices.push(clean)
  }
  // The pricing currency's price is required; others exist only when typed (fact 25).
  if (!currencies.has(pricingCurrency)) return 'PRICE_REQUIRED'
  let cost: CleanVersion['cost'] = null
  if (v.cost) {
    if (!parseMinor(v.cost.amount, v.cost.currency)) return 'INVALID_PRICE'
    cost = { amount: v.cost.amount, currency: v.cost.currency }
  }
  const [weightGrams, lengthMm, widthMm, heightMm] = sizes as (number | null)[]
  return {
    id: v.id ?? null,
    choices: v.choices.map((c) => c.trim()),
    sku,
    barcode,
    name,
    visible: v.visible ?? true,
    prices,
    cost,
    weightGrams: weightGrams ?? null,
    lengthMm: lengthMm ?? null,
    widthMm: widthMm ?? null,
    heightMm: heightMm ?? null,
    hsCode,
    customsDescription: customs,
    trackStock: v.trackStock ?? null,
    continueSelling: v.continueSelling ?? null,
  }
}

/**
 * The product as the engine will write it, or why not. Every product has at least one version and a
 * simple one has exactly one with no choices (fact 1); options belong to the product (fact 3); every
 * version names one value per option, no two the same combination (fact 4); 3 options, 100 versions.
 */
export const cleanProduct = (input: ProductInput, pricingCurrency: string): CleanProduct | CatalogRefusal => {
  const name = text(input.name, 255)
  if (name === null) return 'NAME_REQUIRED'
  if (name === false) return 'INVALID_INPUT'
  const description = input.description?.trim() ?? ''
  if (description.length > 20_000) return 'INVALID_INPUT'
  const productType = (productTypes as readonly string[]).includes(input.productType ?? 'physical') ? ((input.productType ?? 'physical') as ProductType) : null
  if (!productType) return 'INVALID_INPUT'
  const category = text(input.category, 120)
  if (category === false) return 'INVALID_INPUT'
  if (category !== null && isRefusedCategory(category)) return 'CATEGORY_REFUSED'
  const extras = [text(input.warrantyText, 5000), text(input.returnsText, 5000), text(input.seoTitle, 120), text(input.seoDescription, 320)]
  if (extras.includes(false)) return 'INVALID_INPUT'
  const slugGiven = Boolean(input.slug?.trim())
  const slug = slugFrom(input.slug?.trim() || name) || 'product'

  if (input.options.length > maxOptions) return 'TOO_MANY_OPTIONS'
  const options: CleanOption[] = []
  const optionNames = new Set<string>()
  for (const o of input.options) {
    const optionName = text(o.name, 60)
    if (optionName === null || optionName === false) return 'INVALID_INPUT'
    if (optionNames.has(keyOf(optionName))) return 'DUPLICATE_OPTION'
    optionNames.add(keyOf(optionName))
    if (o.values.length === 0) return 'OPTION_VALUES_REQUIRED'
    if (o.values.length > maxValuesPerOption) return 'INVALID_INPUT'
    const valueNames = new Set<string>()
    const values: CleanOption['values'] = []
    for (const v of o.values) {
      const valueName = text(v.name, 60)
      if (valueName === null || valueName === false) return 'INVALID_INPUT'
      if (valueNames.has(keyOf(valueName))) return 'DUPLICATE_VALUE'
      valueNames.add(keyOf(valueName))
      values.push({ id: v.id ?? null, name: valueName })
    }
    options.push({ id: o.id ?? null, name: optionName, values })
  }

  if (input.versions.length === 0) return 'VERSION_REQUIRED'
  if (options.length === 0 && input.versions.length > 1) return 'VERSION_CHOICES'
  if (input.versions.length > maxVersions) return 'TOO_MANY_VERSIONS'
  const versions: CleanVersion[] = []
  const combinations = new Set<string>()
  const skus = new Set<string>()
  for (const v of input.versions) {
    const clean = cleanVersion(v, options.length, pricingCurrency)
    if (typeof clean === 'string') return clean
    clean.choices.forEach((choice, i) => {
      if (!options[i]?.values.some((value) => keyOf(value.name) === keyOf(choice))) clean.choices[i] = ''
    })
    if (clean.choices.includes('')) return 'VERSION_CHOICES'
    const combination = clean.choices.map(keyOf).join('\u0000')
    if (combinations.has(combination)) return 'DUPLICATE_VERSION'
    combinations.add(combination)
    if (clean.sku !== null) {
      if (skus.has(clean.sku.toLowerCase())) return 'DUPLICATE_SKU'
      skus.add(clean.sku.toLowerCase())
    }
    versions.push(clean)
  }

  const photos = input.photos === null || input.photos === undefined ? null : cleanPhotos(input.photos, versions.length)
  if (typeof photos === 'string') return photos
  const video = cleanVideo(input.video)
  if (typeof video === 'string') return video
  let filterValues: CleanProduct['filterValues'] = null
  if (input.filterValues !== null && input.filterValues !== undefined) {
    if (input.filterValues.length > maxFilterValues) return 'INVALID_INPUT'
    const seen = new Set<string>()
    filterValues = []
    for (const f of input.filterValues) {
      const version = f.version ?? null
      const key = `${f.valueId.toLowerCase()}:${version ?? ''}`
      if (!isUuid(f.valueId) || seen.has(key) || (version !== null && (!Number.isInteger(version) || version < 0 || version >= versions.length))) return 'INVALID_FILTER'
      seen.add(key)
      filterValues.push({ valueId: f.valueId.toLowerCase(), version })
    }
  }

  const [warrantyText, returnsText, seoTitle, seoDescription] = extras as (string | null)[]
  return {
    name,
    description,
    slug,
    slugGiven,
    productType,
    category,
    visible: input.visible ?? null,
    warrantyText: warrantyText ?? null,
    returnsText: returnsText ?? null,
    seoTitle: seoTitle ?? null,
    seoDescription: seoDescription ?? null,
    options,
    versions,
    photos,
    video,
    filterValues,
  }
}

/** What an approved supplier product had when its supplier last saved it, for `reviewedChanges`. */
export interface ReviewedFields {
  name: string
  versions: readonly { id: string; prices: readonly { currency: string; amount: string; compare_at_amount: string | null }[] }[]
  photos: readonly { asset_id: string }[]
}

const priceKey = (p: { currency: string; amount: string; compareAt: string | null }) => `${p.currency}:${BigInt(p.amount)}:${p.compareAt === null ? '' : BigInt(p.compareAt)}`

/**
 * ACCESS §7.2: a supplier's edit of an approved product waits for approval only when its name, a price (a new
 * version brings one) or its photo set changed; order alone isn't a change. Answers which, for the save's wording.
 */
export const reviewedChanges = (before: ReviewedFields, after: Pick<CleanProduct, 'name' | 'versions' | 'photos'>): ('name' | 'price' | 'photos')[] => {
  const changed: ('name' | 'price' | 'photos')[] = []
  if (after.name !== before.name) changed.push('name')
  const pricesOf = new Map(before.versions.map((v) => [v.id, v.prices.map((p) => priceKey({ currency: p.currency, amount: p.amount, compareAt: p.compare_at_amount })).sort().join('|')]))
  if (after.versions.some((v) => v.id === null || pricesOf.get(v.id) !== v.prices.map(priceKey).sort().join('|'))) changed.push('price')
  if (after.photos !== null) {
    const set = (ids: readonly string[]) => [...new Set(ids)].sort().join('|')
    if (set(after.photos.map((p) => p.assetId)) !== set(before.photos.map((p) => p.asset_id))) changed.push('photos')
  }
  return changed
}
