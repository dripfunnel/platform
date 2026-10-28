import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

export const pollEveryMs = 15_000

/** Asks again every 15 seconds while `on`, the screen is in view and the app is in the foreground, and once on coming back (api/DELIVERY.md §7). */
export function useLivePolling(refresh: () => void, on: boolean, everyMs = pollEveryMs): void {
  const [focused, setFocused] = useState(true)
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  const visible = focused && foreground
  const hidden = useRef(false)
  const live = useRef(on)
  live.current = on

  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, []),
  )

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'))
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (!visible) {
      hidden.current = true
      return
    }
    if (hidden.current) {
      hidden.current = false
      if (live.current) refresh()
    }
  }, [visible, refresh])

  useEffect(() => {
    if (!on || !visible) return
    const timer = setInterval(refresh, everyMs)
    return () => clearInterval(timer)
  }, [on, visible, refresh, everyMs])
}
