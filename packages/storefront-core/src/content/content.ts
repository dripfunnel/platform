'use client'

import { useMemo, useState } from 'react'
import { z } from 'zod'
import { itemSlug } from '../collections/collections'
import { useLocation } from '../platform/browser/router'
import { photoOf, type Photo } from '../platform/media/media'
import { useShopData } from '../platform/render/data'
import { useHead } from '../platform/seo/head'
import { useStorefront } from '../platform/store/context'
import { cardsSchema, moneyFields, type ProductCard } from '../products/summary'

// Content pages and the blog (storefront ARCHITECTURE §3.1, SAPI 24 as built on #338): a page at `/{slug}/`, a post at
// `/blog/{slug}/`, the merchant's own words as plain text in blocks the theme draws. Nothing here is markup.

export type ContentBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'image'; photo: Photo }
  | { kind: 'faq'; items: { question: string; answer: string }[] }
  | { kind: 'products'; slugs: string[] }
  /** The merchant's contact form: the Shop API takes no message yet, so a theme leaves it out or points to the store's email. */
  | { kind: 'form' }

const text = z.string().nullable().optional()
const blockFields = 'kind text alt image { url } items { question answer } productSlugs'
const blockSchema = z.object({ kind: text, text, alt: text, image: z.object({ url: text }).nullable().optional(), items: z.array(z.object({ question: text, answer: text })).nullable().optional(), productSlugs: z.array(z.string()).nullable().optional() })

/** The blocks a theme can draw; one of a kind core doesn't know, or left empty, is dropped rather than failing the page. */
const blocksOf = (body: z.infer<typeof blockSchema>[] | null | undefined): ContentBlock[] =>
  (body ?? []).flatMap((b): ContentBlock[] => {
    if ((b.kind === 'heading' || b.kind === 'text') && b.text) return [{ kind: b.kind, text: b.text }]
    if (b.kind === 'image' && b.image?.url) return [{ kind: 'image', photo: photoOf(b.image.url, b.alt ?? null) }]
    if (b.kind === 'faq') {
      const items = (b.items ?? []).flatMap((i) => (i.question && i.answer ? [{ question: i.question, answer: i.answer }] : []))
      return items.length > 0 ? [{ kind: 'faq', items }] : []
    }
    if (b.kind === 'products' && b.productSlugs?.length) return [{ kind: 'products', slugs: b.productSlugs }]
    if (b.kind === 'form') return [{ kind: 'form' }]
    return []
  })

export type ContentPage = { title: string; path: string; body: ContentBlock[]; updatedAt: string | null }

export type ContentPageView = { status: 'loading' | 'ready' | 'missing' | 'error'; code: string | null; page: ContentPage | null; retry: () => void }

const pageQuery = `query ContentPage($slug: String!) { contentPage(slug: $slug) { title path slug seoTitle seoDescription updatedAt body { ${blockFields} } } }`
const pageSchema = z.object({ contentPage: z.object({ title: text, path: text, slug: text, seoTitle: text, seoDescription: text, updatedAt: text, body: z.array(blockSchema).nullable().optional() }).nullable() })

/** The last segment of an address, so a page under a language prefix (`/hi/faq/`) is the same page. */
const lastSegment = (path: string): string | null => {
  const segment = path.split('/').filter(Boolean).at(-1) ?? ''
  try {
    const slug = decodeURIComponent(segment)
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null
  } catch {
    return null
  }
}

/** The content page the address names (FAQ, lookbook, the merchant's own), with its head. */
export const useContentPage = (): ContentPageView => {
  const { path } = useLocation()
  const slug = lastSegment(path)
  const loaded = useShopData(slug ? JSON.stringify(['contentPage', slug]) : null, (c) => c.query(pageQuery, pageSchema, { slug }))
  const raw = loaded.data?.contentPage ?? null
  const page = useMemo((): ContentPage | null => (raw?.title ? { title: raw.title, path: raw.path ?? `/${raw.slug ?? slug ?? ''}`, body: blocksOf(raw.body), updatedAt: raw.updatedAt ?? null } : null), [raw, slug])
  const status = slug === null || (loaded.status === 'ready' && !page) ? 'missing' : loaded.status === 'ready' ? 'ready' : loaded.status === 'error' ? 'error' : 'loading'
  useHead({ title: page ? (raw?.seoTitle ?? page.title) : null, description: raw?.seoDescription ?? null, canonical: page ? `${page.path.replace(/\/?$/, '/')}` : undefined, hidden: status === 'missing' || undefined })
  return { status, code: loaded.code, page, retry: loaded.retry }
}

