import { parseCsv } from '#core/csv'
import { checkMedia } from '#core/media'
import { importLimits, planImport, problemWords, type AssetStore, type ImportPlan } from '#engine/modules/catalog/index'
import type { DnsLookup } from '#integrations/dns/doh'
import { fetchPublic } from '#integrations/http/publicFetch'
import type { SampleCollection } from '#db/scoped/storeCategories'

// A category's sample catalog as staff upload it (DATA-MODEL §7.2, CATALOG-DESIGN A4): the merchant import's own file
// (CATALOG K) plus a `collection` column, checked here so a problem reaches staff, never a merchant.

export const maxSampleProducts = 50
export const maxSampleCollections = 10
const maxSamplePhotos = 60
const maxPhotoBytes = 20 * 1024 * 1024
export const maxSampleFileBytes = 1024 * 1024

export type SampleProblemCode =
  | 'FILE_UNREADABLE'
  | 'PRODUCT_COUNT'
  | 'SKU_REQUIRED'
  | 'NO_COLLECTION_COLUMN'
  | 'COLLECTION_COUNT'
  | 'COLLECTION_EMPTY'
  | 'TOO_MANY_PHOTOS'
  | 'PHOTO_UNAVAILABLE'
  | 'PHOTO_REFUSED'
  | 'NO_STORAGE'

const sampleWords: Record<SampleProblemCode, string> = {
  FILE_UNREADABLE: 'This file can’t be read as a product spreadsheet.',
  PRODUCT_COUNT: `A sample catalog has 1 to ${maxSampleProducts} products.`,
  SKU_REQUIRED: 'Every product and version needs a SKU, so the sample’s collections can find it.',
  NO_COLLECTION_COLUMN: 'Add a “collection” column naming each product’s collection.',
  COLLECTION_COUNT: `A sample catalog has 1 to ${maxSampleCollections} collections, each with at least one product.`,
  COLLECTION_EMPTY: 'Every collection needs at least one product. Add a product to it or delete it.',
  TOO_MANY_PHOTOS: `A sample catalog can have up to ${maxSamplePhotos} photos.`,
  PHOTO_UNAVAILABLE: 'This photo couldn’t be downloaded from its address.',
  PHOTO_REFUSED: 'This address isn’t a photo we can use (a JPEG, PNG or WebP up to 20 MB).',
  NO_STORAGE: 'Photos can’t be stored here right now. Try again later.',
}

export interface SampleProblem {
  line: number
  column: string | null
  code: string
  message: string
}

export interface PhotoCopier {
  assets: AssetStore | null
  lookup: DnsLookup
  fetchImpl?: typeof fetch
}

const problem = (line: number, column: string | null, code: SampleProblemCode): SampleProblem => ({ line, column, code, message: sampleWords[code] })

/** Each product's collections from the sample-only `collection` column (names split on `;`), in first-seen order. */
const collectionsOf = (file: string, plan: ImportPlan): SampleCollection[] | SampleProblem => {
  const table = parseCsv(file)
  const header = table?.[0]?.map((h) => h.trim().toLowerCase())
  const column = header?.indexOf('collection') ?? -1
  if (!table || column < 0) return problem(1, null, 'NO_COLLECTION_COLUMN')
  const byName = new Map<string, Set<string>>()
  for (const p of plan.products) {
    const names = new Set(p.lines.flatMap((line) => (table[line - 1]?.[column] ?? '').split(';').map((n) => n.trim()).filter((n) => n !== '')))
    for (const name of names) {
      const skus = byName.get(name) ?? new Set<string>()
      for (const v of p.input.versions) if (v.sku) skus.add(v.sku)
      byName.set(name, skus)
    }
  }
  const all = [...byName].map(([name, skus]) => ({ name: name.slice(0, 100), skus: [...skus] }))
  return all.length >= 1 && all.length <= maxSampleCollections && all.every((c) => c.skus.length > 0) ? all : problem(1, 'collection', 'COLLECTION_COUNT')
}

export type CheckedSample = { ok: true; collections: SampleCollection[]; plan: ImportPlan } | { ok: false; problems: SampleProblem[] }

/** The file as a merchant's import would read it in `currency`: no problem, 1 to 50 products each SKU'd, 1 to 10 collections. */
export const checkSampleFile = (file: string, currency: string): CheckedSample => {
  if (new TextEncoder().encode(file).byteLength > maxSampleFileBytes) return { ok: false, problems: [problem(0, null, 'FILE_UNREADABLE')] }
  const plan = planImport(file, { currency, languages: [], manualCurrencies: [], supplier: false, expect: 'csv', samplePhotos: true })
  if (typeof plan === 'string') return { ok: false, problems: [problem(0, null, 'FILE_UNREADABLE')] }
  const problems: SampleProblem[] = plan.problems.map((p) => ({ line: p.line, column: p.column, code: p.code, message: problemWords[p.code] }))
  if (plan.products.length < 1 || plan.products.length > maxSampleProducts) problems.push(problem(0, null, 'PRODUCT_COUNT'))
  for (const p of plan.products) if (!p.input.versions.every((v) => v.sku)) problems.push(problem(p.lines[0] ?? 0, 'sku', 'SKU_REQUIRED'))
  const collections = collectionsOf(file, plan)
  if (!Array.isArray(collections)) problems.push(collections)
  if (problems.length > 0 || !Array.isArray(collections)) return { ok: false, problems }
  return { ok: true, collections, plan }
}

