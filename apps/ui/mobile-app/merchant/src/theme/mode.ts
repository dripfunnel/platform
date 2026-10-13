import { useSyncExternalStore } from 'react'
import type { Mode } from './ThemeProvider'

// Light until the signed-in person's own saved choice is known (ui/README.md §4): the shell sets it from the account
// after sign-in, and puts it back to light on sign-out.
let current: Mode = 'light'
const listeners = new Set<() => void>()

export const getMode = (): Mode => current

export const setMode = (mode: Mode): void => {
  if (mode === current) return
  current = mode
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useMode = (): Mode => useSyncExternalStore(subscribe, getMode)
