import { useSyncExternalStore } from 'react'

// Bumped when this console starts, ends or extends a session, so the strip and the lists reload
// at once rather than at their next poll.
let version = 0
const listeners = new Set<() => void>()

export const sessionsChanged = () => {
  version += 1
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useSessionsVersion = () => useSyncExternalStore(subscribe, () => version, () => version)
