import { z } from 'zod'
import { ApiError, typedQuery, type ApiClient } from '../graphql'
import { postAsset, type PhotoDeps } from './products'

// A download's file, a service's details and a gift card's expiry (FIRST-RELEASE (store) §11; apps/api src/apis/store/productKinds.ts).
// The merchant side's: a supplier sells physical items only.

/** The API's choices for a download's link. */
export const downloadLimits = [3, 5, 10] as const
export const downloadDays = [7, 30, 365] as const
/** A download's file, up to 30 MB while uploads go through the Worker's memory (`errors.productFile.TOO_LARGE` and `kinds.download.uploadHint` say it). */
export const maxDownloadBytes = 30 * 1024 * 1024
export const maxServiceDuration = 60
export const maxServiceLocation = 200
/** How long a gift card may last, in months; none shorter than the API's `shortestMonths`. */
export const giftCardMonths = [12, 24, 36, 60, 84, 120] as const

const fileSchema = z.object({ id: z.string(), mime: z.string(), bytes: z.number().int() })
export type DownloadFile = z.infer<typeof fileSchema>

const kindSchema = z.object({
  productId: z.string(),
  productType: z.string(),
  revision: z.number().int(),
  download: z.object({ mode: z.enum(['file', 'keys']), file: fileSchema.nullable(), limit: z.number().int(), days: z.number().int() }).nullable(),
  service: z.object({ duration: z.string().nullable(), location: z.string().nullable() }).nullable(),
  giftCard: z.object({ expiryMonths: z.number().int().nullable(), shortestMonths: z.number().int() }).nullable(),
})
export type ProductKindView = z.infer<typeof kindSchema>

const kindFields = 'productId productType revision download { mode file { id mime bytes } limit days } service { duration location } giftCard { expiryMonths shortestMonths }'

export const loadProductKind = async (client: ApiClient, productId: string): Promise<ProductKindView | null> =>
  (await typedQuery(client)(`query ProductKind($id: ID!) { productKind(productId: $id) { ${kindFields} } }`, z.object({ productKind: kindSchema.nullable() }), { id: productId })).productKind

/** Exactly one of the three, the product's own kind. */
export type ProductKindInput = {
  download?: { mode: 'file' | 'keys'; fileId: string | null; limit: number; days: number }
  service?: { duration: string | null; location: string | null }
  giftCard?: { expiryMonths: number | null }
}

/** At the revision the product's own save answered; answers the product's next one. */
export const saveProductKind = async (client: ApiClient, productId: string, revision: number, input: ProductKindInput): Promise<ProductKindView> =>
  (
    await typedQuery(client)(
      `mutation SaveProductKind($id: ID!, $revision: Int!, $input: ProductKindInput!) { saveProductKind(productId: $id, revision: $revision, input: $input) { ${kindFields} } }`,
      z.object({ saveProductKind: kindSchema }),
      { id: productId, revision, input },
    )
  ).saveProductKind

/** A download's file to `/api/assets?kind=download`, kept privately: its asset, or an ApiError with the API's code. A picker's size is checked first, so a file over the limit is never read. */
export const uploadDownload = async (deps: PhotoDeps, file: { uri: string; mimeType: string | null; size: number | null }): Promise<DownloadFile> => {
  if (file.size !== null && file.size > maxDownloadBytes) throw new ApiError('TOO_LARGE', 'The file is over the size the API takes.')
  const asset = await postAsset(deps, file, { search: '?kind=download', maxBytes: maxDownloadBytes })
  if (asset.kind !== 'file') throw new ApiError('UNSUPPORTED_TYPE', 'The API kept the file as something other than a download.')
  return { id: asset.id, mime: asset.mime, bytes: asset.bytes }
}