/** A photo staff uploaded in the editor, as the sample file names it in its `image` column. */
export const sampleRefPrefix = 'sample-photo:'
export const samplePhotoKey = (categoryId: string, sha: string) => `platform/store-category-samples/${categoryId}/${sha}`
/** The R2 key of a `sample-photo:` ref; null for a malformed one, undefined when `url` isn't a ref. */
export const sampleRefKey = (categoryId: string, url: string): string | null | undefined => {
  if (!url.startsWith(sampleRefPrefix)) return undefined
  const sha = url.slice(sampleRefPrefix.length)
  return /^[0-9a-f]{64}$/.test(sha) ? samplePhotoKey(categoryId, sha) : null
}

/** An image staff upload for a sample (Super admin, the editor's Upload): stored once under the category, answered as a ref. */
export const storeSamplePhoto = async (
  categoryId: string,
  bytes: Uint8Array<ArrayBuffer>,
  assets: AssetStore | null,
): Promise<{ ok: true; ref: string; key: string } | { ok: false; code: 'NO_STORAGE' | 'PHOTO_REFUSED' }> => {
  if (!assets) return { ok: false, code: 'NO_STORAGE' }
  const media = checkMedia(bytes)
  if (!media.ok || media.type.kind !== 'image') return { ok: false, code: 'PHOTO_REFUSED' }
  const sha = hex(await crypto.subtle.digest('SHA-256', bytes))
  const key = samplePhotoKey(categoryId, sha)
  await assets.put(key, bytes, { httpMetadata: { contentType: media.type.mime } })
  return { ok: true, ref: `${sampleRefPrefix}${sha}`, key }
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Every photo the file names, fetched once (SSRF-guarded) and kept under the category's R2 prefix: {url: key}. */
export const copySamplePhotos = async (
  categoryId: string,
  plan: ImportPlan,
  c: PhotoCopier | null,
  current: Readonly<Record<string, string>> = {},
): Promise<{ ok: true; photos: Record<string, string> } | { ok: false; problems: SampleProblem[] }> => {
  const lineOf = new Map<string, number>()
  for (const p of plan.products) for (const photo of p.photos) if (!lineOf.has(photo.url)) lineOf.set(photo.url, photo.line)
  if (lineOf.size === 0) return { ok: true, photos: {} }
  if (lineOf.size > maxSamplePhotos) return { ok: false, problems: [problem(0, 'image', 'TOO_MANY_PHOTOS')] }
  const assets = c?.assets
  if (!c || !assets) return { ok: false, problems: [problem(0, 'image', 'NO_STORAGE')] }
  const photos: Record<string, string> = {}
  const problems: SampleProblem[] = []
  const urls = [...lineOf.keys()]
  // Four at a time, as the import's own photo job does (outbox-relay.ts).
  for (let i = 0; i < urls.length; i += 4) {
    await Promise.all(
      urls.slice(i, i + 4).map(async (url) => {
        const line = lineOf.get(url) ?? 0
        // Uploaded in the editor: already under this category's prefix, never fetched (DATA-MODEL §7.2).
        const uploaded = sampleRefKey(categoryId, url)
        if (uploaded !== undefined) {
          if (uploaded === null || !(await assets.get(uploaded))) return problems.push(problem(line, 'image', 'PHOTO_UNAVAILABLE'))
          photos[url] = uploaded
          return undefined
        }
        // Copied on an earlier save: kept, not fetched again.
        const kept = Object.hasOwn(current, url) ? current[url] : undefined
        if (kept) {
          photos[url] = kept
          return undefined
        }
        const got = url.length > importLimits.photoUrl ? null : await fetchPublic(url, { lookup: c.lookup, maxBytes: maxPhotoBytes, timeoutMs: 5_000, tries: 2, ...(c.fetchImpl ? { fetchImpl: c.fetchImpl } : {}) })
        if (!got?.ok) return problems.push(problem(line, 'image', got?.code === 'TOO_LARGE' ? 'PHOTO_REFUSED' : 'PHOTO_UNAVAILABLE'))
        const media = checkMedia(got.bytes)
        if (!media.ok || media.type.kind !== 'image') return problems.push(problem(line, 'image', 'PHOTO_REFUSED'))
        const key = samplePhotoKey(categoryId, hex(await crypto.subtle.digest('SHA-256', got.bytes)))
        await assets.put(key, got.bytes, { httpMetadata: { contentType: media.type.mime } })
        photos[url] = key
        return undefined
      }),
    )
  }
  return problems.length > 0 ? { ok: false, problems: problems.sort((a, b) => a.line - b.line) } : { ok: true, photos }
}
