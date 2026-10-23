import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadActivity, type ActivityEntry, type ActivityFilter, type ActivityWhat } from '../../api/activity'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'

export type Person = { kind: string; id: string }

export type ActivityLog = {
  person: Person | null
  setPerson: (person: Person | null) => void
  what: ActivityWhat | null
  setWhat: (what: ActivityWhat | null) => void
  /** What the field shows; the log asks for it a moment after typing stops. */
  search: string
  setSearch: (search: string) => void
  /** The filter the rows on screen answer. */
  filter: ActivityFilter
  status: 'loading' | 'error' | 'ready'
  error: unknown
  entries: ActivityEntry[]
  hasMore: boolean
  loadingMore: boolean
  moreFailed: boolean
  showOlder: () => void
  reload: () => void
}

const searchDelayMs = 350

// The log's data: a page of 50 at a time, appended by "Show older", following the person, the kind of change and the words typed
// (FIRST-RELEASE (store) §15). A late answer to an earlier filter is dropped.
export function useActivityLog(client: ApiClient): ActivityLog {
  const [person, setPerson] = useState<Person | null>(null)
  const [what, setWhat] = useState<ActivityWhat | null>(null)
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState<{ entries: ActivityEntry[]; next: string | null } | null>(null)
  const [status, setStatus] = useState<ActivityLog['status']>('loading')
  const [error, setError] = useState<unknown>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const [round, setRound] = useState(0)
  const asked = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setApplied(search.trim()), search.trim() === applied ? 0 : searchDelayMs)
    return () => clearTimeout(timer)
  }, [search, applied])

  const filter = useMemo<ActivityFilter>(() => ({ person, what, search: applied }), [person, what, applied])

  useEffect(() => {
    const mine = ++asked.current
    setStatus('loading')
    setMoreFailed(false)
    loadActivity(client, filter, null).then(
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
  }, [client, filter, round])

  const showOlder = useCallback(() => {
    if (!page?.next || loadingMore) return
    const mine = asked.current
    setLoadingMore(true)
    setMoreFailed(false)
    loadActivity(client, filter, page.next)
      .then(
        (more) => {
          if (asked.current === mine) setPage({ entries: [...page.entries, ...more.entries], next: more.next })
        },
        () => {
          if (asked.current === mine) setMoreFailed(true)
        },
      )
      .finally(() => setLoadingMore(false))
  }, [client, filter, page, loadingMore])

  return {
    person,
    setPerson,
    what,
    setWhat,
    search,
    setSearch,
    filter,
    status,
    error,
    entries: page?.entries ?? [],
    hasMore: page?.next != null,
    loadingMore,
    moreFailed,
    showOlder,
    reload: useCallback(() => setRound((n) => n + 1), []),
  }
}
