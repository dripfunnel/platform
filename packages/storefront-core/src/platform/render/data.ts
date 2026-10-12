'use client'

import { useEffect, useRef, useState } from 'react'
import { ShopApiError, type ShopClient } from '../api/client'
import { useStorefront } from '../store/context'

// The render-mode adapter's data loading (ARCHITECTURE §2.1 `platform/render`, §4): a page renders its loading state in
// a static build and in the browser's first render alike, so hydration matches, then loads from the Shop API.

export type Loaded<T> =
  | { status: 'idle'; data: null; code: null }
  | { status: 'loading'; data: null; code: null }
  | { status: 'ready'; data: T; code: null }
  | { status: 'error'; data: null; code: string }

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
 * earlier one never replaces it.
 */
export const useShopData = <T>(key: string | null, load: (client: ShopClient) => Promise<T>): Loaded<T> & { retry: () => void } => {
  const { client } = useStorefront()
  const [state, setState] = useState<Loaded<T>>(key === null ? { status: 'idle', data: null, code: null } : { status: 'loading', data: null, code: null })
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    const asked = (latest.current += 1)
    if (key === null) return setState({ status: 'idle', data: null, code: null })
    setState({ status: 'loading', data: null, code: null })
    const answer = attempt === 0 ? shared(client, key, () => loader.current(client)) : loader.current(client)
    answer.then(
      (data) => {
        if (asked === latest.current) setState({ status: 'ready', data, code: null })
      },
      (error: unknown) => {
        if (asked === latest.current) setState({ status: 'error', data: null, code: error instanceof ShopApiError ? error.code : 'UNKNOWN' })
      },
    )
  }, [client, key, attempt])
  return { ...state, retry: () => setAttempt((n) => n + 1) }
}
