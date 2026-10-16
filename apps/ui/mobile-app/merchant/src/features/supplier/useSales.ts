import { useCallback, useEffect, useRef, useState } from 'react'
import { loadMySales, loadSupplierName, type Sale } from '../../api/supplier'
import type { ApiClient } from '../../graphql'

type Page = { rows: Sale[]; next: string | null }

export type SalesList = {
  status: 'loading' | 'error' | 'ready'
  error: unknown
  rows: Sale[]
  supplier: string | null
  hasMore: boolean
  loadingMore: boolean
  showMore: () => void
  reload: () => void
}

// Your sales' data: the API's pages of the supplier's own sold lines, appended by "Show more". Nothing is read until the seat is known to hold `sales.read`.
export function useSales(client: ApiClient, enabled: boolean): SalesList {
  const [page, setPage] = useState<Page | null>(null)
  const [supplier, setSupplier] = useState<string | null>(null)
  const [status, setStatus] = useState<SalesList['status']>('loading')
  const [error, setError] = useState<unknown>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [round, setRound] = useState(0)
  const asked = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const mine = ++asked.current
    setStatus('loading')
    Promise.all([loadMySales(client), loadSupplierName(client).catch(() => null)]).then(
      ([first, name]) => {
        if (asked.current !== mine) return
        setPage(first)
        setSupplier(name)
        setStatus('ready')
      },
      (failure: unknown) => {
        if (asked.current !== mine) return
        setError(failure)
        setStatus('error')
      },
    )
  }, [client, enabled, round])

  const showMore = useCallback(() => {
    if (!page?.next || loadingMore) return
    const mine = asked.current
    setLoadingMore(true)
    loadMySales(client, page.next)
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
  }, [client, page, loadingMore])

  return { status, error, rows: page?.rows ?? [], supplier, hasMore: page?.next != null, loadingMore, showMore, reload: useCallback(() => setRound((n) => n + 1), []) }
}
