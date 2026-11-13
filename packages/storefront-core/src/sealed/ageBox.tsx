'use client'

import { createContext, useCallback, useContext, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react'

// Which <AgeConfirmation> a theme placed on this page, so <PlaceOrder> draws one only when none is (#1443).
type Registry = { placed: number; listeners: Set<() => void> }

const Scope = createContext<Registry | null>(null)

/** Core's own box inside <PlaceOrder> sets this, so it doesn't count as the theme's. */
export const DrawnByCore = createContext(false)

/** One per page, inside the storefront's provider; a box and button outside one never see each other. */
export const AgeBoxScope = ({ children }: { children: ReactNode }) => {
  const [registry] = useState<Registry>(() => ({ placed: 0, listeners: new Set() }))
  return <Scope.Provider value={registry}>{children}</Scope.Provider>
}

const notify = (registry: Registry) => registry.listeners.forEach((listener) => listener())

export const useRegisterAgeBox = (needed: boolean) => {
  const registry = useContext(Scope)
  const byCore = useContext(DrawnByCore)
  useLayoutEffect(() => {
    if (!registry || !needed || byCore) return
    registry.placed += 1
    notify(registry)
    return () => {
      registry.placed -= 1
      notify(registry)
    }
  }, [registry, needed, byCore])
}

/** True until a theme's box has registered, and wherever there is no scope: core then draws nothing. */
export const useThemePlacedAgeBox = () => {
  const registry = useContext(Scope)
  const subscribe = useCallback(
    (listener: () => void) => {
      registry?.listeners.add(listener)
      return () => void registry?.listeners.delete(listener)
    },
    [registry],
  )
  return useSyncExternalStore(
    subscribe,
    () => (registry ? registry.placed > 0 : true),
    () => true,
  )
}
