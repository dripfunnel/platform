import { useSyncExternalStore } from 'react'

// The dev-only Scenario menu's choices (#499): the state, banner, role and look the shell draws, so each can be
// screenshotted without a store in that state. Inert unless `__DEV__`, so a store build can never be put into one.
export type ScreenState = 'normal' | 'slow' | 'loadErr' | 'notFound' | 'denied' | 'expired' | 'removed' | 'offline'
export type BannerScenario = 'real' | 'none' | 'trial' | 'trialEnds' | 'trialEnded' | 'bandwidth' | 'whiteLabel' | 'pastDue' | 'provisioning' | 'support' | 'offline'
export type RoleScenario = 'real' | 'owner' | 'manager' | 'staff' | 'supplierStock' | 'supplierCatalogue' | 'supplierOrders' | 'supplierAdmin'
export type ModeScenario = 'real' | 'light' | 'dark'

export type Scenario = { screen: ScreenState; banner: BannerScenario; role: RoleScenario; mode: ModeScenario }

/** Quoted on a failed screen in the Scenario menu, where there is no real request to name. */
export const sampleReference = 'p-4821'

export const normal: Scenario = { screen: 'normal', banner: 'real', role: 'real', mode: 'real' }

let current: Scenario = normal
const listeners = new Set<() => void>()

export const getScenario = (): Scenario => (__DEV__ ? current : normal)

export const setScenario = (change: Partial<Scenario>): void => {
  if (!__DEV__) return
  current = { ...current, ...change }
  listeners.forEach((listener) => listener())
}

export const resetScenario = (): void => setScenario(normal)

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useScenario = (): Scenario => useSyncExternalStore(subscribe, getScenario)
