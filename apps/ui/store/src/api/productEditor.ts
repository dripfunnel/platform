import { z } from 'zod'
import { actingHeaders } from '../acting'
import { allPages } from './allPages'
import { loadFilters } from './filters'
import { loadTax } from './tax'
import { query } from './client'

// The product editor's reads and writes (FIRST-RELEASE §11, CatEditor; apps/api/schema/store.graphql,
// src/apis/store/products.ts, assets.ts, listing.ts, tax.ts).

const moneySchema = z.object({ amount: z.string(), currency: z.string() })
const priceSchema = z.object({ amount: z.string(), compareAtAmount: z.string().nullable(), currency: z.string() })

const versionSchema = z.object({
  id: z.string(),
  choices: z.array(z.string()),
  name: z.string().nullable(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  visible: z.boolean(),
  prices: z.array(priceSchema),
  cost: moneySchema.nullable(),
  weightGrams: z.number().int().nullable(),
  lengthMm: z.number().int().nullable(),
  widthMm: z.number().int().nullable(),
  heightMm: z.number().int().nullable(),
  hsCode: z.string().nullable(),
  taxClassId: z.string().nullable(),
  trackStock: z.boolean().nullable(),
  continueSelling: z.boolean().nullable(),
})

const productSchema = z.object({
  id: z.string(),
  revision: z.number().int(),
  name: z.string(),
  description: z.string(),
  productType: z.string(),
  visible: z.boolean(),
  approval: z.enum(['approved', 'pending', 'sent_back']).nullable(),
  sentBackReason: z.string().nullable(),
  supplier: z.object({ id: z.string(), name: z.string() }).nullable(),
  slug: z.string(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  pricingCurrency: z.string().nullable(),
  photos: z.array(z.object({ id: z.string(), assetId: z.string(), url: z.string(), alt: z.string().nullable(), versionId: z.string().nullable() })),
  options: z.array(z.object({ id: z.string(), name: z.string(), values: z.array(z.object({ id: z.string(), name: z.string() })) })),
  versions: z.array(versionSchema),
  listing: z.object({
    specs: z.array(z.object({ name: z.string(), value: z.string(), versionId: z.string().nullable(), filterValueId: z.string().nullable() })),
    highlights: z.array(z.string()),
    faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
    relatedIds: z.array(z.string()),
    related: z.array(z.object({ id: z.string(), name: z.string() })),
    badgeIds: z.array(z.string()),
    compliance: z.array(z.object({ region: z.string(), field: z.string(), value: z.string() })),
    ageRestricted: z.boolean().nullable(),
    hazardous: z.boolean().nullable(),
  }),
  filterValues: z.array(z.object({ valueId: z.string(), versionId: z.string().nullable() })),
  sizeChartId: z.string().nullable(),
  // Null for a supplier, which reads no market.
  readiness: z.array(z.object({ marketId: z.string(), marketName: z.string(), ready: z.boolean(), missing: z.array(z.string()) })).nullable(),
})

export type EditorProduct = z.infer<typeof productSchema>
export type EditorVersion = z.infer<typeof versionSchema>

const productFields = `id revision name description productType visible approval sentBackReason supplier { id name } slug seoTitle seoDescription pricingCurrency
  photos { id assetId url alt versionId }
  options { id name values { id name } }
  versions { id choices name sku barcode visible prices { amount compareAtAmount currency } cost { amount currency } weightGrams lengthMm widthMm heightMm hsCode taxClassId trackStock continueSelling }
  listing { specs { name value versionId filterValueId } highlights faqs { question answer } relatedIds related { id name } badgeIds compliance { region field value } ageRestricted hazardous }
  filterValues { valueId versionId } sizeChartId
  readiness { marketId marketName ready missing }`

/** The product, or null for one that isn't here (or isn't the caller's, which looks the same). */
export const loadProduct = async (id: string): Promise<EditorProduct | null> =>
  (await query(`query P($id: ID!) { product(id: $id) { ${productFields} } }`, z.object({ product: productSchema.nullable() }), { id })).product

const basicsSchema = z.object({
  pricingCurrency: z.string().nullable(),
  unitSystem: z.enum(['metric', 'imperial']).catch('metric'),
  // inPlan is null for a supplier, which is never told the plan.
  features: z.array(z.object({ key: z.string(), enabled: z.boolean(), inPlan: z.boolean().nullable() })),
  badges: z.array(z.object({ id: z.string(), label: z.string(), rule: z.string() })),
  mainLanguage: z.string().nullable(),
  translationLanguages: z.array(z.string()),
})
export type ProductBasics = z.infer<typeof basicsSchema>

/** What a product is typed in and which sections it has: the store's currency, units, catalogue switches and badges. */
export const loadProductBasics = async (): Promise<ProductBasics> =>
  (await query('{ catalogueSettings { pricingCurrency unitSystem features { key enabled inPlan } badges { id label rule } mainLanguage translationLanguages } }', z.object({ catalogueSettings: basicsSchema }))).catalogueSettings

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })

