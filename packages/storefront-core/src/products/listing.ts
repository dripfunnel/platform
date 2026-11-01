'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { ShopApiError, type ShopClient } from '../platform/api/client'
import { navigate, useLocation } from '../platform/browser/router'
import { useShopData, type Loaded } from '../platform/render/data'
import { useStorefront } from '../platform/store/context'
import { cardsSchema, summaryFields, type ProductCard } from './summary'

// A collection's or a search's products (ARCHITECTURE §2.1 `collections`, `search`; DESIGN §6): which products match
// and the filter logic are the engine's (OR within a filter, AND across), and filters, sort and pages live in the address.

/** Products per request: one page, and each fetchMore. */
export const pageSize = 24

export const sortKeys = ['featured', 'newest', 'price-low', 'price-high', 'name'] as const
export type SortKey = (typeof sortKeys)[number]

const apiSorts: Record<Exclude<SortKey, 'featured'>, string> = { newest: 'NEWEST', 'price-low': 'PRICE_LOW', 'price-high': 'PRICE_HIGH', name: 'NAME' }

export type FacetValue = { id: string; name: string; count: number; selected: boolean }
export type Facet = { id: string; name: string; values: FacetValue[] }

const text = z.string().nullable().optional()
const pageInfoSchema = z.object({ endCursor: text, hasNextPage: z.boolean().nullable().optional(), hasPreviousPage: z.boolean().nullable().optional(), startCursor: text }).nullable().optional()

const listingSchema = z.object({
  products: z
    .object({
      nodes: cardsSchema,
      pageInfo: pageInfoSchema,
      facets: z
        .array(z.object({ id: text, name: text, values: z.array(z.object({ id: text, name: text, count: z.number().int().nullable().optional() })).nullable().optional() }))
        .nullable()
        .optional(),
    })
    .nullable(),
})

export const listingQuery = `query Listing($collection: String, $search: String, $filters: [ID!], $sort: ShopProductSort, $first: Int, $after: String, $before: String) { products(collection: $collection, search: $search, filters: $filters, sort: $sort, first: $first, after: $after, before: $before) { nodes { ${summaryFields} } pageInfo { endCursor hasNextPage hasPreviousPage startCursor } facets { id name values { id name count } } } }`

type Page = { items: ProductCard[]; facets: { id: string; name: string; values: { id: string; name: string; count: number }[] }[]; end: string | null; start: string | null; hasMore: boolean; hasPrevious: boolean }

const loadPage = async (client: ShopClient, variables: Record<string, unknown>): Promise<Page> => {
  const { products } = await client.query(listingQuery, listingSchema, variables)
  if (!products) throw new ShopApiError('EMPTY_RESPONSE', 'The Shop API returned no products.')
  return {
    items: products.nodes,
    facets: (products.facets ?? []).flatMap((f) =>
      f.id && f.name ? [{ id: f.id, name: f.name, values: (f.values ?? []).flatMap((v) => (v.id && v.name ? [{ id: v.id, name: v.name, count: v.count ?? 0 }] : [])) }] : [],
    ),
    end: products.pageInfo?.endCursor ?? null,
    start: products.pageInfo?.startCursor ?? null,
    hasMore: products.pageInfo?.hasNextPage ?? false,
    hasPrevious: products.pageInfo?.hasPreviousPage ?? false,
  }
}

const cursor = (value: string | null) => (value && value.length <= 512 ? value : null)
const valueId = /^[A-Za-z0-9_-]{1,64}$/
const maxFilters = 50

/** What the address asks for: chosen filter values, the sort and the page's cursor. */
export const listingState = (query: URLSearchParams) => {
  const sort = query.get('sort')
  return {
    filters: [...new Set(query.getAll('filter').filter((v) => valueId.test(v)))].slice(0, maxFilters).sort(),
    sort: sortKeys.find((k) => k === sort) ?? 'featured',
    after: cursor(query.get('after')),
    before: cursor(query.get('after') ? null : query.get('before')),
  }
}

export type ListingInput = { collection?: string | null; search?: string | null }

export type Listing = {
  status: Loaded<unknown>['status']
  code: string | null
  retry: () => void
  items: ProductCard[]
  facets: Facet[]
  /** The chosen filter values with their names, for chips. */
  selected: { id: string; name: string }[]
  toggle: (valueId: string) => void
  clear: () => void
  sort: SortKey
  sorts: readonly SortKey[]
  setSort: (sort: SortKey) => void
  /** Appends the next page in place (infinite scroll or "Load more"). */
  fetchMore: () => void
  hasMore: boolean
  loadingMore: boolean
  moreFailed: boolean
  /** The next and previous pages as addresses, for themes that page instead. */
  nextHref: string | null
  previousHref: string | null
  /** This listing's address without its filters and sort, for the page's canonical link. */
  canonical: string
}

const withQuery = (path: string, query: URLSearchParams) => {
  const search = query.toString()
  return search ? `${path}?${search}` : path
}

