import { parseCsv } from '#core/csv'
import { convert, fromMajor } from '#core/money'
import { cleanProduct, invalidInputOf, maxOptions, maxPhotos, productTypes, slugFrom, type CatalogRefusal, type ProductInput, type VersionInput } from './rules'

// A spreadsheet of products as the import reads it (CATALOG K1–K3, K10, K11): our own export's columns or
// Shopify's product CSV, rows grouped by handle into products, each checked as a save would check it.

export const importLimits = { bytes: 5 * 1024 * 1024, rows: 20_000, products: 5_000, maxStock: 1_000_000, locations: 50, photoUrl: 2048, photoAlt: 500 } as const

export type ImportSource = 'csv' | 'shopify'

export type ProblemCode =
  | CatalogRefusal
  | 'HANDLE_REQUIRED'
  | 'BAD_PRICE'
  | 'BAD_NUMBER'
  | 'BAD_VISIBLE'
  | 'BAD_TYPE'
  | 'SKU_IN_FILE'
  | 'ONE_VERSION'
  | 'PHOTO_TOO_LONG'
  | 'UNKNOWN_LANGUAGE'
  | 'NOT_MANUAL_CURRENCY'
  | 'SUPPLIER_CURRENCY'
  | 'OPTIONS_DIFFER'
  | 'PHOTO_UNAVAILABLE'
  | 'PHOTO_REFUSED'
  | 'NAME_TOO_LONG'
  | 'DESCRIPTION_TOO_LONG'
  | 'SEO_TITLE_TOO_LONG'
  | 'SEO_DESCRIPTION_TOO_LONG'
  | 'OPTION_NAME_INVALID'
  | 'OPTION_VALUE_INVALID'
  | 'TOO_MANY_VALUES'
  | 'SKU_TOO_LONG'
  | 'COMPARE_BELOW_PRICE'
  // The run's, from the save it went through (catalog/index.ts SaveRefusal) or the import's own matching.
  | 'NOT_FOUND'
  | 'CURRENCY_REQUIRED'
  | 'SUPPLIER_FIELD'
  | 'FILE_REFUSED'
  | 'NOT_SHOWABLE'
  | 'STALE_REVISION'
  | 'PLAN_LIMIT'
  | 'MATCHES_MANY'
  | 'STOCK_REFUSED'
  | 'TRANSLATION_REFUSED'
  | 'NOT_ALLOWED'
  // The Shopify inventory file's (inventoryFile.ts).
  | 'LOCATION_REQUIRED'
  | 'INVENTORY_UNMATCHED'
  | 'NOT_STOCKED'
  | 'NO_COUNT'

/** One problem, by the file's own line number (the header is line 1) and column, as K3 lists them. */
export interface ImportProblem {
  line: number
  column: string | null
  code: ProblemCode
  /** Set when the line is the inventory file's, not the products file's. */
  file?: 'inventory'
}

export interface PlannedProduct {
  handle: string
  /** The file's lines it came from, its first one first. */
  lines: number[]
  input: ProductInput
  /** Each version's count for the chosen location, in `input.versions`' order; null leaves it as it is. */
  stock: (number | null)[]
  /** With an inventory file: the same, per Shopify location, in place of `stock`. */
  stockAt?: Record<string, (number | null)[]>
  /** In the file's order, each with the line it's on, for a fetch that fails (K6). */
  photos: { url: string; alt: string | null; line: number }[]
  translations: Record<string, { name?: string; description?: string }>
}

export interface ImportPlan {
  source: ImportSource
  products: PlannedProduct[]
  problems: ImportProblem[]
  /** Products the check refused; they are in `problems` and never imported. */
  refused: number
  /** Every line of those products, for the error file. */
  refusedLines: number[]
  refusedHandles?: string[]
  /** The Shopify locations an inventory file gave counts for, in the file's order. */
  locations?: string[]
  /** Set when the file's prices were converted from another currency to the pricing currency, at the rates of `on`. */
  conversion?: { from: string; to: string; on: string }
}

export type PlanRefusal = 'UNREADABLE' | 'EMPTY' | 'TOO_MANY_ROWS' | 'TOO_MANY_PRODUCTS' | 'NO_NAME_COLUMN' | 'SHOPIFY_FILE' | 'NOT_SHOPIFY_FILE'