export type BlogPost = {
  title: string
  path: string
  author: string | null
  /** When it was published, worded in the store's time zone; `publishedAt` is the instant, ISO 8601 UTC. */
  published: string | null
  publishedAt: string | null
  cover: Photo | null
  /** Each tag with the address of the posts it names (`/blog/?tag=…`, encoded). */
  tags: { name: string; href: string }[]
  body: ContentBlock[]
  /** The post's own first words, for a card: the first text block, cut at a word. */
  excerpt: string | null
}

const postFields = `title path slug author publishedAt tags seoTitle seoDescription cover { url } body { ${blockFields} }`
const postSchema = z.object({ title: text, path: text, slug: text, author: text, publishedAt: text, tags: z.array(z.string()).nullable().optional(), seoTitle: text, seoDescription: text, cover: z.object({ url: text }).nullable().optional(), body: z.array(blockSchema).nullable().optional() })

const excerptOf = (blocks: ContentBlock[]): string | null => {
  const first = blocks.find((b): b is { kind: 'text'; text: string } => b.kind === 'text')?.text ?? null
  if (!first || first.length <= 180) return first
  return `${first.slice(0, 180).replace(/\s+\S*$/, '')}…`
}

const postOf = (p: z.infer<typeof postSchema>, when: (iso: string) => string | null): BlogPost | null => {
  if (!p.title || !(p.path ?? p.slug)) return null
  const body = blocksOf(p.body)
  return {
    title: p.title,
    path: p.path ?? `/blog/${p.slug ?? ''}`,
    author: p.author ?? null,
    published: p.publishedAt ? when(p.publishedAt) : null,
    publishedAt: p.publishedAt ?? null,
    cover: p.cover?.url ? photoOf(p.cover.url, p.title) : null,
    tags: (p.tags ?? []).filter(Boolean).map((name) => ({ name, href: `/blog/?tag=${encodeURIComponent(name)}` })),
    body,
    excerpt: excerptOf(body),
  }
}

const useWhen = () => {
  const { store, locale } = useStorefront()
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: store.timeZone })
    // A date the Shop API sent malformed shows no date rather than taking the list down.
    return (iso: string): string | null => {
      const date = new Date(iso)
      return Number.isNaN(date.getTime()) ? null : format.format(date)
    }
  }, [locale, store.timeZone])
}

export const blogPageSize = 12
const listQuery = `query Blog($first: Int, $after: String, $tag: String) { blogPosts(first: $first, after: $after, tag: $tag) { nodes { ${postFields} } pageInfo { hasNextPage endCursor } } }`
const listSchema = z.object({ blogPosts: z.object({ nodes: z.array(postSchema).nullable().optional(), pageInfo: z.object({ hasNextPage: z.boolean().nullable().optional(), endCursor: text }).nullable().optional() }).nullable() })

export type BlogView = {
  status: 'loading' | 'ready' | 'error'
  code: string | null
  posts: BlogPost[]
  /** `?tag=` when the list is narrowed to one tag. */
  tag: string | null
  more: boolean
  /** The next page of older posts, added below. */
  loadMore: () => Promise<void>
  loadingMore: boolean
  /** The last `loadMore` failed; asking again is the way on. */
  loadMoreFailed: boolean
  retry: () => void
}