/** A filter as the editor tags with it; the Filters tab reads more of it (api/filters.ts Filter). */
export interface Facet {
  id: string
  name: string
  shopperVisible: boolean
  values: { id: string; name: string }[]
}

/** The store's filters for tagging a product: the Filters tab's own read (api/filters.ts), so the two can't drift. */
export const loadFacets = (): Promise<Facet[]> => loadFilters()

/** The size charts the caller may pick: the store's, and a supplier's own. */
export const loadSizeCharts = (): Promise<{ id: string; name: string }[]> =>
  allPages(async (after) => (await query('query C($after: String) { sizeCharts(first: 50, after: $after) { nodes { id name } pageInfo { hasNextPage endCursor } } }', z.object({ sizeCharts: z.object({ nodes: z.array(z.object({ id: z.string(), name: z.string() })), pageInfo: pageInfoSchema }) }), { after })).sizeCharts)

const memberSchema = z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() }))
export type ProductCollection = z.infer<typeof memberSchema>[number]

/** The collections a product is in, hand-picked and automatic (the merchant side's). */
export const loadProductCollections = async (productId: string): Promise<ProductCollection[]> =>
  (await query('query C($p: ID!) { productCollections(productId: $p) { id name kind } }', z.object({ productCollections: memberSchema }), { p: productId })).productCollections

/** Puts the product in exactly these hand-picked collections; answers all it is now in. */
export const setProductCollections = async (productId: string, collectionIds: string[]): Promise<ProductCollection[]> =>
  (await query('mutation S($p: ID!, $c: [ID!]!) { setProductCollections(productId: $p, collectionIds: $c) { id name kind } }', z.object({ setProductCollections: memberSchema }), { p: productId, c: collectionIds })).setProductCollections

export interface ProductInput {
  name: string
  description: string
  productType: string
  visible?: boolean
  slug?: string
  seoTitle: string
  seoDescription: string
  options: { id?: string; name: string; values: { id?: string; name: string }[] }[]
  versions: {
    id?: string
    choices: string[]
    sku: string | null
    visible: boolean
    prices: { currency: string; amount: string; compareAtAmount?: string }[]
    cost?: { currency: string; amount: string }
    weightGrams: number | null
    lengthMm: number | null
    widthMm: number | null
    heightMm: number | null
    hsCode: string | null
    taxClassId?: string | null
    trackStock: boolean | null
    continueSelling: boolean | null
  }[]
  photos: { assetId: string; alt?: string; version?: number }[]
  /** Each section named replaces the product's; one left out stays as it is (CATALOG S9). */
  listing?: {
    specs?: { name: string; value: string; version?: number; filterValueId?: string }[]
    highlights?: string[]
    faqs?: { question: string; answer: string }[]
    relatedIds?: string[]
    badgeIds?: string[]
    compliance?: { region: string; field: string; value: string }[]
    ageRestricted?: boolean
    hazardous?: boolean
  }
  filterValues?: { valueId: string; version?: number }[]
  sizeChartId?: string | null
}

const savedSchema = z.object({ id: z.string(), revision: z.number().int(), approval: z.string().nullable() })
export type SavedProduct = z.infer<typeof savedSchema>

/** A new product (no id) or the next revision of one; a Stock-only supplier proposes instead (#337). */
export const saveProduct = async (id: string | null, revision: number | null, input: ProductInput, propose: boolean): Promise<SavedProduct> =>
  propose
    ? (await query('mutation P($input: ProductInput!) { proposeProduct(input: $input) { id revision approval } }', z.object({ proposeProduct: savedSchema }), { input })).proposeProduct
    : (await query('mutation S($id: ID, $revision: Int, $input: ProductInput!) { saveProduct(id: $id, revision: $revision, input: $input) { id revision approval } }', z.object({ saveProduct: savedSchema }), { id, revision, input })).saveProduct

export const uploadRefusals = ['TOO_LARGE', 'UNSUPPORTED_TYPE', 'EMPTY', 'FORBIDDEN', 'READ_ONLY', 'NOT_CONNECTED'] as const
export type UploadRefusal = (typeof uploadRefusals)[number]

const uploadSchema = z.union([z.object({ ok: z.literal(true), asset: z.object({ id: z.string(), kind: z.string() }) }), z.object({ ok: z.literal(false), code: z.string() })])

