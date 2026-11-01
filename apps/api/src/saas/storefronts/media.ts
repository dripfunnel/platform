import type { RecordedAnswer } from './catalogue'
import { mediaFile, mediaFolder } from './layout'

// The catalogue's pictures on the asset host (LIVE-SHOP §2, §4 step 3): a live build names each one's public copy, so
// no Worker or database serves them.

const assetId = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const shopPicture = new RegExp(`^/shop-api/assets/(${assetId})$`)
const namedPicture = new RegExp(`(?:^/shop-api/assets|/media)/(${assetId})$`)
const maxKeysPerDelete = 1000
// The catalogue's own picture types (core/media.ts `sniffMedia`); an SVG is never served from the public host.
const pictureTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
// Nothing purges the asset host, so a deleted copy (DATA-MODEL §7.11) stops being served once this passes.
const cacheControl = 'public, max-age=3600'
const copiesAtOnce = 8
// Each new copy is a lookup, a read and a write within one Workflow step's limits; the rest keep their Shop API
// address until a later publish copies them.
export const maxCopiesPerStep = 200

export interface PictureCopies {
  /** The media library (`ASSETS`), which holds each picture's file. */
  library: { get: (key: string) => Promise<{ body: ReadableStream } | null> }
  /** `storefront-assets`, behind the asset host. */
  published: {
    list: (options: { prefix: string; cursor?: string }) => Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>
    put: (key: string, value: ReadableStream, options: { httpMetadata: { contentType: string; cacheControl: string } }) => Promise<unknown>
  }
  /** The asset host, `https://sf-assets.<SHOP_DOMAIN>`. */
  origin: string
}

/** A store's file a shopper may see, or null: the Shop API's own lookup, so a hidden product's picture is never copied. */
type ShopFile =(assetId: string) => Promise<{ r2_key: string; mime: string } | null>

const isPicture = (value: unknown): value is { url: string } => typeof value === 'object' && value !== null && typeof (value as { url?: unknown }).url === 'string'

/** Each picture (`image { url }`) in `value`. */
function* picturesIn(value: unknown): Generator<{ url: string }> {
  if (typeof value !== 'object' || value === null) return
  for (const [key, v] of Object.entries(value)) {
    if (key === 'image' && isPicture(v)) yield v
    else yield* picturesIn(v)
  }
}

/** `value` with each picture at the address `swap` gives it. */
const withPictures = (value: unknown, swap: (url: string) => string): unknown => {
  if (Array.isArray(value)) return value.map((v) => withPictures(v, swap))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, key === 'image' && isPicture(v) ? { ...v, url: swap(v.url) } : withPictures(v, swap)]))
}

const idsIn = (answers: readonly RecordedAnswer[], pattern: RegExp): Set<string> => {
  const ids = new Set<string>()
  for (const answer of answers) {
    for (const { url } of picturesIn(answer.data)) {
      const id = pattern.exec(url)?.[1]
      if (id) ids.add(id)
    }
  }
  return ids
}

/** The asset ids of the pictures `answers` name, at the Shop API's address or as a copy. */
export const pictureIds = (answers: readonly RecordedAnswer[]): Set<string> => idsIn(answers, namedPicture)

/** The asset ids already copied for the store: one listing, rather than a request per picture. */
export const copiedIds = async (bucket: Pick<PictureCopies['published'], 'list'>, storeId: string): Promise<Set<string>> => {
  const prefix = mediaFolder(storeId)
  const ids = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) })
    for (const object of page.objects) ids.add(object.key.slice(prefix.length))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return ids
}

/** Deletes the store's copies of these files, in R2's batches of at most 1,000 keys. */
export const deleteCopies = async (bucket: { delete: (keys: string[]) => Promise<unknown> }, storeId: string, ids: readonly string[]): Promise<void> => {
  for (let i = 0; i < ids.length; i += maxKeysPerDelete) await bucket.delete(ids.slice(i, i + maxKeysPerDelete).map((id) => mediaFile(storeId, id)))
}

/** Copies the answers' pictures not yet on the asset host, at most `maxCopiesPerStep`, then names every copy in their place. */
export const publishPictures = async (copies: PictureCopies, storeId: string, answers: RecordedAnswer[], fileOf: ShopFile): Promise<RecordedAnswer[]> => {
  const named = idsIn(answers, shopPicture)
  if (named.size === 0) return answers
  const published = await copiedIds(copies.published, storeId)
  const missing = [...named].filter((id) => !published.has(id)).slice(0, maxCopiesPerStep)
  for (let i = 0; i < missing.length; i += copiesAtOnce) {
    await Promise.all(
      missing.slice(i, i + copiesAtOnce).map(async (id) => {
        const file = await fileOf(id)
        const object = file && pictureTypes.has(file.mime) ? await copies.library.get(file.r2_key) : null
        if (!file || !object) return
        // Streamed: a picture may be 20 MB (core/media.ts `maxImageBytes`), several at a time.
        await copies.published.put(mediaFile(storeId, id), object.body, { httpMetadata: { contentType: file.mime, cacheControl } })
        published.add(id)
      }),
    )
  }
  // A picture that wasn't copied keeps its Shop API address, which still answers it.
  const swap = (url: string) => {
    const id = shopPicture.exec(url)?.[1]
    return id && published.has(id) ? `${copies.origin}/${mediaFile(storeId, id)}` : url
  }
  return answers.map((answer) => ({ ...answer, data: withPictures(answer.data, swap) as Record<string, unknown> }))
}
