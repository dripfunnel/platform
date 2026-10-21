import { z } from 'zod'
import { ApiError, defaultTimeoutMs, pageInfoSchema, typedQuery, type ApiClient } from '../graphql'

// Products on the Store API (FIRST-RELEASE.md §11, §17; apps/api src/apis/store/products.ts, approval.ts, assets.ts): the list,
// the product the editor opens, its save, approval, and a photo's upload. Amounts arrive as strings of minor units.

export const productFilters = ['all', 'visible', 'hidden', 'pending', 'sent_back', 'low_stock', 'missing_info'] as const
export type ProductFilter = (typeof productFilters)[number]

export const productSorts = ['updated', 'name', 'price_low', 'price_high', 'stock'] as const
export type ProductSort = (typeof productSorts)[number]

const minor = z.string().regex(/^-?\d+$/)
const moneySchema = z.object({ amount: minor, currency: z.string() })
const approvalSchema = z.enum(['approved', 'pending', 'sent_back']).nullable()

const rowSchema = z.object({
  id: z.string(),
  name: z.string(),
  visible: z.boolean(),
  approval: approvalSchema,
  productType: z.string(),
  supplier: z.object({ id: z.string(), name: z.string() }).nullable(),
  supplierRemoved: z.boolean(),
  versionCount: z.number().int(),
  minPrice: moneySchema.nullable(),
  maxPrice: moneySchema.nullable(),
  photoUrl: z.string().nullable(),
  stock: z.number().int(),
  lowStock: z.boolean(),
  // Null for a supplier, which reads no market.
  readiness: z.array(z.object({ marketName: z.string(), ready: z.boolean(), missing: z.array(z.string()) })).nullable(),
})

export type ProductRow = z.infer<typeof rowSchema>

const rowFields = 'id name visible approval productType supplier { id name } supplierRemoved versionCount minPrice { amount currency } maxPrice { amount currency } photoUrl stock lowStock readiness { marketName ready missing }'

export type ProductQuery = { filter: ProductFilter; search: string; sort: ProductSort }

const productPageSize = 20

/** One page; `after` pages on. What the caller may see is the API's to say: nothing here narrows the list. */
export const loadProducts = async (client: ApiClient, { filter, search, sort }: ProductQuery, after: string | null = null): Promise<{ rows: ProductRow[]; next: string | null }> => {
  const { products } = await typedQuery(client)(
    `query Products($filter: String, $search: String, $sort: String, $first: Int, $after: String) {
      products(filter: $filter, search: $search, sort: $sort, first: $first, after: $after) { nodes { ${rowFields} } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } }
    }`,
    z.object({ products: z.object({ nodes: z.array(rowSchema), pageInfo: pageInfoSchema }) }),
    { filter, search: search.trim() || null, sort, first: productPageSize, after },
  )
  return { rows: products.nodes, next: products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null }
}

const countsSchema = z.object({ all: z.number(), visible: z.number(), hidden: z.number(), pending: z.number(), sentBack: z.number(), lowStock: z.number(), missingInfo: z.number(), fromSuppliers: z.number(), outOfStock: z.number() })
export type ProductCounts = z.infer<typeof countsSchema>

export const loadProductCounts = async (client: ApiClient): Promise<ProductCounts> =>
  (await typedQuery(client)('{ productCounts { all visible hidden pending sentBack lowStock missingInfo fromSuppliers outOfStock } }', z.object({ productCounts: countsSchema }))).productCounts

/** What the acting seat holds (ACCESS.md §5): the API's list of permissions, and whether the seat is a supplier's. */
export const loadAccess = async (client: ApiClient): Promise<{ permissions: string[]; supplier: boolean }> => {
  const { me } = await typedQuery(client)(
    '{ me { acting { permissions seller { id } } } }',
    z.object({ me: z.object({ acting: z.object({ permissions: z.array(z.string()).nullable(), seller: z.object({ id: z.string() }).nullable() }).nullable() }) }),
  )
  return { permissions: me.acting?.permissions ?? [], supplier: me.acting?.seller != null }
}

/** Whether a supplier's changes wait for the merchant (SAPI 5's switch). */
export const loadApprovalRequired = async (client: ApiClient): Promise<boolean> =>
  (await typedQuery(client)('{ supplierApprovalRequired }', z.object({ supplierApprovalRequired: z.boolean().nullable() }))).supplierApprovalRequired === true

export const approveProduct = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation Approve($id: ID!) { approveProduct(id: $id) }', z.object({ approveProduct: z.boolean().nullable() }), { id })
}

