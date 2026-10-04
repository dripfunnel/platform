import type { PortalStaffSession } from './staffSession'
import { sessionPollMs } from './usePolling'

// The staff-session reads every tab of a portal polls (ACCESS.md §8.3), asked once for all of them:
// a tab shares each answer over a BroadcastChannel, and a tab holding a fresh one doesn't ask.
// "Mine" stops once the server says this browser has no staff session: one starts only through
// the handoff link, and that tab tells the others.

export type SessionRead = 'current' | 'notice'
type Answer = PortalStaffSession | null
type Message = { type: 'answer'; read: SessionRead; value: Answer; at: number } | { type: 'changed' }

export const sessionChannelName = 'df-staff-session'

// Just under the poll, so one tab's answer serves every other tab's next poll.
export const sessionFreshMs = sessionPollMs - 3_000

export interface SessionChannel {
  postMessage: (message: Message) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}

const isMessage = (data: unknown): data is Message =>
  typeof data === 'object' && data !== null && ((data as Message).type === 'changed' || ((data as Message).type === 'answer' && ['current', 'notice'].includes((data as { read: string }).read)))

const openChannel = (): SessionChannel | null => {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel(sessionChannelName)
  // Node (tests, SSR) would otherwise stay alive for an open channel; browsers have no unref.
  ;(channel as BroadcastChannel & { unref?: () => void }).unref?.()
  return channel
}

export const createSharedSessionReads = ({ now = Date.now, channel: makeChannel = openChannel }: { now?: () => number; channel?: () => SessionChannel | null } = {}) => {
  const cache = new Map<SessionRead, { value: Answer; at: number }>()
  const inFlight = new Map<SessionRead, Promise<Answer>>()
  const listeners = new Set<() => void>()
  let noStaffSession = false
  // A session started or ended since a read began makes its answer stale: it is dropped, never kept.
  let generation = 0
  let changedAt = Number.NEGATIVE_INFINITY

  const remember = (read: SessionRead, value: Answer, at: number) => {
    if (at < changedAt) return
    cache.set(read, { value, at })
    if (read === 'current') noStaffSession = value === null
  }
  const forget = () => {
    generation += 1
    changedAt = now()
    cache.clear()
    inFlight.clear()
    noStaffSession = false
  }
  const channel = makeChannel()
  channel?.addEventListener('message', (event) => {
    if (!isMessage(event.data)) return
    if (event.data.type === 'answer') return remember(event.data.read, event.data.value, event.data.at)
    forget()
    for (const listener of listeners) listener()
  })

  return {
    read: (read: SessionRead, load: () => Promise<Answer>): Promise<Answer> => {
      if (read === 'current' && noStaffSession) return Promise.resolve(null)
      const hit = cache.get(read)
      if (hit && now() - hit.at < sessionFreshMs) return Promise.resolve(hit.value)
      const existing = inFlight.get(read)
      if (existing) return existing
      const asked = generation
      const pending: Promise<Answer> = load()
        .then((value) => {
          if (asked !== generation) return value
          const at = now()
          remember(read, value, at)
          channel?.postMessage({ type: 'answer', read, value, at })
          return value
        })
        .finally(() => {
          if (inFlight.get(read) === pending) inFlight.delete(read)
        })
      inFlight.set(read, pending)
      return pending
    },
    /** This tab entered or ended a session: every tab asks again. */
    changed: () => {
      forget()
      channel?.postMessage({ type: 'changed' })
    },
    /** Another tab entered or ended one. */
    onChanged: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

/**
 * Someone signed in or out: every tab of this portal drops what it heard, so a different user in
 * the same browser never sees the last one's answers. A new channel reaches this tab's reads too.
 */
export const identityChanged = (): void => {
  const channel = openChannel()
  channel?.postMessage({ type: 'changed' })
  ;(channel as BroadcastChannel | null)?.close()
}
