import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import type { Operation } from '../../api/operation'
import { useShop } from '../../api/ShopContext'
import { readCached, saveCached } from './cache'

export type Loaded<T> =
  | { status: 'loading' }
  | { status: 'error'; code: string }
  | { status: 'offline' }
  /** `stale`: the phone had no answer, so this is the last one it kept. */
  | { status: 'ready'; data: T; stale: boolean }

const codeOf = (error: unknown): string => (isApiError(error) ? error.code : 'UNKNOWN')

/** Runs an operation when it changes (or on `retry`); with no answer it falls back to the last one kept, never to a blank screen. */
export function useOperation<T>(operation: Operation<T> | null): { state: Loaded<T>; retry: () => void } {
  const { host, client, endSession } = useShop()
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  const [round, setRound] = useState(0)
  const latest = useRef(operation)
  latest.current = operation
  const identity = operation ? `${operation.slot}|${operation.signature}|${operation.query}` : null

  useEffect(() => {
    const current = latest.current
    setState({ status: 'loading' })
    if (!current) return
    let live = true
    const load = async () => {
      try {
        const raw = await client.request<unknown>(current.query, current.variables)
        const data = current.parse(raw)
        if (live) setState({ status: 'ready', data, stale: false })
        if (current.slot) await saveCached(host, current.slot, current.signature, raw)
      } catch (error) {
        // A session the API says has ended is let go, so the shopper can sign in again.
        if (isApiError(error, 'SIGNED_OUT')) void endSession()
        const offline = isApiError(error, 'NO_RESPONSE')
        if (offline && current.slot) {
          const kept = await readCached(host, current.slot, current.signature)
          try {
            if (kept !== undefined) {
              const data = current.parse(kept)
              if (live) setState({ status: 'ready', data, stale: true })
              return
            }
          } catch {
            // What was kept no longer matches the API's shape: it is as if nothing was kept.
          }
        }
        if (live) setState(offline ? { status: 'offline' } : { status: 'error', code: codeOf(error) })
      }
    }
    void load()
    return () => {
      live = false
    }
  }, [identity, round, client, host, endSession])

  return { state, retry: useCallback(() => setRound((n) => n + 1), []) }
}