/** The raw file to `/api/assets` (FIRST-RELEASE §19 uploadAsset): its asset id, or why not. */
export const uploadPhoto = async (file: Blob): Promise<{ ok: true; assetId: string } | { ok: false; code: UploadRefusal }> => {
  try {
    const response = await fetch('/api/assets', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { ...actingHeaders(), 'content-type': file.type || 'application/octet-stream' },
      body: file,
      signal: AbortSignal.timeout(60_000),
    })
    const answer = uploadSchema.safeParse(await response.json())
    if (!answer.success) return { ok: false, code: 'NOT_CONNECTED' }
    if (answer.data.ok) return answer.data.asset.kind === 'image' ? { ok: true, assetId: answer.data.asset.id } : { ok: false, code: 'UNSUPPORTED_TYPE' }
    const code = z.enum(uploadRefusals).safeParse(answer.data.code)
    return { ok: false, code: code.success ? code.data : 'NOT_CONNECTED' }
  } catch {
    return { ok: false, code: 'NOT_CONNECTED' }
  }
}

/** What the editor needs of the tax setup; Settings › Tax setup reads the whole of it (api/tax.ts). */
export interface TaxSetup {
  pricesIncludeTax: boolean
  classes: { id: string; name: string; isDefault: boolean }[]
}

/** The merchant side's tax categories and whether prices include tax; a supplier reads neither here. */
export const loadTaxSetup = (): Promise<TaxSetup | null> => loadTax()

/** Whether a supplier's changes wait for the merchant (SAPI 5's approval switch). */
export const loadApprovalRequired = async (): Promise<boolean> => (await query('{ supplierApprovalRequired }', z.object({ supplierApprovalRequired: z.boolean() }))).supplierApprovalRequired

const currencyPriceSchema = z.object({ currency: z.string(), amount: z.string(), compareAtAmount: z.string().nullable(), source: z.string() })
export type CurrencyPrice = z.infer<typeof currencyPriceSchema>

/** Each version's price in every currency the store sells in, and in one market when named (the merchant side's, O14). */
export const loadPricing = async (productId: string, marketId: string | null = null): Promise<{ versionId: string; prices: CurrencyPrice[]; inMarket: CurrencyPrice | null }[]> =>
  (
    await query(
      'query P($id: ID!, $m: ID) { product(id: $id) { pricing(marketId: $m) { versionId prices { currency amount compareAtAmount source } inMarket { currency amount compareAtAmount source } } } }',
      z.object({ product: z.object({ pricing: z.array(z.object({ versionId: z.string(), prices: z.array(currencyPriceSchema), inMarket: currencyPriceSchema.nullable() })).nullable() }).nullable() }),
      { id: productId, m: marketId },
    )
  ).product?.pricing ?? []

/** The first version's price in each market, every market in one request (O14): market id → price, null when none. */
export const loadMarketPrices = async (productId: string, marketIds: readonly string[]): Promise<Map<string, CurrencyPrice | null>> => {
  if (marketIds.length === 0) return new Map()
  const fields = marketIds.map((_, i) => `m${i}: pricing(marketId: $m${i}) { inMarket { currency amount compareAtAmount source } }`).join(' ')
  const params = marketIds.map((_, i) => `$m${i}: ID!`).join(', ')
  const pricing = z.array(z.object({ inMarket: currencyPriceSchema.nullable() })).nullable()
  const { product } = await query(
    `query P($id: ID!, ${params}) { product(id: $id) { ${fields} } }`,
    z.object({ product: z.record(z.string(), pricing).nullable() }),
    { id: productId, ...Object.fromEntries(marketIds.map((id, i) => [`m${i}`, id])) },
  )
  return new Map(marketIds.map((id, i) => [id, product?.[`m${i}`]?.[0]?.inMarket ?? null]))
}

const currencySchema = z.object({ code: z.string(), mode: z.string(), status: z.string() })

/** The store's other currencies and how each is priced: converted for you (auto) or typed per product (manual). */
export const loadStoreCurrencies = async (): Promise<{ code: string; mode: 'auto' | 'manual' }[]> => {
  const { storeLocale } = await query('{ storeLocale { pricingCurrency currencies { code mode status } } }', z.object({ storeLocale: z.object({ pricingCurrency: z.string().nullable(), currencies: z.array(currencySchema) }).nullable() }))
  return (storeLocale?.currencies ?? []).filter((c) => c.status === 'active' && c.code !== storeLocale?.pricingCurrency).map((c) => ({ code: c.code, mode: c.mode === 'manual' ? 'manual' : 'auto' }))
}

/** The store's active markets, for each one's price. */
export const loadMarkets = (): Promise<{ id: string; name: string; currency: string }[]> =>
  allPages(async (after) => {
    const { markets } = await query(
      'query M($after: String) { markets(first: 50, after: $after) { nodes { id name currency active parentId } pageInfo { hasNextPage endCursor } } }',
      z.object({ markets: z.object({ nodes: z.array(z.object({ id: z.string(), name: z.string(), currency: z.string(), active: z.boolean(), parentId: z.string().nullable() })), pageInfo: pageInfoSchema }) }),
      { after },
    )
    return { nodes: markets.nodes.filter((m) => m.active && m.parentId === null).map(({ id, name, currency }) => ({ id, name, currency })), pageInfo: markets.pageInfo }
  })
