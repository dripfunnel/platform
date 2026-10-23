import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import type { StateKind } from '../states/StateView'

export type Load<T> = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T }

/** Runs `load` when `deps` change or `reload` is called; a late answer to an earlier call is dropped. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): { state: Load<T>; reload: () => void; set: (data: T) => void } {
  const [state, setState] = useState<Load<T>>({ status: 'loading' })
  const [round, setRound] = useState(0)
  const latest = useRef(load)
  latest.current = load

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    latest.current().then(
      (data) => current && setState({ status: 'ready', data }),
      (error: unknown) => current && setState({ status: 'error', error }),
    )
    return () => {
      current = false
    }
  }, [round, ...deps])

  return { state, reload: useCallback(() => setRound((n) => n + 1), []), set: useCallback((data: T) => setState({ status: 'ready', data }), []) }
}

/** The designed state a failed load draws (DESIGN.md §4): a refusal of access, a record that isn't here, or "We couldn't load". */
export const stateOfError = (error: unknown): StateKind => (isApiError(error, 'FORBIDDEN') ? 'denied' : isApiError(error, 'NOT_FOUND') ? 'notFound' : 'loadErr')
