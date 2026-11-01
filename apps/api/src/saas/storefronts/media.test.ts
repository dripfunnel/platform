import { describe, expect, it } from 'vitest'
import type { RecordedAnswer } from './catalogue'
import { maxCopiesPerStep, publishedPictureIds, publishPictures, type PictureCopies } from './media'

// Card #1105: a live build's pictures are copied to the asset host and named there (LIVE-SHOP §2, §4 step 3).

const store = '11111111-1111-4111-8111-111111111111'
const shirt = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const mug = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const logo = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const origin = 'https://sf-assets.my-store.one'
const copyOf = (id: string) => `${origin}/stores/${store}/media/${id}`
const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const answers = (): RecordedAnswer[] => [
  { operation: 'Product', variables: { slug: 'shirt' }, data: { product: { photos: [{ alt: 'Front', image: { url: `/shop-api/assets/${shirt}` } }], video: { file: { url: `/shop-api/assets/${mug}` } }, related: [{ photo: { image: { url: `/shop-api/assets/${mug}` } } }] } } },
  { operation: 'Collection', variables: { slug: 'summer' }, data: { collection: { image: { url: `/shop-api/assets/${logo}` } } } },
]

/** The media library and the asset host in memory; `listed` counts the asset host's listings. */
const buckets = () => {
  const published = new Map<string, { contentType: string; cacheControl: string }>()
  const counts = { listed: 0 }
  const copies: PictureCopies = {
    library: { get: async (key) => ({ body: new Blob([key]).stream() }) },
    published: {
      list: async ({ prefix }) => (counts.listed++, { objects: [...published.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
      put: async (key, value, { httpMetadata }) => {
        await new Response(value).arrayBuffer()
        published.set(key, httpMetadata)
      },
    },
    origin,
  }
  return { copies, published, counts }
}

// A shirt and a mug are pictures shoppers see; the logo is an SVG, never published from the asset host.
const files: Record<string, { r2_key: string; mime: string }> = {
  [shirt]: { r2_key: 'k/shirt', mime: 'image/webp' },
  [mug]: { r2_key: 'k/mug', mime: 'image/png' },
  [logo]: { r2_key: 'k/logo', mime: 'image/svg+xml' },
}
const fileOf = async (id: string) => files[id] ?? { r2_key: `k/${id}`, mime: 'image/jpeg' }

describe('publishPictures', () => {
  it('copies each picture once with its own type and an hour’s cache, and names the copy in its place', async () => {
    const { copies, published } = buckets()
    const out = await publishPictures(copies, store, answers(), fileOf)
    expect([...published.keys()].sort()).toEqual([`stores/${store}/media/${mug}`, `stores/${store}/media/${shirt}`].sort())
    expect(published.get(`stores/${store}/media/${shirt}`)).toEqual({ contentType: 'image/webp', cacheControl: 'public, max-age=3600' })
    expect(out[0]?.data).toEqual({ product: { photos: [{ alt: 'Front', image: { url: copyOf(shirt) } }], video: { file: { url: `/shop-api/assets/${mug}` } }, related: [{ photo: { image: { url: copyOf(mug) } } }] } })
    // An SVG keeps the Shop API's address, which serves it with its own CSP.
    expect(out[1]?.data).toEqual({ collection: { image: { url: `/shop-api/assets/${logo}` } } })
  })

  it('lists the asset host once and looks up only the files not copied yet', async () => {
    const { copies, published, counts } = buckets()
    await publishPictures(copies, store, answers(), fileOf)
    const asked: string[] = []
    counts.listed = 0
    const out = await publishPictures(copies, store, answers(), async (id) => (asked.push(id), fileOf(id)))
    expect(counts.listed).toBe(1)
    expect(asked).toEqual([logo])
    expect(published.size).toBe(2)
    expect(publishedPictureIds(out)).toEqual(new Set([shirt, mug]))
  })

  it('leaves a picture shoppers may not see at its Shop API address', async () => {
    const { copies, published } = buckets()
    const out = await publishPictures(copies, store, answers(), async (id) => (id === shirt ? null : fileOf(id)))
    expect(published.size).toBe(1)
    expect(publishedPictureIds(out)).toEqual(new Set([mug]))
    expect(JSON.stringify(out)).toContain(`/shop-api/assets/${shirt}`)
  })

  it('copies at most a step’s share across several batches, and names the rest by the Shop API until a later step', async () => {
    const { copies, published } = buckets()
    const many: RecordedAnswer[] = [{ operation: 'Listing', variables: {}, data: { products: { nodes: Array.from({ length: maxCopiesPerStep + 5 }, (_, n) => ({ photo: { image: { url: `/shop-api/assets/${idOf(n)}` } } })) } } }]
    const first = await publishPictures(copies, store, many, fileOf)
    expect(published.size).toBe(maxCopiesPerStep)
    expect(publishedPictureIds(first).size).toBe(maxCopiesPerStep)
    expect(publishedPictureIds(await publishPictures(copies, store, many, fileOf)).size).toBe(maxCopiesPerStep + 5)
  })

  it('asks nothing when the answers name no picture', async () => {
    const { copies, counts } = buckets()
    const none: RecordedAnswer[] = [{ operation: 'Menu', variables: {}, data: { menu: [] } }]
    expect(await publishPictures(copies, store, none, fileOf)).toBe(none)
    expect(counts.listed).toBe(0)
  })
})