export interface PlanOptions {
  currency: string
  /** The store's languages other than its main one. */
  languages: readonly string[]
  /** Currencies priced by hand (K11); converted ones are never imported. */
  manualCurrencies: readonly string[]
  /** A supplier's file: no visibility, prices in the pricing currency only (ACCESS §7.2, CATALOG O14). */
  supplier: boolean
  /** The kind of file the importer said it was uploading; with none, either is read. */
  expect?: ImportSource
  /** The file's prices are in `from`, not the pricing currency: converted at these rates, units per euro (CATALOG fact 26). */
  convert?: { from: string; perEuroFrom: string; perEuroTo: string; on: string }
}

type Field =
  | 'handle'
  | 'name'
  | 'description'
  | 'type'
  | 'visible'
  | 'status'
  | 'published'
  | 'sku'
  | 'barcode'
  | 'price'
  | 'compare'
  | 'cost'
  | 'weight'
  | 'stock'
  | 'image'
  | 'imageAlt'
  | 'imagePosition'
  | 'seoTitle'
  | 'seoDescription'
  | `option${1 | 2 | 3}Name`
  | `option${1 | 2 | 3}Value`

const ours: Record<string, Field> = {
  handle: 'handle',
  name: 'name',
  description: 'description',
  type: 'type',
  visible: 'visible',
  sku: 'sku',
  barcode: 'barcode',
  price: 'price',
  'compare at price': 'compare',
  cost: 'cost',
  'weight grams': 'weight',
  stock: 'stock',
  image: 'image',
  'image alt': 'imageAlt',
  'seo title': 'seoTitle',
  'seo description': 'seoDescription',
}

const shopify: Record<string, Field> = {
  handle: 'handle',
  title: 'name',
  'body (html)': 'description',
  status: 'status',
  published: 'published',
  'variant sku': 'sku',
  'variant barcode': 'barcode',
  'variant barcodes': 'barcode',
  'variant price': 'price',
  'variant compare at price': 'compare',
  'cost per item': 'cost',
  'variant grams': 'weight',
  'variant inventory qty': 'stock',
  'image src': 'image',
  'image alt text': 'imageAlt',
  'image position': 'imagePosition',
  'seo title': 'seoTitle',
  'seo description': 'seoDescription',
}

for (const n of [1, 2, 3] as const) {
  ours[`option${n} name`] = shopify[`option${n} name`] = `option${n}Name`
  ours[`option${n} value`] = shopify[`option${n} value`] = `option${n}Value`
}

const isShopify = (header: readonly string[]) => header.some((h) => h === 'variant sku' || h === 'variant price' || h === 'body (html)')

/** Whether a file's header is Shopify's, read without planning the file: the plan gate needs it before the check runs. */
export const isShopifyFile = (text: string): boolean => {
  const end = text.search(/\r?\n/)
  const header = parseCsv(end === -1 ? text : text.slice(0, end))?.[0]
  return header !== undefined && isShopify(header.map((h) => h.trim().toLowerCase()))
}

/** Shopify's description is HTML; ours is text, so tags go and the common entities are read. */
export const textOfHtml = (html: string): string =>
  html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const yes = new Set(['yes', 'true', '1', 'y'])
const no = new Set(['no', 'false', '0', 'n'])

/** Shopify writes grams as "0.0" or "250.0". */
const grams = (text: string, max: number): number | null | 'bad' => {
  if (text === '') return null
  if (!/^\d+(\.\d+)?$/.test(text)) return 'bad'
  const n = Math.round(Number(text))
  return n > max ? 'bad' : n
}

const whole = (text: string, max: number): number | null | 'bad' => {
  if (text === '') return null
  if (!/^\d+$/.test(text)) return 'bad'
  const n = Number(text)
  return n > max ? 'bad' : n
}

const versionFields: readonly Field[] = ['sku', 'barcode', 'price', 'compare', 'cost', 'weight', 'stock', 'option1Value', 'option2Value', 'option3Value']

const refusalColumn: Partial<Record<CatalogRefusal, Field>> = {
  NAME_REQUIRED: 'name',
  PRICE_REQUIRED: 'price',
  INVALID_PRICE: 'price',
  INVALID_BARCODE: 'barcode',
  DUPLICATE_SKU: 'sku',
  TOO_MANY_OPTIONS: 'option1Name',
  OPTION_VALUES_REQUIRED: 'option1Value',
  DUPLICATE_OPTION: 'option1Name',
  DUPLICATE_VALUE: 'option1Value',
  VERSION_CHOICES: 'option1Value',
  DUPLICATE_VERSION: 'option1Value',
  CATEGORY_REFUSED: 'name',
}

