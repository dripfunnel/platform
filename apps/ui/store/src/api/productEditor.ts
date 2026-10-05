import { z } from 'zod'
import { actingHeaders } from '../acting'
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
  // Null for a supplier, which reads no market.
  readiness: z.array(z.object({ marketId: z.string(), marketName: z.string(), ready: z.boolean(), missing: z.array(z.string()) })).nullable(),
})

export type EditorProduct = z.infer<typeof productSchema>
export type EditorVersion = z.infer<typeof versionSchema>

const productFields = `id revision name description productType visible approval sentBackReason supplier { id name } slug seoTitle seoDescription pricingCurrency
  photos { id assetId url alt versionId }
  options { id name values { id name } }
  versions { id choices name sku barcode visible prices { amount compareAtAmount currency } cost { amount currency } weightGrams lengthMm widthMm heightMm hsCode taxClassId trackStock }
  readiness { marketId marketName ready missing }`

/** The product, or null for one that isn't here (or isn't the caller's, which looks the same). */
export const loadProduct = async (id: string): Promise<EditorProduct | null> =>
  (await query(`query P($id: ID!) { product(id: $id) { ${productFields} } }`, z.object({ product: productSchema.nullable() }), { id })).product

/** What a product is typed in: the store's pricing currency and its units, which every seat may read. */
export const loadProductBasics = async (): Promise<{ pricingCurrency: string | null; unitSystem: 'metric' | 'imperial' }> =>
  (await query('{ catalogueSettings { pricingCurrency unitSystem } }', z.object({ catalogueSettings: z.object({ pricingCurrency: z.string().nullable(), unitSystem: z.enum(['metric', 'imperial']).catch('metric') }) }))).catalogueSettings

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
  }[]
  photos: { assetId: string; alt?: string; version?: number }[]
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

const taxSetupSchema = z.object({ taxSetup: z.object({ pricesIncludeTax: z.boolean(), classes: z.array(z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() })) }).nullable() })
export type TaxSetup = NonNullable<z.infer<typeof taxSetupSchema>['taxSetup']>

/** The merchant side's tax categories and whether prices include tax; a supplier reads neither here. */
export const loadTaxSetup = async (): Promise<TaxSetup | null> => (await query('{ taxSetup { pricesIncludeTax classes { id name isDefault } } }', taxSetupSchema)).taxSetup

/** Whether a supplier's changes wait for the merchant (SAPI 5's approval switch). */
export const loadApprovalRequired = async (): Promise<boolean> => (await query('{ supplierApprovalRequired }', z.object({ supplierApprovalRequired: z.boolean() }))).supplierApprovalRequired
