import NetInfo from '@react-native-community/netinfo'
import { useSyncExternalStore } from 'react'

// Whether the phone has a connection. Writes need one (no offline queue: merchant/ARCHITECTURE.md §5, shop/FIRST-RELEASE.md §1),
// so each app shows its offline banner and turns off what writes while it is false; reading carries on with what is already loaded.
let online = true
const listeners = new Set<() => void>()
let watching = false

const set = (next: boolean) => {
  if (next === online) return
  online = next
  listeners.forEach((listener) => listener())
}

const watch = () => {
  if (watching) return
  watching = true
  // `null` is "not known yet": the phone is taken to be online until it says otherwise.
  NetInfo.addEventListener((state) => set(state.isConnected !== false && state.isInternetReachable !== false))
}

export const isOnline = (): boolean => online

const subscribe = (listener: () => void) => {
  watch()
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useOnline = (): boolean => useSyncExternalStore(subscribe, isOnline)
