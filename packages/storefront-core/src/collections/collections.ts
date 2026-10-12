'use client'

import { z } from 'zod'
import { useLocation } from '../platform/browser/router'
import { imageSchema, type Photo } from '../platform/media/media'
import { useShopData } from '../platform/render/data'
import { useHead } from '../platform/seo/head'
import { useListing, type Listing } from '../products/listing'

// Collections (ARCHITECTURE §2.1 `collections`): one collection's page with its products, and the list a home page shows.

const text = z.string().nullable().optional()

export type CollectionCard = { id: string; name: string; description: string | null; href: string; image: Photo | null }

const fields = 'id name slug description seoTitle seoDescription image { url }'
const collectionSchema = z.object({ id: text, name: text, slug: text, description: text, seoTitle: text, seoDescription: text, image: imageSchema })
type Decoded = z.infer<typeof collectionSchema>

export const collectionPath = (slug: string) => `/collections/${encodeURIComponent(slug)}/`

const card = (c: Decoded): CollectionCard | null => (c.id && c.name && c.slug ? { id: c.id, name: c.name, description: c.description ?? null, href: collectionPath(c.slug), image: c.image } : null)

/** The segment after `prefix` in `path` (`/collections/linen/` → `linen`), or null. */
export const itemSlug = (path: string, prefix: string): string | null => {
  if (!path.startsWith(prefix)) return null
  const segment = path.slice(prefix.length).split('/')[0] ?? ''
  try {
    const slug = decodeURIComponent(segment)
    return slug && slug.length <= 200 ? slug : null
  } catch {
    return null
  }
}

const oneSchema = z.object({ collection: collectionSchema.nullable() })

/** `/collections/all/` lists every product unless the store has a collection of its own at that address. */
export const allSlug = 'all'

export type CollectionPage = Listing & {
  /** `missing`: no collection has this address (or it is hidden); the theme shows its not-found state. */
  found: 'loading' | 'found' | 'missing' | 'error'
  collection: CollectionCard | null
  /** Every product, at `/collections/all/`; the theme names the page in its own words. */
  all: boolean
}

/** The collection the address names, its products filtered, sorted and paged by the address, and its head. */
export const useCollection = (): CollectionPage => {
  const { path } = useLocation()
  const slug = itemSlug(path, '/collections/')
  const meta = useShopData(slug ? JSON.stringify(['collection', slug]) : null, async (client) => (await client.query(`query Collection($slug: String!) { collection(slug: $slug) { ${fields} } }`, oneSchema, { slug })).collection)
  const decoded = meta.data ?? null
  const collection = decoded ? card(decoded) : null
  const all = slug === allSlug && meta.status === 'ready' && !collection
  // Every product waits to learn whether `all` is the store's own collection; any other collection loads at once.
  const listing = useListing({ collection: all ? null : slug }, slug !== null && (slug !== allSlug || meta.status === 'ready'))
  const found = all ? 'found' : slug === null || (meta.status === 'ready' && !collection) ? 'missing' : meta.status === 'ready' ? 'found' : meta.status === 'error' ? 'error' : 'loading'
  useHead({ title: decoded?.seoTitle ?? collection?.name, description: decoded?.seoDescription ?? collection?.description, canonical: collection || all ? listing.canonical : null, hidden: found === 'missing' || undefined })
  return { ...listing, retry: () => (meta.status === 'error' ? meta.retry() : listing.retry()), found, collection, all }
}

const listSchema = z.object({ collections: z.object({ nodes: z.array(collectionSchema).nullable().optional() }).nullable() })

/** The store's collections, as many as `first` (at most 50), for a home page or a menu. */
export const useCollections = ({ first = 12 }: { first?: number } = {}) => {
  const count = Math.min(Math.max(Math.floor(first), 1), 50)
  const list = useShopData(JSON.stringify(['collections', count]), async (client) => {
    const { collections } = await client.query(`query Collections($first: Int) { collections(first: $first) { nodes { ${fields} } } }`, listSchema, { first: count })
    return (collections?.nodes ?? []).flatMap((c) => card(c) ?? [])
  })
  return { status: list.status, retry: list.retry, collections: list.data ?? [] }
}
