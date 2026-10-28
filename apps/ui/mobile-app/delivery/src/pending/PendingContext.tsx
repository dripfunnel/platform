import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useOnline as useConnection } from '@dripfunnel/mobile-shared/connection'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { useSession } from '../session/SessionContext'
import { flushSteps } from './send'
import { forgetLastRider, keepLastRider, keepSaved, loadLastRider, loadSaved, nothingSaved, type PendingNotice, type PendingStep, type Saved } from './store'

/** First retry after 5 s, doubling to 5 minutes, while steps wait and the phone says it has signal. */
export const retryAfterMs = (tries: number): number => Math.min(5_000 * 2 ** tries, 300_000)

export type Pending = {
  steps: readonly PendingStep[]
  notices: readonly PendingNotice[]
  /** Counts the times a step was taken by the API, so a screen can load again. */
  sentCount: number
  /** Deliveries that must not show as the rider's current one: a step waits to be sent, or the store will confirm it. */
  hidden: ReadonlySet<string>
  /** Writes the step to secure storage and tries to send it now. False when it could not be written, so it is not saved. */
  keep: (step: PendingStep) => Promise<boolean>
  /** Keeps an answer for the rider to read on Home, as when the API answers a step at once. */
  notify: (notice: PendingNotice) => void
  dismissNotice: (deliveryId: string) => void
  /** Removes everything kept for this rider and the last-rider mark, for an account that is gone: those steps can never be sent. */
  forget: () => Promise<void>
}

const none: Pending = { steps: [], notices: [], sentCount: 0, hidden: new Set(), keep: () => Promise.resolve(true), notify: () => undefined, dismissNotice: () => undefined, forget: () => Promise.resolve() }

const PendingContext = createContext<Pending>(none)

export const usePending = (): Pending => useContext(PendingContext)

/** Delivered and Not delivered kept on the phone until the API has them (docs/mobile-app/delivery/ARCHITECTURE.md §2). */
export function PendingProvider({ children }: { children: ReactNode }) {
  const { host, client, signedIn, fetchRider } = useSession()
  const connected = useConnection()
  const [rider, setRider] = useState<string | null>(null)
  const [saved, setSaved] = useState<Saved>(nothingSaved)
  const [loaded, setLoaded] = useState(false)
  const [sentCount, setSentCount] = useState(0)
  const [tries, setTries] = useState(0)
  const current = useRef(saved)
  const flushing = useRef(false)

  // The rider the steps belong to: asked of the API, or the last one it named when the phone has no signal.
  useEffect(() => {
    let live = true
    if (!signedIn) {
      setRider(null)
      return
    }
    void (async () => {
      // The last rider stands in only when there was no answer; any other failure leaves the steps unowned rather than under someone else.
      const known = await fetchRider().then(
        async ({ id }) => (await keepLastRider(host, id), id),
        (error: unknown) => (isApiError(error, 'NO_RESPONSE') ? loadLastRider(host) : null),
      )
      if (live) setRider(known)
    })()
    return () => {
      live = false
    }
  }, [host, signedIn, connected, fetchRider])

  useEffect(() => {
    let live = true
    setLoaded(false)
    current.current = nothingSaved
    setSaved(nothingSaved)
    if (rider === null) return
    void loadSaved(host, rider).then((kept) => {
      if (!live) return
      current.current = kept
      setSaved(kept)
      setLoaded(true)
    })
    return () => {
      live = false
    }
  }, [host, rider])

  /** Holds `next` in memory and writes it; when the write fails memory goes back to what it was and this answers false. */
  const commit = useCallback(
    async (next: Saved): Promise<boolean> => {
      if (rider === null) return false
      const before = current.current
      current.current = next
      setSaved(next)
      try {
        await keepSaved(host, rider, next)
        return true
      } catch {
        current.current = before
        setSaved(before)
        return false
      }
    },
    [host, rider],
  )

  const flush = useCallback(async () => {
    if (flushing.current || current.current.steps.length === 0) return
    flushing.current = true
    try {
      const snapshot = current.current.steps
      const { left, notices, sent } = await flushSteps(client, snapshot)
      const added = current.current.steps.filter((step) => !snapshot.includes(step))
      const replaced = left.filter((step) => !added.some((newer) => newer.deliveryId === step.deliveryId))
      await commit({ steps: [...replaced, ...added], notices: [...current.current.notices, ...notices] })
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
    async (step: PendingStep): Promise<boolean> => {
      const done = await commit({ ...current.current, steps: [...current.current.steps.filter((kept) => kept.deliveryId !== step.deliveryId), step] })
      if (done) setTries(0)
      return done
    },
    [commit],
  )

  const notify = useCallback(
    (notice: PendingNotice) => void commit({ ...current.current, notices: [...current.current.notices.filter((kept) => kept.deliveryId !== notice.deliveryId), notice] }),
    [commit],
  )

  const forget = useCallback(async () => {
    await commit(nothingSaved)
    await forgetLastRider(host)
  }, [commit, host])

  const dismissNotice = useCallback((deliveryId: string) => void commit({ ...current.current, notices: current.current.notices.filter((notice) => notice.deliveryId !== deliveryId) }), [commit])

  const value = useMemo<Pending>(
    () => ({
      steps: saved.steps,
      notices: saved.notices,
      sentCount,
      hidden: new Set([...saved.steps.map((step) => step.deliveryId), ...saved.notices.filter((notice) => notice.code === 'CODE_UNCONFIRMED').map((notice) => notice.deliveryId)]),
      keep,
      notify,
      dismissNotice,
      forget,
    }),
    [saved, sentCount, keep, notify, dismissNotice, forget],
  )

  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>
}