export const planImport = (text: string, o: PlanOptions): ImportPlan | PlanRefusal => {
  const table = parseCsv(text)
  if (!table) return 'UNREADABLE'
  // Each record keeps its number in the file, as a spreadsheet shows it, past any blank ones.
  const rows = table.map((cells, i) => ({ line: i + 1, cells })).filter((r) => r.cells.some((c) => c.trim() !== ''))
  const head = rows[0]?.cells
  const body = rows.slice(1)
  if (!head) return 'EMPTY'
  const header = head.map((h) => h.trim().toLowerCase())
  const source: ImportSource = isShopify(header) ? 'shopify' : 'csv'
  if (o.expect && o.expect !== source) return o.expect === 'csv' ? 'SHOPIFY_FILE' : 'NOT_SHOPIFY_FILE'
  if (body.length === 0) return 'EMPTY'
  if (body.length > importLimits.rows) return 'TOO_MANY_ROWS'
  const names = source === 'shopify' ? shopify : ours
  const problems: ImportProblem[] = []
  const columnOf = new Map<Field, number>()
  const labelOf = (f: Field) => head[columnOf.get(f) ?? -1]?.trim() ?? null
  const languages = new Map<string, { name?: number; description?: number }>()
  const currencies = new Map<string, number>()
  header.forEach((h, i) => {
    const known = names[h]
    if (known && !columnOf.has(known)) columnOf.set(known, i)
    const translated = source === 'csv' ? /^(name|description):(.+)$/.exec(h) : null
    if (translated?.[1] && translated[2]) {
      const language = o.languages.find((l) => l.toLowerCase() === translated[2])
      if (!language) problems.push({ line: 1, column: head[i]?.trim() ?? null, code: 'UNKNOWN_LANGUAGE' })
      else languages.set(language, { ...languages.get(language), [translated[1]]: i })
    }
    const priced = source === 'csv' ? /^price:([a-z]{3})$/.exec(h) : null
    if (priced?.[1]) {
      const currency = priced[1].toUpperCase()
      if (o.supplier) problems.push({ line: 1, column: head[i]?.trim() ?? null, code: 'SUPPLIER_CURRENCY' })
      else if (!o.manualCurrencies.includes(currency) || currency === o.currency) problems.push({ line: 1, column: head[i]?.trim() ?? null, code: 'NOT_MANUAL_CURRENCY' })
      else currencies.set(currency, i)
    }
  })
  if (!columnOf.has('name') && !columnOf.has('handle')) return 'NO_NAME_COLUMN'

  // Rows by handle, in the order each handle first appears; a row without one takes its name's.
  const groups = new Map<string, { line: number; cells: string[] }[]>()
  body.forEach(({ line, cells }) => {
    const cell = (f: Field) => cells[columnOf.get(f) ?? -1]?.trim() ?? ''
    const handle = slugFrom(cell('handle') || cell('name'))
    if (handle === '') {
      problems.push({ line, column: labelOf('handle') ?? labelOf('name'), code: 'HANDLE_REQUIRED' })
      return
    }
    const group = groups.get(handle)
    if (group) group.push({ line, cells })
    else groups.set(handle, [{ line, cells }])
  })
  if (groups.size > importLimits.products) return 'TOO_MANY_PRODUCTS'

  const products: PlannedProduct[] = []
  const seenSkus = new Map<string, string>()
  let refused = 0
  const refusedLines: number[] = []
  const refusedHandles: string[] = []
  for (const [handle, lines] of groups) {
    const before = problems.length
    const flag = (line: number, field: Field | null, code: ProblemCode, column?: string) => problems.push({ line, column: column ?? (field ? labelOf(field) : null), code })
    const at = (row: { cells: string[] }, f: Field) => row.cells[columnOf.get(f) ?? -1]?.trim() ?? ''
    const first = lines.find((r) => at(r, 'name') !== '') ?? lines[0]
    if (!first) continue
    const optionNames = ([1, 2, 3] as const).map((n) => at(first, `option${n}Name`)).filter((n) => n !== '')
    // Shopify's simple product is one option "Title" with the value "Default Title".
    const simple = optionNames.length === 1 && optionNames[0]?.toLowerCase() === 'title' && lines.every((r) => ['', 'default title'].includes(at(r, 'option1Value').toLowerCase()))
    const options = simple ? [] : optionNames.slice(0, maxOptions)
    const versionRows = lines.filter((r) => versionFields.some((f) => at(r, f) !== ''))
    if (options.length === 0 && versionRows.length > 1) flag(versionRows[1]?.line ?? first.line, 'option1Name', 'ONE_VERSION')

    const money = (row: { line: number; cells: string[] }, field: Field, currency: string, column?: number): string | null => {
      const raw = column === undefined ? at(row, field) : (row.cells[column]?.trim() ?? '')
      if (raw === '') return null
      // The file's own currency's amount, converted at the rates held to the pricing currency, half up to its minor unit.
      const read = fromMajor(raw.replace(/,/g, ''), column === undefined && o.convert ? o.convert.from : currency)
      const parsed = read && column === undefined && o.convert ? convert(read, currency, o.convert.perEuroFrom, o.convert.perEuroTo) : read
      if (!parsed) {
        flag(row.line, column === undefined ? field : null, 'BAD_PRICE', column === undefined ? undefined : head[column]?.trim())
        return null
      }
      return parsed.amount.toString()
    }
    const stock: (number | null)[] = []
    const versions: VersionInput[] = (versionRows.length > 0 ? versionRows : [first]).map((row) => {
      const amount = money(row, 'price', o.currency)
      const compare = money(row, 'compare', o.currency)
      const cost = money(row, 'cost', o.currency)
      const weight = (source === 'shopify' ? grams : whole)(at(row, 'weight'), 1_000_000)
      if (weight === 'bad') flag(row.line, 'weight', 'BAD_NUMBER')
      const count = whole(at(row, 'stock'), importLimits.maxStock)
      if (count === 'bad') flag(row.line, 'stock', 'BAD_NUMBER')
      stock.push(typeof count === 'number' ? count : null)
      const sku = at(row, 'sku')
      if (sku !== '') {
        const owner = seenSkus.get(sku.toLowerCase())
        if (owner !== undefined && owner !== handle) flag(row.line, 'sku', 'SKU_IN_FILE')
        seenSkus.set(sku.toLowerCase(), handle)
      }
      const extra = [...currencies].flatMap(([currency, column]) => {
        const value = money(row, 'price', currency, column)
        return value === null ? [] : [{ currency, amount: value }]
      })
      return {
        choices: options.map((_, n) => at(row, `option${(n + 1) as 1 | 2 | 3}Value`)),
        sku: sku || null,
        barcode: at(row, 'barcode') || null,
        prices: amount === null ? extra : [{ currency: o.currency, amount, compareAtAmount: compare }, ...extra],
        cost: cost === null ? null : { currency: o.currency, amount: cost },
        weightGrams: typeof weight === 'number' ? weight : null,
      }
    })

    const valuesOf = (n: number) => [...new Map(versions.map((v) => v.choices[n] ?? '').filter((v) => v !== '').map((v) => [v.toLowerCase(), v])).values()]
    let visible: boolean | null = null
    if (!o.supplier) {
      const raw = (source === 'shopify' ? at(first, 'status') || at(first, 'published') : at(first, 'visible')).toLowerCase()
      if (raw === 'active' || yes.has(raw)) visible = true
      else if (raw === 'draft' || raw === 'archived' || no.has(raw)) visible = false
      else if (raw !== '') flag(first.line, source === 'shopify' ? 'status' : 'visible', 'BAD_VISIBLE')
    }
    const type = source === 'csv' ? at(first, 'type').toLowerCase() : ''
    if (type !== '' && !(productTypes as readonly string[]).includes(type)) flag(first.line, 'type', 'BAD_TYPE')
    const description = at(first, 'description')
    const input: ProductInput = {
      name: at(first, 'name'),
      description: source === 'shopify' ? textOfHtml(description) : description,
      slug: handle,
      productType: type === '' ? null : type,
      visible,
      seoTitle: at(first, 'seoTitle') || null,
      seoDescription: at(first, 'seoDescription') || null,
      options: options.map((name, n) => ({ name, values: valuesOf(n).map((value) => ({ name: value })) })),
      versions,
    }
    if (problems.length === before) {
      const checked = cleanProduct(input, o.currency)
      if (typeof checked === 'string') {
        const rowOf = (version: number | undefined) => (version === undefined ? undefined : versionRows[version]?.line) ?? first.line
        const bad = checked === 'INVALID_INPUT' ? invalidInputOf(input) : null
        const compare = checked === 'INVALID_PRICE' ? input.versions.findIndex((v) => v.prices[0]?.compareAtAmount && BigInt(v.prices[0].compareAtAmount) <= BigInt(v.prices[0].amount)) : -1
        const optionField = (suffix: 'Name' | 'Value'): Field => `option${((bad?.option ?? 0) + 1) as 1 | 2 | 3}${suffix}`
        if (bad?.field === 'name') flag(first.line, 'name', 'NAME_TOO_LONG')
        else if (bad?.field === 'description') flag(first.line, 'description', 'DESCRIPTION_TOO_LONG')
        else if (bad?.field === 'seoTitle') flag(first.line, 'seoTitle', 'SEO_TITLE_TOO_LONG')
        else if (bad?.field === 'seoDescription') flag(first.line, 'seoDescription', 'SEO_DESCRIPTION_TOO_LONG')
        else if (bad?.field === 'optionName') flag(first.line, optionField('Name'), 'OPTION_NAME_INVALID')
        else if (bad?.field === 'optionValue') flag(first.line, optionField('Value'), 'OPTION_VALUE_INVALID')
        else if (bad?.field === 'optionValues') flag(first.line, optionField('Value'), 'TOO_MANY_VALUES')
        else if (bad?.field === 'sku') flag(rowOf(bad.version), 'sku', 'SKU_TOO_LONG')
        else if (bad?.field === 'barcode') flag(rowOf(bad.version), 'barcode', 'INVALID_BARCODE')
        else if (compare !== -1) flag(rowOf(compare), 'compare', 'COMPARE_BELOW_PRICE')
        else flag(first.line, refusalColumn[checked] ?? null, checked)
      }
    }
    const seenPhotos = new Set<string>()
    // Shopify numbers its photos; they come in that order whichever row each is on.
    const place = (r: { cells: string[] }) => Number(at(r, 'imagePosition')) || 0
    const allPhotos = lines
      .toSorted((a, b) => place(a) - place(b))
      .filter((r) => /^https?:\/\//i.test(at(r, 'image')) && !seenPhotos.has(at(r, 'image')) && Boolean(seenPhotos.add(at(r, 'image'))))
      .map((r) => ({ url: at(r, 'image'), alt: at(r, 'imageAlt') || null, line: r.line }))
    const translations = Object.fromEntries(
      [...languages].map(([language, columns]) => {
        const name = columns.name === undefined ? '' : (first.cells[columns.name]?.trim() ?? '')
        const text = columns.description === undefined ? '' : (first.cells[columns.description]?.trim() ?? '')
        return [language, { ...(name ? { name } : {}), ...(text ? { description: text } : {}) }]
      }).filter(([, t]) => Object.keys(t as object).length > 0),
    ) as PlannedProduct['translations']
    if (problems.length > before) {
      refused++
      refusedLines.push(...lines.map((l) => l.line))
      refusedHandles.push(handle)
      continue
    }
    // A photo the photo job couldn't carry is left out on its own line; the product still goes in (K6).
    const fits = (p: (typeof allPhotos)[number]) => p.url.length <= importLimits.photoUrl && (p.alt?.length ?? 0) <= importLimits.photoAlt
    for (const p of allPhotos.filter((x) => !fits(x))) flag(p.line, p.url.length > importLimits.photoUrl ? 'image' : 'imageAlt', 'PHOTO_TOO_LONG')
    const carried = allPhotos.filter(fits)
    // The product comes in with its first photos; the ones past the limit are said, not dropped unseen.
    const extra = carried[maxPhotos]
    if (extra) problems.push({ line: extra.line, column: labelOf('image'), code: 'TOO_MANY_PHOTOS' })
    products.push({ handle, lines: lines.map((l) => l.line), input, stock, photos: carried.slice(0, maxPhotos), translations })
  }
  return { source, products, problems, refused, refusedLines, refusedHandles, ...(o.convert ? { conversion: { from: o.convert.from, to: o.currency, on: o.convert.on } } : {}) }
}
