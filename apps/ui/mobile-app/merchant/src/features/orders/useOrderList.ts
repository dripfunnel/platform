import { useCallback, useEffect, useRef, useState } from 'react'
import { loadOrderCounts, loadOrders, type OrderCounts, type OrderQuery, type OrderRow } from '../../api/orders'
import type { ApiClient } from '../../graphql'

type Page = { rows: OrderRow[]; next: string | null }

export type OrderList = {
  query: OrderQuery
  setFilter: (filter: OrderQuery['filter']) => void
  /** What the field shows; the list asks for it a moment after typing stops. */
  search: string
  setSearch: (search: string) => void
  status: 'loading' | 'error' | 'ready'
  error: unknown
  rows: OrderRow[]
  counts: OrderCounts | null
  hasMore: boolean
  loadingMore: boolean
  showMore: () => void
  reload: () => void
}

const searchDelayMs = 350

// The Orders list's data: one page at a time, appended by "Show more"; the chips' counts come from their own query and are never
// worked out from the page (FIRST-RELEASE.md §19). Nothing is read until the seat is known to read orders.
export function useOrderList(client: ApiClient, enabled: boolean, initial: Pick<OrderQuery, 'filter'> = { filter: 'ALL' }): OrderList {
  const [filter, setFilter] = useState<OrderQuery['filter']>(initial.filter)
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState<Page | null>(null)
  const [counts, setCounts] = useState<OrderCounts | null>(null)
  const [status, setStatus] = useState<OrderList['status']>('loading')
  const [error, setError] = useState<unknown>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [round, setRound] = useState(0)
  const asked = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setApplied(search), search === applied ? 0 : searchDelayMs)
    return () => clearTimeout(timer)
  }, [search, applied])

  useEffect(() => {
    if (!enabled) return
    const mine = ++asked.current
    setStatus('loading')
    Promise.all([loadOrders(client, { filter, search: applied }), loadOrderCounts(client)]).then(
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
  }, [client, enabled, filter, applied, round])

  const showMore = useCallback(() => {
    if (!page?.next || loadingMore) return
    const mine = asked.current
    setLoadingMore(true)
    loadOrders(client, { filter, search: applied }, page.next)
      .then(
        (more) => {
          if (asked.current === mine) setPage({ rows: [...page.rows, ...more.rows], next: more.next })
        },
        (failure: unknown) => {
          if (asked.current === mine) {
            setError(failure)
            setStatus('error')
          }
        },
      )
      .finally(() => setLoadingMore(false))
  }, [client, filter, applied, page, loadingMore])

  return {
    query: { filter, search: applied },
    setFilter,
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
