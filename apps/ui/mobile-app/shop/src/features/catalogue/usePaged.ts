import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { run, type Operation, type Page } from '../../api/catalogue'
import { useShop } from '../../api/ShopContext'
import { useOperation, type Loaded } from './useOperation'

export type MoreState = 'idle' | 'loading' | 'error' | 'offline'

/** A list read a page at a time: the first page as `useOperation` reads it, and "Show more" appending the next ones. */
export function usePaged<P extends Page<unknown>>(first: Operation<P> | null, more: (after: string) => Operation<P>): { state: Loaded<P>; retry: () => void; more: MoreState; showMore: () => void } {
  const { client } = useShop()
  const { state, retry } = useOperation(first)
  const [extra, setExtra] = useState<{ items: P['items']; next: string | null } | null>(null)
  const [moreState, setMoreState] = useState<MoreState>('idle')
  const generation = useRef(0)
  const latest = useRef({ more, state, extra, moreState })
  latest.current = { more, state, extra, moreState }

  // A new first page (other filters, a retry) starts the list again.
  useEffect(() => {
    generation.current += 1
    setExtra(null)
    setMoreState('idle')
  }, [state])

  const showMore = useCallback(() => {
    const { more: nextOperation, state: current, extra: kept, moreState: now } = latest.current
    if (current.status !== 'ready' || now === 'loading') return
    const after = kept ? kept.next : current.data.next
    if (after === null) return
    const mine = generation.current
    setMoreState('loading')
    run(client, nextOperation(after)).then(
      (page) => {
        if (mine !== generation.current) return
        setExtra((previous) => ({ items: [...(previous?.items ?? []), ...page.items], next: page.next }))
        setMoreState('idle')
      },
      (error: unknown) => {
        if (mine === generation.current) setMoreState(isApiError(error, 'NO_RESPONSE') ? 'offline' : 'error')
      },
    )
  }, [client])

  const merged: Loaded<P> = state.status === 'ready' ? { ...state, data: { ...state.data, items: [...state.data.items, ...(extra?.items ?? [])] as P['items'], next: extra ? extra.next : state.data.next } } : state
  return { state: merged, retry, more: moreState, showMore }
}
