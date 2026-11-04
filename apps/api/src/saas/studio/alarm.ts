// What the store's Durable Object does each minute while its studio may be running (storefront AI-STUDIO §7).

/** AI-STUDIO §9: a container stops after 10 idle minutes. */
export const studioIdleMs = 10 * 60 * 1000

export type AlarmStep = 'stop-orphan' | 'idle-stop' | 'renew' | 'rest'

export type AlarmState = {
  /** A runner in memory with its sandbox loaded; none after the object was evicted or restarted. */
  loaded: boolean
  containerRunning: boolean
  pending: number
  idleForMs: number
}

/**
 * A container still running with no runner to reach it (the object was evicted) is stopped and its place given back,
 * so it never outlives the idle stop or runs past STUDIO_MAX_RUNNING once its lease lapses.
 */
/** Whatever the step did, a socket still open (a frame's or a live one) keeps the sweep ticking (AI-STUDIO §8 "Short-lived"). */
export const sweepsAgain = (openSockets: number, nextAlarm: number | null): boolean => openSockets > 0 && nextAlarm === null

export const alarmStep = (s: AlarmState): AlarmStep => {
  if (!s.loaded) return s.containerRunning ? 'stop-orphan' : 'rest'
  return s.pending === 0 && s.idleForMs >= studioIdleMs ? 'idle-stop' : 'renew'
}
