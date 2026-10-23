import { useCallback, useEffect, useRef, useState } from 'react'
import { loadCustomerCount, loadCustomerGroups, loadCustomers, type CustomerGroup, type CustomerSummary } from '../../api/customers'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'

type Page = { rows: CustomerSummary[]; next: string | null }
type Meta = { count: number; groups: CustomerGroup[] }

export type CustomerList = {
  /** What the field shows; the list asks for it a moment after typing stops. */
  search: string
  setSearch: (search: string) => void
  groupId: string | null
  setGroupId: (groupId: string | null) => void
  /** What the list is asked for now: the search once typing paused, and the group. */
  query: { groupId: string | null; search: string }
  status: 'loading' | 'error' | 'ready'
  error: unknown
  rows: CustomerSummary[]
  /** Everyone the store has, and its groups: read apart from the page, never counted from it. */
  count: number | null
  groups: CustomerGroup[]
  hasMore: boolean
  loadingMore: boolean
  showMore: () => void
  reload: () => void
}

const searchDelayMs = 350

// The People list's data: a page at a time, appended by "Show more", following the search and the group; the count and the groups
// are read once and again after a change (FIRST-RELEASE (store) §7).
export function useCustomerList(client: ApiClient): CustomerList {
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [page, setPage] = useState<Page | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [listStatus, setListStatus] = useState<CustomerList['status']>('loading')
  const [metaStatus, setMetaStatus] = useState<CustomerList['status']>('loading')
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
    setListStatus('loading')
    loadCustomers(client, { groupId, search: applied }).then(
      (first) => {
        if (asked.current !== mine) return
        setPage(first)
        setListStatus('ready')
      },
      (failure: unknown) => {
        if (asked.current !== mine) return
        setError(failure)
        setListStatus('error')
      },
    )
  }, [client, groupId, applied, round])

  useEffect(() => {
    let current = true
    setMetaStatus('loading')
    Promise.all([loadCustomerCount(client), loadCustomerGroups(client)]).then(
      ([count, groups]) => {
        if (!current) return
        setMeta({ count, groups })
        setMetaStatus('ready')
      },
      (failure: unknown) => {
        if (!current) return
        setError(failure)
        setMetaStatus('error')
      },
    )
    return () => {
      current = false
    }
  }, [client, round])

  const showMore = useCallback(() => {
    if (!page?.next || loadingMore) return
    const mine = asked.current
    setLoadingMore(true)
    loadCustomers(client, { groupId, search: applied }, page.next)
      .then(
        (more) => {
          if (asked.current === mine) setPage({ rows: [...page.rows, ...more.rows], next: more.next })
        },
        (failure: unknown) => {
          if (asked.current === mine) {
            setError(failure)
            setListStatus('error')
          }
        },
      )
      .finally(() => setLoadingMore(false))
  }, [client, groupId, applied, page, loadingMore])

  const status = listStatus === 'error' || metaStatus === 'error' ? 'error' : listStatus === 'loading' || metaStatus === 'loading' ? 'loading' : 'ready'
  return {
    search,
    setSearch,
    groupId,
    setGroupId,
    query: { groupId, search: applied },
    status,
    error,
    rows: page?.rows ?? [],
    count: meta?.count ?? null,
    groups: meta?.groups ?? [],
    hasMore: page?.next != null,
    loadingMore,
    showMore,
    reload: useCallback(() => setRound((n) => n + 1), []),
  }
}
