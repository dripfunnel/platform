import { useCallback, useEffect, useRef, useState } from 'react'
import { loadProductCounts, loadProducts, type ProductCounts, type ProductQuery, type ProductRow } from '../../api/products'
import type { ApiClient } from '../../graphql'

type Page = { rows: ProductRow[]; next: string | null }

export type ProductList = {
  query: ProductQuery
  setFilter: (filter: ProductQuery['filter']) => void
  setSort: (sort: ProductQuery['sort']) => void
  /** What the field shows; the list asks for it a moment after typing stops, so a result follows each pause. */
  search: string
  setSearch: (search: string) => void
  status: 'loading' | 'error' | 'ready'
  error: unknown
  rows: ProductRow[]
  counts: ProductCounts | null
  hasMore: boolean
  loadingMore: boolean
  showMore: () => void
  reload: () => void
}

const searchDelayMs = 350

// The Products list's data: one page at a time, appended by "Show more"; counts for the chips come from their own query and
// are never worked out from the page (CATALOG-DESIGN.md B10: a supplier's are computed on its own products by the API).
export function useProductList(client: ApiClient, initial: Pick<ProductQuery, 'filter'> = { filter: 'all' }): ProductList {
  const [filter, setFilter] = useState<ProductQuery['filter']>(initial.filter)
  const [sort, setSort] = useState<ProductQuery['sort']>('updated')
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState<Page | null>(null)
  const [counts, setCounts] = useState<ProductCounts | null>(null)
  const [status, setStatus] = useState<ProductList['status']>('loading')
  const [error, setError] = useState<unknown>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [round, setRound] = useState(0)
  const asked = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setApplied(search), search === applied ? 0 : searchDelayMs)
    return () => clearTimeout(timer)
  }, [search, applied])

  useEffect(() => {
    const mine = ++asked.current
    setStatus('loading')
    const query = { filter, search: applied, sort }
    Promise.all([loadProducts(client, query), loadProductCounts(client)]).then(
      ([first, nextCounts]) => {
        if (asked.current !== mine) return
        setPage(first)
        setCounts(nextCounts)
        setStatus('ready')
      },
      (failure: unknown) => {
        if (asked.current !== mine) return
        setError(failure)
        setStatus('error')
      },
    )
  }, [client, filter, applied, sort, round])

  const showMore = useCallback(() => {
    if (!page?.next || loadingMore) return
    const mine = asked.current
    setLoadingMore(true)
    loadProducts(client, { filter, search: applied, sort }, page.next).then(
      (more) => {
        if (asked.current === mine) setPage({ rows: [...page.rows, ...more.rows], next: more.next })
      },
      (failure: unknown) => {
        if (asked.current === mine) {
          setError(failure)
          setStatus('error')
        }
      },
    ).finally(() => setLoadingMore(false))
  }, [client, filter, applied, sort, page, loadingMore])

  return {
    query: { filter, search: applied, sort },
    setFilter,
    setSort,
    search,
    setSearch,
    status,
    error,
    rows: page?.rows ?? [],
    counts,
    hasMore: page?.next != null,
    loadingMore,
    showMore,
    reload: useCallback(() => setRound((n) => n + 1), []),
  }
}
