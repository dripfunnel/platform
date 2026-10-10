import { z } from 'zod'
import { postAsset, type UploadRefusal } from './productEditor'
import { query } from './client'

// A download's file or key pool and a service's details (CatEditor; CATALOG-DESIGN T14; apps/api
// src/apis/store/productKinds.ts). The merchant side's: a supplier sells physical items only.

/** The API's choices for a download's link (CATALOG T14). */
export const downloadLimits = [3, 5, 10] as const
export const downloadDays = [7, 30, 365] as const
/** A download's file, up to 30 MB while uploads go through the Worker's memory (CATALOG T14). */
export const maxDownloadBytes = 30 * 1024 * 1024
export const maxKeysPerSave = 1000
export const maxKeyLength = 200
export const maxServiceDuration = 60
export const maxServiceLocation = 200

const fileSchema = z.object({ id: z.string(), mime: z.string(), bytes: z.number().int() })
export type DownloadFile = z.infer<typeof fileSchema>

const kindSchema = z.object({
  productId: z.string(),
  productType: z.string(),
  revision: z.number().int(),
  download: z.object({ mode: z.enum(['file', 'keys']), file: fileSchema.nullable(), limit: z.number().int(), days: z.number().int(), keysLeft: z.number().int(), keysSold: z.number().int() }).nullable(),
  service: z.object({ duration: z.string().nullable(), location: z.string().nullable() }).nullable(),
})
export type ProductKindView = z.infer<typeof kindSchema>

const kindFields = 'productId productType revision download { mode file { id mime bytes } limit days keysLeft keysSold } service { duration location }'

export const loadProductKind = async (productId: string): Promise<ProductKindView | null> =>
  (await query(`query K($id: ID!) { productKind(productId: $id) { ${kindFields} } }`, z.object({ productKind: kindSchema.nullable() }), { id: productId })).productKind

/** Exactly one, the product's own kind; answers the product's next revision. */
export interface ProductKindInput {
  download?: { mode: 'file' | 'keys'; fileId: string | null; limit: number; days: number }
  service?: { duration: string | null; location: string | null }
}

export const saveProductKind = async (productId: string, revision: number, input: ProductKindInput): Promise<ProductKindView> =>
  (await query(`mutation S($id: ID!, $revision: Int!, $input: ProductKindInput!) { saveProductKind(productId: $id, revision: $revision, input: $input) { ${kindFields} } }`, z.object({ saveProductKind: kindSchema }), { id: productId, revision, input })).saveProductKind

/** Keys go in once and are only counted after; a key already in the pool is skipped. */
export const addLicenceKeys = async (productId: string, keys: readonly string[]): Promise<ProductKindView> =>
  (await query(`mutation A($id: ID!, $keys: [String!]!) { addLicenceKeys(productId: $id, keys: $keys) { ${kindFields} } }`, z.object({ addLicenceKeys: kindSchema }), { id: productId, keys })).addLicenceKeys

/** A download's file to `/api/assets?kind=download`, stored privately: its asset, or why not. */
export const uploadDownload = async (file: File): Promise<{ ok: true; file: DownloadFile } | { ok: false; code: UploadRefusal }> => {
  if (file.size > maxDownloadBytes) return { ok: false, code: 'TOO_LARGE' }
  const answer = await postAsset(file, '?kind=download')
  if (!answer.ok) return answer
  return answer.asset.kind === 'file' ? { ok: true, file: { id: answer.asset.id, mime: answer.asset.mime, bytes: answer.asset.bytes } } : { ok: false, code: 'UNSUPPORTED_TYPE' }
}