export const sendBackProduct = async (client: ApiClient, id: string, reason: string): Promise<void> => {
  await typedQuery(client)('mutation Back($id: ID!, $reason: String!) { sendBackProduct(id: $id, reason: $reason) }', z.object({ sendBackProduct: z.boolean().nullable() }), { id, reason })
}

const textOrEmpty = z
  .string()
  .nullable()
  .transform((value) => value ?? '')

const priceSchema = z.object({ amount: z.string(), compareAtAmount: z.string().nullable(), currency: z.string() })

const versionSchema = z.object({
  id: z.string(),
  choices: z.array(z.string()),
  name: z.string().nullable(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  visible: z.boolean(),
  prices: z.array(priceSchema),
  cost: z.object({ amount: z.string(), currency: z.string() }).nullable(),
  weightGrams: z.number().int().nullable(),
  lengthMm: z.number().int().nullable(),
  widthMm: z.number().int().nullable(),
  heightMm: z.number().int().nullable(),
  hsCode: z.string().nullable(),
  customsDescription: z.string().nullable(),
  taxClassId: z.string().nullable(),
  trackStock: z.boolean().nullable(),
  continueSelling: z.boolean().nullable(),
})

const photoSchema = z.object({ id: z.string(), assetId: z.string(), url: z.string(), alt: z.string().nullable(), versionId: z.string().nullable() })

const productSchema = z.object({
  id: z.string(),
  revision: z.number().int(),
  name: z.string(),
  description: textOrEmpty,
  productType: z.string(),
  visible: z.boolean(),
  approval: approvalSchema,
  sentBackReason: z.string().nullable(),
  supplier: z.object({ id: z.string(), name: z.string() }).nullable(),
  shared: z.boolean().nullable(),
  slug: z.string(),
  category: z.string().nullable(),
  sizeChartId: z.string().nullable(),
  warrantyText: z.string().nullable(),
  returnsText: z.string().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  pricingCurrency: z.string().nullable(),
  photos: z.array(photoSchema),
  options: z.array(z.object({ id: z.string(), name: z.string(), values: z.array(z.object({ id: z.string(), name: z.string() })) })),
  versions: z.array(versionSchema),
  // Null for a supplier, which reads no market.
  readiness: z.array(z.object({ marketId: z.string(), marketName: z.string(), ready: z.boolean(), missing: z.array(z.string()) })).nullable(),
})

export type EditorProduct = z.infer<typeof productSchema>
export type EditorVersion = z.infer<typeof versionSchema>

const productFields = `id revision name description productType visible approval sentBackReason supplier { id name } shared slug category sizeChartId warrantyText returnsText seoTitle seoDescription pricingCurrency
  photos { id assetId url alt versionId }
  options { id name values { id name } }
  versions { id choices name sku barcode visible prices { amount compareAtAmount currency } cost { amount currency } weightGrams lengthMm widthMm heightMm hsCode customsDescription taxClassId trackStock continueSelling }
  readiness { marketId marketName ready missing }`

/** The product, or null for one that isn't here, or isn't the caller's: the two look the same (ACCESS.md §11). */
export const loadProduct = async (client: ApiClient, id: string): Promise<EditorProduct | null> =>
  (await typedQuery(client)(`query Product($id: ID!) { product(id: $id) { ${productFields} } }`, z.object({ product: productSchema.nullable() }), { id })).product

/** What a new product is typed in, and which catalogue features the plan has. */
export const loadCatalogueBasics = async (client: ApiClient): Promise<{ pricingCurrency: string | null; features: { key: string; enabled: boolean; inPlan: boolean | null }[] }> =>
  (
    await typedQuery(client)(
      '{ catalogueSettings { pricingCurrency features { key enabled inPlan } } }',
      z.object({ catalogueSettings: z.object({ pricingCurrency: z.string().nullable(), features: z.array(z.object({ key: z.string(), enabled: z.boolean(), inPlan: z.boolean().nullable() })) }) }),
    )
  ).catalogueSettings

export type ProductInput = {
  name: string
  description: string
  productType: string
  visible?: boolean
  slug?: string
  category: string | null
  /** Sent only when it changed: left out keeps what is stored, `null` takes it off. */
  sizeChartId?: string | null
  warrantyText: string | null
  returnsText: string | null
  seoTitle: string | null
  seoDescription: string | null
  options: { id?: string; name: string; values: { id?: string; name: string }[] }[]
  versions: {
    id?: string
    choices: string[]
    name: string | null
    sku: string | null
    barcode: string | null
    visible: boolean
    prices: { currency: string; amount: string; compareAtAmount?: string }[]
    cost?: { currency: string; amount: string }
    weightGrams: number | null
    lengthMm: number | null
    widthMm: number | null
    heightMm: number | null
    hsCode: string | null
    customsDescription: string | null
    taxClassId?: string | null
    trackStock: boolean | null
    continueSelling: boolean | null
  }[]
  photos: { assetId: string; alt?: string; version?: number }[]
}

const savedSchema = z.object({ id: z.string(), revision: z.number().int(), approval: z.string().nullable(), reviewed: z.array(z.string()).nullable() })
export type SavedProduct = z.infer<typeof savedSchema>

/** A new product (no id) or the next revision of one. A Stock-only supplier proposes instead (#337). Sections not in the input stay as stored. */
export const saveProduct = async (client: ApiClient, id: string | null, revision: number | null, input: ProductInput, propose: boolean): Promise<SavedProduct> =>
  propose
    ? (await typedQuery(client)('mutation Propose($input: ProductInput!) { proposeProduct(input: $input) { id revision approval reviewed } }', z.object({ proposeProduct: savedSchema }), { input })).proposeProduct
    : (await typedQuery(client)('mutation Save($id: ID, $revision: Int, $input: ProductInput!) { saveProduct(id: $id, revision: $revision, input: $input) { id revision approval reviewed } }', z.object({ saveProduct: savedSchema }), { id, revision, input })).saveProduct

/** Where a stored file is read, relative to the portal host (`GET /api/assets/{id}`). */
export const assetPath = (assetId: string): string => `/api/assets/${assetId}`

export type PhotoDeps = {
  domain: string
  /** Read on every call, as the client reads the session (REACT-NATIVE.md §5). */
  headers: () => Record<string, string>
  fetchImpl?: typeof fetch
}

/** A stored file's address, with the session's headers only when it is on the portal's own host: a file kept at an address elsewhere never receives the token. */
export const assetSource = (deps: Pick<PhotoDeps, 'domain' | 'headers'>, path: string): { uri: string; headers?: Record<string, string> } => {
  const address = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(path)
  if (address === null) return { uri: `https://${deps.domain}${path}`, headers: deps.headers() }
  const own = address[1]?.toLowerCase() === 'https' && address[2]?.toLowerCase() === deps.domain.toLowerCase()
  return own ? { uri: path, headers: deps.headers() } : { uri: path }
}

const uploadSchema = z.union([
  z.object({ ok: z.literal(true), asset: z.object({ id: z.string(), kind: z.string(), mime: z.string(), bytes: z.number().int() }) }),
  z.object({ ok: z.literal(false), code: z.string() }),
])

export type UploadedAsset = { id: string; kind: string; mime: string; bytes: number }

/** The raw file to `/api/assets` (FIRST-RELEASE.md §19 `uploadAsset`): the asset the API kept, or an ApiError with its code (`TOO_LARGE`, `UNSUPPORTED_TYPE`…). */
export const postAsset = async ({ domain, headers, fetchImpl = fetch }: PhotoDeps, file: { uri: string; mimeType: string | null }, { search = '', maxBytes }: { search?: string; maxBytes?: number } = {}): Promise<UploadedAsset> => {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), defaultTimeoutMs * 4)
  try {
    const blob = await (await fetchImpl(file.uri)).blob()
    if (maxBytes !== undefined && blob.size > maxBytes) throw new ApiError('TOO_LARGE', 'The file is over the size the API takes.')
    const response = await fetchImpl(`https://${domain}/api/assets${search}`, {
      method: 'POST',
      headers: { ...headers(), 'content-type': file.mimeType ?? (blob.type || 'application/octet-stream') },
      body: blob,
      signal: abort.signal,
      credentials: 'omit',
    })
    const answer = uploadSchema.safeParse(await response.json())
    if (!answer.success) throw new ApiError('NO_RESPONSE', 'The upload was not answered with the API’s JSON.')
    if (!answer.data.ok) throw new ApiError(answer.data.code, 'The API refused the upload.')
    return answer.data.asset
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError('NO_RESPONSE', 'The upload did not finish.')
  } finally {
    clearTimeout(timer)
  }
}

/** A photo to the API: its asset id. */
export const uploadPhoto = async (deps: PhotoDeps, file: { uri: string; mimeType: string | null }): Promise<string> => {
  const asset = await postAsset(deps, file)
  if (asset.kind !== 'image') throw new ApiError('UNSUPPORTED_TYPE', 'The API kept the file as something other than an image.')
  return asset.id
}