export const useListing = ({ collection = null, search = null }: ListingInput, ready = true): Listing => {
  const { client } = useStorefront()
  const { path, query } = useLocation()
  const state = useMemo(() => listingState(query), [query])
  const variables = useMemo(
    () => ({
      collection,
      search,
      filters: state.filters.length ? state.filters : null,
      sort: state.sort === 'featured' ? (collection ? 'COLLECTION' : null) : apiSorts[state.sort],
      first: pageSize,
      after: state.after,
      before: state.before,
    }),
    [collection, search, state],
  )
  const key = ready ? JSON.stringify(['listing', variables]) : null
  // Each answer names its collection or search, since useShopData holds the last answer for a render after the key moves.
  const scope = JSON.stringify([collection, search])
  const first = useShopData(key, async (c) => ({ ...(await loadPage(c, variables)), scope }))

  const [more, setMore] = useState<{ key: string | null; items: ProductCard[]; end: string | null; hasMore: boolean; loading: boolean; failed: boolean }>({ key: null, items: [], end: null, hasMore: false, loading: false, failed: false })
  const asked = useRef(0)
  useEffect(() => {
    asked.current += 1
    setMore({ key, items: [], end: null, hasMore: false, loading: false, failed: false })
  }, [key])

  const extra = more.key === key ? more : null
  const end = extra?.end ?? first.data?.end ?? null
  // A failed fetchMore keeps the cursor it started from, so pressing again retries the same page.
  const hasMore = extra?.end ? extra.hasMore : (first.data?.hasMore ?? false)

  const fetchMore = () => {
    if (!first.data || !hasMore || extra?.loading || !end) return
    const mine = (asked.current += 1)
    setMore((m) => ({ ...m, key, loading: true, failed: false }))
    loadPage(client, { ...variables, after: end, before: null }).then(
      (page) => {
        if (mine === asked.current) setMore((m) => ({ key, items: [...m.items, ...page.items], end: page.end, hasMore: page.hasMore, loading: false, failed: false }))
      },
      () => {
        if (mine === asked.current) setMore((m) => ({ ...m, loading: false, failed: true }))
      },
    )
  }

  const go = (change: (q: URLSearchParams) => void) => {
    const next = new URLSearchParams(query)
    next.delete('after')
    next.delete('before')
    change(next)
    navigate(withQuery(path, next))
  }
  // While another filter or sort loads, the last facets of this collection or search stay, so the filters don't vanish.
  const [last, setLast] = useState<{ scope: string; facets: Page['facets'] } | null>(null)
  useEffect(() => {
    if (first.data) setLast(first.data)
  }, [first.data])
  const current = first.data ?? last
  const chosen = new Set(state.filters)
  const facets = (current?.scope === scope ? current.facets : []).map((f) => ({ ...f, values: f.values.map((v) => ({ ...v, selected: chosen.has(v.id) })) }))
  const names = new Map(facets.flatMap((f) => f.values.map((v) => [v.id, v.name] as const)))
  const page = (name: 'after' | 'before', value: string | null) => {
    const next = new URLSearchParams(query)
    next.delete('after')
    next.delete('before')
    if (value) next.set(name, value)
    return withQuery(path, next)
  }
  const canonicalQuery = new URLSearchParams()
  if (state.after) canonicalQuery.set('after', state.after)
  else if (state.before) canonicalQuery.set('before', state.before)

  return {
    status: first.status,
    code: first.code,
    retry: first.retry,
    items: [...(first.data?.items ?? []), ...(extra?.items ?? [])],
    facets,
    selected: state.filters.flatMap((id) => {
      const name = names.get(id)
      return name ? [{ id, name }] : []
    }),
    toggle: (id) =>
      go((q) => {
        const values = q.getAll('filter')
        q.delete('filter')
        for (const v of values.includes(id) ? values.filter((x) => x !== id) : [...values, id]) q.append('filter', v)
      }),
    clear: () => go((q) => q.delete('filter')),
    sort: state.sort,
    sorts: sortKeys,
    setSort: (sort) => go((q) => (sort === 'featured' ? q.delete('sort') : q.set('sort', sort))),
    fetchMore,
    hasMore: Boolean(first.data) && hasMore,
    loadingMore: extra?.loading ?? false,
    moreFailed: extra?.failed ?? false,
    nextHref: first.data?.hasMore && first.data.end ? page('after', first.data.end) : null,
    previousHref: first.data?.hasPrevious && first.data.start ? page('before', first.data.start) : null,
    canonical: withQuery(path, canonicalQuery),
  }
}

/** A few products outside a listing page, such as a home page's newest: no filters, and nothing in the address. */
export const useProducts = ({ sort = 'newest', first = 8 }: { sort?: Exclude<SortKey, 'featured'>; first?: number } = {}) => {
  const count = Math.min(Math.max(Math.floor(first), 1), pageSize)
  const list = useShopData(JSON.stringify(['products', sort, count]), (client) => loadPage(client, { sort: apiSorts[sort], first: count }))
  return { status: list.status, retry: list.retry, products: list.data?.items ?? [] }
}