/** The blog's posts, newest first, a page at a time; `?tag=` narrows them to one tag. */
export const useBlog = (): BlogView => {
  const { query } = useLocation()
  const { client } = useStorefront()
  const when = useWhen()
  const tag = query.get('tag')?.trim() || null
  const loaded = useShopData(JSON.stringify(['blog', tag]), (c) => c.query(listQuery, listSchema, { first: blogPageSize, after: null, tag }))
  const [later, setLater] = useState<{ tag: string | null; posts: z.infer<typeof postSchema>[]; cursor: string | null; more: boolean } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const first = loaded.data?.blogPosts
  const extra = later?.tag === tag ? later : null
  const cursor = extra ? extra.cursor : (first?.pageInfo?.endCursor ?? null)
  const more = extra ? extra.more : first?.pageInfo?.hasNextPage === true
  const posts = useMemo(() => [...(first?.nodes ?? []), ...(extra?.posts ?? [])].flatMap((p) => postOf(p, when) ?? []), [first, extra, when])
  useHead({ title: null, canonical: '/blog/' })
  return {
    status: loaded.status === 'ready' ? 'ready' : loaded.status === 'error' ? 'error' : 'loading',
    code: loaded.code,
    posts,
    tag,
    more,
    loadingMore,
    loadMoreFailed,
    loadMore: async () => {
      if (!more || loadingMore || !cursor) return
      setLoadingMore(true)
      setLoadMoreFailed(false)
      try {
        const next = (await client.query(listQuery, listSchema, { first: blogPageSize, after: cursor, tag })).blogPosts
        setLater({ tag, posts: [...(extra?.posts ?? []), ...(next?.nodes ?? [])], cursor: next?.pageInfo?.endCursor ?? null, more: next?.pageInfo?.hasNextPage === true })
      } catch {
        setLoadMoreFailed(true)
      } finally {
        setLoadingMore(false)
      }
    },
    retry: loaded.retry,
  }
}

export type BlogPostView = { status: 'loading' | 'ready' | 'missing' | 'error'; code: string | null; post: BlogPost | null; retry: () => void }

const postQuery = `query BlogPost($slug: String!) { blogPost(slug: $slug) { ${postFields} } }`

/** The post the address names (`/blog/{slug}/`), with its head. */
export const useBlogPost = (): BlogPostView => {
  const { path } = useLocation()
  const when = useWhen()
  const slug = itemSlug(path.replace(/^\/[a-z]{2}(?:-[a-z]+)?(?=\/blog\/)/, ''), '/blog/')
  const loaded = useShopData(slug ? JSON.stringify(['blogPost', slug]) : null, (c) => c.query(postQuery, z.object({ blogPost: postSchema.nullable() }), { slug }))
  const raw = loaded.data?.blogPost ?? null
  const post = useMemo(() => (raw ? postOf(raw, when) : null), [raw, when])
  const status = slug === null || (loaded.status === 'ready' && !post) ? 'missing' : loaded.status === 'ready' ? 'ready' : loaded.status === 'error' ? 'error' : 'loading'
  useHead({ title: post ? (raw?.seoTitle ?? post.title) : null, description: raw?.seoDescription ?? post?.excerpt ?? null, canonical: post ? post.path.replace(/\/?$/, '/') : undefined, image: post?.cover?.url, hidden: status === 'missing' || undefined })
  return { status, code: loaded.code, post, retry: loaded.retry }
}

const cardFields = `id name slug inStock price { ${moneyFields} } compareAt { ${moneyFields} } maxPrice { ${moneyFields} } photos { alt image { url } } badges { label tone }`

/** A products block's products, by slug, in its order; one the store no longer sells is left out. At most 24 (SAPI 24). */
export const useProductCards = (slugs: readonly string[]): { status: 'loading' | 'ready' | 'error'; cards: ProductCard[] } => {
  const asked = slugs.slice(0, 24)
  const query = `query Cards(${asked.map((_, i) => `$s${i}: String!`).join(', ')}) { ${asked.map((_, i) => `p${i}: product(slug: $s${i}) { ${cardFields} }`).join(' ')} }`
  const loaded = useShopData(asked.length ? JSON.stringify(['cards', ...asked]) : null, (c) =>
    c.query(query, z.record(z.string(), z.unknown()), Object.fromEntries(asked.map((s, i) => [`s${i}`, s]))),
  )
  const found = asked.map((_, i) => loaded.data?.[`p${i}`]).filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
  // Each card on its own, so one the schema refuses is left out rather than failing the page.
  const cards = found.flatMap((p) => cardsSchema.safeParse([{ ...p, photo: Array.isArray(p['photos']) ? (p['photos'][0] ?? null) : null }]).data ?? [])
  return { status: asked.length === 0 || loaded.status === 'ready' ? 'ready' : loaded.status === 'error' ? 'error' : 'loading', cards }
}
