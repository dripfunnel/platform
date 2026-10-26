import { useFocusEffect } from 'expo-router'
import { useCallback, useRef } from 'react'

/** Asks again each time the screen comes back into view (the stack keeps it mounted), not when it first opens: so a save made on the next screen shows. */
export function useRefreshOnFocus(refresh: () => void): void {
  const opened = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (opened.current) refresh()
      opened.current = true
    }, [refresh]),
  )
}
