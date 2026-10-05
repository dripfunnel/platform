import { isCurrency, parseMinor } from '#core/money'

// The catalogue's input rules (CATALOG-DESIGN §3 facts 1–5, 15; decided on #337): what a product must
// be before it is written. Pure, so the API and imports share them.

export const maxOptions = 3
export const maxVersions = 100
export const maxValuesPerOption = 100

/** Refused outright (decided on #337); alcohol is allowed and carries an age check. */
export const refusedCategories = ['weapons', 'prescription_medicine', 'illegal_drugs', 'tobacco_vapes', 'adult', 'counterfeit'] as const

// Any of these words in a category refuses it, however it is cased or joined, so "Tobacco" or "Fire-arms" can't pass.
const refusedWords = new Set(['weapon', 'weapons', 'firearm', 'firearms', 'gun', 'guns', 'ammunition', 'prescription', 'narcotics', 'illegal', 'tobacco', 'vape', 'vapes', 'vaping', 'cigarette', 'cigarettes', 'adult', 'counterfeit', 'counterfeits', 'replica', 'replicas'])

/** A category in words, folded: lower case, accents gone, anything else a separator. */
const categoryWords = (category: string): string[] =>
  category
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

export const isRefusedCategory = (category: string): boolean => {
  const words = categoryWords(category)
  return refusedCategories.includes(words.join('_') as (typeof refusedCategories)[number]) || words.some((w) => refusedWords.has(w)) || words.join('').includes('firearm')
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

export interface CleanProduct {
  name: string
  description: string
  slug: string
  productType: ProductType
  category: string | null
  visible: boolean | null
  warrantyText: string | null
  returnsText: string | null
  seoTitle: string | null
  seoDescription: string | null
  options: CleanOption[]
  versions: CleanVersion[]
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

  const [warrantyText, returnsText, seoTitle, seoDescription] = extras as (string | null)[]
  return {
    name,
    description,
    slug,
    productType,
    category,
    visible: input.visible ?? null,
    warrantyText: warrantyText ?? null,
    returnsText: returnsText ?? null,
    seoTitle: seoTitle ?? null,
    seoDescription: seoDescription ?? null,
    options,
    versions,
  }
}
