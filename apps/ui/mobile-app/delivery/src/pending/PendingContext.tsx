import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useOnline as useConnection } from '@dripfunnel/mobile-shared/connection'
import { useSession } from '../session/SessionContext'
import { flushSteps } from './send'
import { keepSaved, loadSaved, nothingSaved, type PendingNotice, type PendingStep, type Saved } from './store'

/** First retry after 5 s, doubling to 5 minutes, while steps wait and the phone says it has signal. */
export const retryAfterMs = (tries: number): number => Math.min(5_000 * 2 ** tries, 300_000)

export type Pending = {
  steps: readonly PendingStep[]
  notices: readonly PendingNotice[]
  /** Counts the times a step was taken by the API, so a screen can load again. */
  sentCount: number
  /** Deliveries that must not show as the rider's current one: a step waits to be sent, or the store will confirm it. */
  hidden: ReadonlySet<string>
  /** Keeps the step on the phone and tries to send it now. */
  keep: (step: PendingStep) => void
  /** Keeps an answer for the rider to read on Home, as when the API answers a step at once. */
  notify: (notice: PendingNotice) => void
  dismissNotice: (deliveryId: string) => void
}

const none: Pending = { steps: [], notices: [], sentCount: 0, hidden: new Set(), keep: () => undefined, notify: () => undefined, dismissNotice: () => undefined }

const PendingContext = createContext<Pending>(none)

export const usePending = (): Pending => useContext(PendingContext)

/** Delivered and Not delivered kept on the phone until the API has them (docs/mobile-app/delivery/ARCHITECTURE.md §2). */
export function PendingProvider({ children }: { children: ReactNode }) {
  const { host, client, signedIn } = useSession()
  const connected = useConnection()
  const [saved, setSaved] = useState<Saved>(nothingSaved)
  const [loaded, setLoaded] = useState(false)
  const [sentCount, setSentCount] = useState(0)
  const [tries, setTries] = useState(0)
  const current = useRef(saved)
  const flushing = useRef(false)

  const commit = useCallback(
    (next: Saved) => {
      current.current = next
      setSaved(next)
      void keepSaved(host, next).catch(() => undefined)
    },
    [host],
  )

  useEffect(() => {
    let live = true
    void loadSaved(host).then((kept) => {
      if (!live) return
      current.current = kept
      setSaved(kept)
      setLoaded(true)
    })
    return () => {
      live = false
    }
  }, [host])

  const flush = useCallback(async () => {
    if (flushing.current || current.current.steps.length === 0) return
    flushing.current = true
    try {
      const snapshot = current.current.steps
      const { left, notices, sent } = await flushSteps(client, snapshot)
      const added = current.current.steps.filter((step) => !snapshot.includes(step))
      commit({ steps: [...left, ...added], notices: [...current.current.notices, ...notices] })
      if (sent) setSentCount((count) => count + 1)
      setTries((count) => (left.length > 0 ? count + 1 : 0))
    } finally {
      flushing.current = false
    }
  }, [client, commit])

  const waiting = saved.steps.length > 0
  // Signal back: try at once, not after the wait the last failures had built up.
  useEffect(() => {
    if (connected) setTries(0)
  }, [connected])
  useEffect(() => {
    if (!loaded || !signedIn || !connected || !waiting) return
    const timer = setTimeout(() => void flush(), tries === 0 ? 0 : retryAfterMs(tries - 1))
    return () => clearTimeout(timer)
  }, [loaded, signedIn, connected, waiting, tries, flush])

  const keep = useCallback(
    (step: PendingStep) => {
      commit({ ...current.current, steps: [...current.current.steps.filter((kept) => kept.deliveryId !== step.deliveryId), step] })
      setTries(0)
    },
    [commit],
  )

  const notify = useCallback(
    (notice: PendingNotice) => commit({ ...current.current, notices: [...current.current.notices.filter((kept) => kept.deliveryId !== notice.deliveryId), notice] }),
    [commit],
  )

  const dismissNotice = useCallback((deliveryId: string) => commit({ ...current.current, notices: current.current.notices.filter((notice) => notice.deliveryId !== deliveryId) }), [commit])

  const value = useMemo<Pending>(
    () => ({
      steps: saved.steps,
      notices: saved.notices,
      sentCount,
      hidden: new Set([...saved.steps.map((step) => step.deliveryId), ...saved.notices.filter((notice) => notice.code === 'CODE_UNCONFIRMED').map((notice) => notice.deliveryId)]),
      keep,
      notify,
      dismissNotice,
    }),
    [saved, sentCount, keep, notify, dismissNotice],
  )

  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>
}
