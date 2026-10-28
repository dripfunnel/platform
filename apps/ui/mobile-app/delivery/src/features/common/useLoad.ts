import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'

export type Loaded<T> = { status: 'loading' } | { status: 'error'; code: string } | { status: 'offline' } | { status: 'ready'; data: T }

/** Runs `load` on mount and on `reload`; a reload keeps what is on screen while it asks again, and a failed one leaves it as it was. */
export function useLoad<T>(load: () => Promise<T>): { state: Loaded<T>; reload: () => void } {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  const [round, setRound] = useState(0)
  const latest = useRef(load)
  latest.current = load

  useEffect(() => {
    let live = true
    latest.current().then(
      (data) => live && setState({ status: 'ready', data }),
      (error: unknown) => {
        if (!live) return
        setState((now) => (now.status === 'ready' ? now : isApiError(error, 'NO_RESPONSE') ? { status: 'offline' } : { status: 'error', code: isApiError(error) ? error.code : 'UNKNOWN' }))
      },
    )
    return () => {
      live = false
    }
  }, [round])

  return { state, reload: useCallback(() => setRound((n) => n + 1), []) }
}
