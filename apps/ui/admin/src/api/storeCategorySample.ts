import { z } from 'zod'
import { query } from './client'
import { isoString } from './decode'
import type { SampleProblem, StoreCategory } from './storeCategories'

// A category's sample catalog in the editor (admin FIRST-RELEASE §11b; apps/api schema `storeCategorySample`,
// `saveStoreCategorySampleItems`), and its photos on plain HTTP (apps/api/src/apis/admin/samplePhotos.ts).

const photoSchema = z.object({ ref: z.string(), previewUrl: z.string().nullable() })
const productSchema = z.object({
  handle: z.string(),
  name: z.string(),
  description: z.string(),
  sku: z.string(),
  price: z.string(),
  stock: z.number().int().nullable(),
  visible: z.boolean(),
  photos: z.array(photoSchema),
  collections: z.array(z.string()),
})
export type SampleProduct = z.infer<typeof productSchema>

const detailSchema = z.object({
  currency: z.string(),
  uploadedAt: isoString,
  products: z.array(productSchema),
  collections: z.array(z.object({ name: z.string(), products: z.number().int(), photo: photoSchema.nullable() })),
})
export type SampleDetail = z.infer<typeof detailSchema>

const problemSchema = z.object({ line: z.number().int(), column: z.string().nullable(), code: z.string(), message: z.string() })

export const loadStoreCategorySample = async (categoryId: string): Promise<SampleDetail | null> => {
  const { storeCategorySample } = await query(
    `query StoreCategorySample($categoryId: ID!) { storeCategorySample(categoryId: $categoryId) {
      currency uploadedAt collections { name products photo { ref previewUrl } }
      products { handle name description sku price stock visible photos { ref previewUrl } collections } } }`,
    z.object({ storeCategorySample: detailSchema.nullable() }),
    { categoryId },
  )
  return storeCategorySample
}

export interface SampleItemsInput {
  currency: string
  products: { name: string; description: string; sku: string; price: string; stock: number | null; visible: boolean; photos: string[]; collections: string[] }[]
  collections: string[]
  collectionPhotos: { name: string; photo: string }[]
}

/** The editor's Save: problems (with `saved` false) when the sample didn't pass its check; nothing is kept then. */
export const saveStoreCategorySampleItems = async (categoryId: string, input: SampleItemsInput, reason: string): Promise<{ saved: boolean; problems: SampleProblem[] }> => {
  const { saveStoreCategorySampleItems: answer } = await query(
    `mutation SaveSampleItems($categoryId: ID!, $input: StoreCategorySampleInput!, $reason: String!) {
      saveStoreCategorySampleItems(categoryId: $categoryId, input: $input, reason: $reason) { category { id } problems { line column code message } } }`,
    z.object({ saveStoreCategorySampleItems: z.object({ category: z.object({ id: z.string() }).nullable(), problems: z.array(problemSchema) }) }),
    { categoryId, input, reason },
  )
  return { saved: answer.category !== null, problems: answer.problems }
}

export const photoRefusals = ['TOO_LARGE', 'PHOTO_REFUSED', 'NO_STORAGE', 'NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED', 'NOT_CONNECTED'] as const
export type PhotoRefusal = (typeof photoRefusals)[number]

const uploadAnswer = z.union([z.object({ ok: z.literal(true), ref: z.string(), previewUrl: z.string() }), z.object({ ok: z.literal(false), code: z.string() })])

/** A photo for a sample product or collection, stored once under the category (Super admin); answers the ref the product names. */
export const uploadSamplePhoto = async (categoryId: string, file: Blob): Promise<{ ok: true; ref: string; previewUrl: string } | { ok: false; code: PhotoRefusal }> => {
  try {
    const response = await fetch(`/api/store-category-photos?${new URLSearchParams({ category: categoryId })}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
      signal: AbortSignal.timeout(60_000),
    })
    const answer = uploadAnswer.safeParse(await response.json())
    if (!answer.success) return { ok: false, code: 'NOT_CONNECTED' }
    if (answer.data.ok) return answer.data
    const code = answer.data.code
    return { ok: false, code: photoRefusals.find((known) => known === code) ?? 'NOT_CONNECTED' }
  } catch {
    return { ok: false, code: 'NOT_CONNECTED' }
  }
}

export type { StoreCategory }
