import { createContext, useContext, useLayoutEffect, useSyncExternalStore } from 'react'

// Which <AgeConfirmation> a theme placed, so <PlaceOrder> draws one only when none is (#1443).
let placed = 0
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

/** Set by <PlaceOrder>'s own box, which must not count as the theme's. */
export const DrawnByCore = createContext(false)

export const useRegisterAgeBox = (needed: boolean) => {
  const byCore = useContext(DrawnByCore)
  useLayoutEffect(() => {
    if (!needed || byCore) return
    placed += 1
    changed()
    return () => {
      placed -= 1
      changed()
    }
  }, [needed, byCore])
}

/** True until a theme's box has mounted: on the server and while hydrating, core draws nothing. */
export const useThemePlacedAgeBox = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    () => placed > 0,
    () => true,
  )
