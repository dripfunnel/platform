// When the store's Durable Object stops its studio's container (storefront AI-STUDIO §7 "Stopping", decided on #1241).

/** Stops 2 minutes after the store's last studio closed, so a reload doesn't cold-start. */
export const studioClosedMs = 2 * 60 * 1000
/** Stops after 5 minutes with no prompt, typing or click while open (a hidden tab sends none). */
export const studioIdleMs = 5 * 60 * 1000
/** Stops 3 hours after it started, however busy; the next activity starts another. */
export const studioCapMs = 3 * 60 * 60 * 1000
/** `studioActivity` is sent at most this often, and the object does nothing for one sooner. */
export const studioActivityEveryMs = 30 * 1000
/** The lease on the account's capacity is renewed at least this often (capacity.ts). */
export const studioTickMs = 60 * 1000

export type AlarmStep = 'stop-orphan' | 'closed-stop' | 'idle-stop' | 'cap-stop' | 'renew' | 'rest'

export type AlarmState = {
  /** A runner in memory with its sandbox loaded; none after the object was evicted or restarted. */
  loaded: boolean
  containerRunning: boolean
  pending: number
  /** The store's open live sockets (#1237): a studio open in some tab. */
  openStudios: number
  /** Since the last live socket closed, or the last activity when that was later. */
  closedForMs: number
  idleForMs: number
  /** Since the container started. */
  runningForMs: number
}

/** Whatever the step did, a socket still open (a frame's or a live one) keeps the sweep ticking (AI-STUDIO §8 "Short-lived"). */
export const sweepsAgain = (openSockets: number, nextAlarm: number | null): boolean => openSockets > 0 && nextAlarm === null

/**
 * A container still running with no runner to reach it (the object was evicted) is stopped and its place given back.
 * A change running or waiting its turn is never cut off; a save behind the frame holds its bytes and needs no container.
 */
export const alarmStep = (s: AlarmState): AlarmStep => {
  if (!s.loaded) return s.containerRunning ? 'stop-orphan' : 'rest'
  if (s.pending > 0) return 'renew'
  if (s.openStudios === 0 && s.closedForMs >= studioClosedMs) return 'closed-stop'
  if (s.idleForMs >= studioIdleMs) return 'idle-stop'
  if (s.runningForMs >= studioCapMs) return 'cap-stop'
  return 'renew'
}

/** `studioActivity`, at most one acted on in 30 s, server side: it starts a stopped container, or puts off a running one's stop. */
export const wakeStep = (loaded: boolean, sinceLastWakeMs: number): 'skip' | 'open' | 'renew' =>
  sinceLastWakeMs < studioActivityEveryMs ? 'skip' : loaded ? 'renew' : 'open'

/** How long until the next look: the first stop due, or the lease's tick, whichever is sooner. */
export const nextLookMs = (s: AlarmState): number => {
  const due = [studioTickMs, studioIdleMs - s.idleForMs, studioCapMs - s.runningForMs]
  if (s.openStudios === 0) due.push(studioClosedMs - s.closedForMs)
  return Math.max(1_000, Math.min(...due))
}
