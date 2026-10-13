import { useSyncExternalStore } from 'react'

// The session a password opens before the second factor, held in memory only: it is not a signed-in session,
// and an app that is killed here wakes up signed out (session/sessionStore.ts).
export type Pending =
  | { step: 'second-factor'; token: string; method: 'app' | 'sms'; hint: string | null }
  | {
      step: 'enrol'
      token: string
      /** The number, then the code texted to it, then the backup codes shown once. */
      phase: 'phone' | 'code' | 'codes'
      hint: string | null
      phone: string
      codes: string[]
      /** The full session the set-up answered with, opened once the person has saved their backup codes. */
      finalToken: string | null
    }

export const createPendingStore = () => {
  let current: Pending | null = null
  const listeners = new Set<() => void>()
  return {
    get: (): Pending | null => current,
    set: (next: Pending | null): void => {
      current = next
      listeners.forEach((listener) => listener())
    },
    clear: (): void => {
      current = null
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

export type PendingStore = ReturnType<typeof createPendingStore>

export const pendingStore = createPendingStore()

export const usePending = (): Pending | null => useSyncExternalStore(pendingStore.subscribe, pendingStore.get)
