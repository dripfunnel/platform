import { useCallback, useEffect, useRef, useState } from 'react'
import { loadCartCounts, loadCarts, loadCartSummary, type AbandonedCart, type CartCounts, type CartSummary, type CartTab } from '../../api/carts'
import type { ApiClient } from '../../graphql'

type Page = { rows: AbandonedCart[]; next: string | null }

export type CartList = {
  tab: CartTab
  setTab: (tab: CartTab) => void
  /** What the field shows; the list asks for it a moment after typing stops. */
  search: string
  setSearch: (search: string) => void
  status: 'loading' | 'error' | 'ready'
  error: unknown
  rows: AbandonedCart[]
  /** The tabs' counts and the 14-day tiles: hints beside the list, null when unread or when the read failed. */
  counts: CartCounts | null
  summary: CartSummary | null
  hasMore: boolean
  loadingMore: boolean
  showMore: () => void
  reload: () => void
}

const searchDelayMs = 350

// The list's data: a page at a time, appended by "Show more", following the tab and the search; the counts and the tiles are read apart
// from it and again after a change (FIRST-RELEASE (store) §9).
export function useCartList(client: ApiClient): CartList {
  const [tab, setTab] = useState<CartTab>('open')
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState<Page | null>(null)
  const [counts, setCounts] = useState<CartCounts | null>(null)
  const [summary, setSummary] = useState<CartSummary | null>(null)
  const [status, setStatus] = useState<CartList['status']>('loading')
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
    loadCarts(client, tab, applied).then(
      (first) => {
        if (asked.current !== mine) return
        setPage(first)
        setStatus('ready')
      },
      (failure: unknown) => {
        if (asked.current !== mine) return
        setError(failure)
        setStatus('error')
      },
    )
  }, [client, tab, applied, round])

  useEffect(() => {
    let current = true
    loadCartCounts(client).then(
      (next) => current && setCounts(next),
      () => current && setCounts(null),
    )
    loadCartSummary(client).then(
      (next) => current && setSummary(next),
      () => current && setSummary(null),
    )
    return () => {
      current = false
    }
  }, [client, round])

  const showMore = useCallback(() => {
    if (!page?.next || loadingMore) return
    const mine = asked.current
    setLoadingMore(true)
    loadCarts(client, tab, applied, page.next)
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
  }, [client, tab, applied, page, loadingMore])

  return {
    tab,
    setTab,
    search,
    setSearch,
    status,
    error,
    rows: page?.rows ?? [],
    counts,
    summary,
    hasMore: page?.next != null,
    loadingMore,
    showMore,
    reload: useCallback(() => setRound((n) => n + 1), []),
  }
}
