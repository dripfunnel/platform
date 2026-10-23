import { useCallback, useEffect, useRef, useState } from 'react'
import { loadOfferCounts, loadOfferNames, loadOfferPlace, loadOffers, type Offer, type OfferCounts, type OfferKind, type OfferTab } from '../../api/offers'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { noNames, type OfferNames } from './offerView'

type Page = { rows: Offer[]; next: string | null }
type Place = { timeZone: string; country: string | null }

export type OfferList = {
  tab: OfferTab
  setTab: (tab: OfferTab) => void
  kind: OfferKind | null
  setKind: (kind: OfferKind | null) => void
  trigger: Offer['trigger'] | null
  setTrigger: (trigger: Offer['trigger'] | null) => void
  /** What the field shows; the list asks for it a moment after typing stops. */
  search: string
  setSearch: (search: string) => void
  filtered: boolean
  clearFilters: () => void
  status: 'loading' | 'error' | 'ready'
  error: unknown
  rows: Offer[]
  /** Each tab's count, read apart from the page and never worked out from it; null while unread or when the read failed. */
  counts: OfferCounts | null
  countsFailed: boolean
  /** Every time on the list is the store's, so rows wait for its zone. */
  place: Place | null
  /** Names for the ids a row words (groups, collections, filter values); rows count instead when they can't be read. */
  names: OfferNames
  hasMore: boolean
  loadingMore: boolean
  showMore: () => void
  reload: () => void
}

const searchDelayMs = 350

// The Offers list's data (FIRST-RELEASE (store) §8): a page of the tab at a time, appended by "Show more", following the search and the
// two filters; the counts, the store's place and the names are read apart and again after a change.
export function useOfferList(client: ApiClient): OfferList {
  const [tab, setTabState] = useState<OfferTab>('live')
  const [kind, setKind] = useState<OfferKind | null>(null)
  const [trigger, setTrigger] = useState<Offer['trigger'] | null>(null)
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState<Page | null>(null)
  const [counts, setCounts] = useState<OfferCounts | null>(null)
  const [countsFailed, setCountsFailed] = useState(false)
  const [place, setPlace] = useState<Place | null>(null)
  const [names, setNames] = useState<OfferNames>(noNames)
  const [listStatus, setListStatus] = useState<OfferList['status']>('loading')
  const [placeStatus, setPlaceStatus] = useState<OfferList['status']>('loading')
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
    loadOffers(client, { tab, kind, trigger, search: applied }).then(
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
  }, [client, tab, kind, trigger, applied, round])

  useEffect(() => {
    let current = true
    setCountsFailed(false)
    loadOfferCounts(client).then(
      (read) => current && setCounts(read),
      () => current && setCountsFailed(true),
    )
    return () => {
      current = false
    }
  }, [client, round])

  useEffect(() => {
    let current = true
    setPlaceStatus('loading')
    loadOfferPlace(client).then(
      (read) => {
        if (!current) return
        setPlace(read)
        setPlaceStatus('ready')
      },
      (failure: unknown) => {
        if (!current) return
        setError(failure)
        setPlaceStatus('error')
      },
    )
    // Names only word the rows; when they fail the rows count instead.
    loadOfferNames(client).then(
      (read) => current && setNames(read),
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [client, round])

  const showMore = useCallback(() => {
    if (!page?.next || loadingMore) return
    const mine = asked.current
    setLoadingMore(true)
    loadOffers(client, { tab, kind, trigger, search: applied }, page.next)
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
  }, [client, tab, kind, trigger, applied, page, loadingMore])

  const status = listStatus === 'error' || placeStatus === 'error' ? 'error' : listStatus === 'loading' || placeStatus === 'loading' ? 'loading' : 'ready'
  return {
    tab,
    setTab: setTabState,
    kind,
    setKind,
    trigger,
    setTrigger,
    search,
    setSearch,
    filtered: search.trim() !== '' || kind !== null || trigger !== null,
    clearFilters: () => {
      setSearch('')
      setKind(null)
      setTrigger(null)
    },
    status,
    error,
    rows: page?.rows ?? [],
    counts,
    countsFailed,
    place,
    names,
    hasMore: page?.next != null,
    loadingMore,
    showMore,
    reload: useCallback(() => setRound((n) => n + 1), []),
  }
}
