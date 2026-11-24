'use client'

import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ShopApiError, type ShopClient } from '../api/client'
import { useStorefront } from '../store/context'
import { RefreshBar } from './refreshBar'

// The render-mode adapter's data loading (ARCHITECTURE §2.1 `platform/render`, §4): a page renders its loading state in
// a static build and in the browser's first render alike, so hydration matches, then loads from the Shop API.

export type Loaded<T> =
  | { status: 'idle'; data: null; code: null }
  | { status: 'loading'; data: null; code: null }
  | { status: 'ready'; data: T; code: null }
  | { status: 'error'; data: null; code: string }

/**
 * A live page's answers, by question, from the catalogue snapshot (ARCHITECTURE §4.2): its build renders them and its
 * hydration starts from the same ones. `ask` hears, while the build renders, each question it has no answer for yet.
 */
export type PrefilledData = { answers: { has: (key: string) => boolean; get: (key: string) => unknown }; ask?: (key: string, load: (client: ShopClient) => Promise<unknown>) => void }

const PrefilledContext = createContext<PrefilledData | null>(null)

const RefreshContext = createContext<((by: 1 | -1) => void) | null>(null)

/**
 * Only the live build and its hydration give answers; the preview and the studio ask the Shop API as they always did.
 * While any pre-filled answer is being asked again it draws a loading bar at the top of the page (#1578).
 */
export const PrefilledProvider = ({ value, children }: { value: PrefilledData; children: ReactNode }) => {
  const [refreshing, setRefreshing] = useState(0)
  const track = useCallback((by: 1 | -1) => setRefreshing((n) => n + by), [])
  return createElement(PrefilledContext.Provider, { value }, createElement(RefreshContext.Provider, { value: track }, createElement(RefreshBar, { busy: refreshing > 0 }), children))
}

const pending = new WeakMap<ShopClient, Map<string, Promise<unknown>>>()

/** One request per question per page, however many components ask it (§4.3); a failure is asked again next time. */
export const shared = <T>(client: ShopClient, key: string, load: () => Promise<T>): Promise<T> => {
  let byKey = pending.get(client)
  if (!byKey) pending.set(client, (byKey = new Map()))
  const found = byKey.get(key)
  if (found) return found as Promise<T>
  const started = load()
  byKey.set(key, started)
  started.catch(() => byKey.delete(key))
  return started
}

/**
 * Loads what `key` names (null asks nothing), keeping only the answer to the latest question: a slow answer to an
 * earlier one never replaces it. A pre-filled answer shows at once and stays while the Shop API is asked again, under the provider's loading bar (#1578); with
 * `keepBuilt` it stays for good and the Shop API is not asked, so the page shows one answer from its first paint (#1481).
 */
export const useShopData = <T>(key: string | null, load: (client: ShopClient) => Promise<T>, { keepBuilt = false }: { keepBuilt?: boolean } = {}): Loaded<T> & { retry: () => void } => {
  const { client } = useStorefront()
  const prefilled = useContext(PrefilledContext)
  const track = useContext(RefreshContext)
  const known = key !== null && prefilled !== null && prefilled.answers.has(key)
  if (key !== null && !known) prefilled?.ask?.(key, load)
  const [state, setState] = useState<Loaded<T>>(
    key === null ? { status: 'idle', data: null, code: null } : known ? { status: 'ready', data: prefilled.answers.get(key) as T, code: null } : { status: 'loading', data: null, code: null },
  )
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    const asked = (latest.current += 1)
    if (key === null) return setState({ status: 'idle', data: null, code: null })
    const kept = prefilled?.answers.has(key) === true
    if (kept) {
      const answer = prefilled.answers.get(key) as T
      setState((s) => (s.status === 'ready' && s.data === answer ? s : { status: 'ready', data: answer, code: null }))
    } else setState({ status: 'loading', data: null, code: null })
    if (kept && keepBuilt) return
    let tracked = kept
    const done = () => {
      if (tracked) track?.(-1)
      tracked = false
    }
    if (tracked) track?.(1)
    const answer = attempt === 0 ? shared(client, key, () => loader.current(client)) : loader.current(client)
    answer.then(
      (data) => {
        done()
        if (asked === latest.current) setState({ status: 'ready', data, code: null })
      },
      (error: unknown) => {
        done()
        // A built page keeps showing what it was built with when the Shop API can't be reached.
        if (asked === latest.current && !kept) setState({ status: 'error', data: null, code: error instanceof ShopApiError ? error.code : 'UNKNOWN' })
      },
    )
    return done
  }, [client, key, attempt, prefilled, track])
  return { ...state, retry: () => setAttempt((n) => n + 1) }
}
