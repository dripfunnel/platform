import { useFocusEffect } from 'expo-router'
import { useCallback, useRef } from 'react'

/** Runs `reload` each time the screen comes back to the front (after an editor on top of it saved), but not on its first showing, which loads on its own. */
export function useReloadOnFocus(reload: () => void): void {
  const first = useRef(true)
  useFocusEffect(
    useCallback(() => {
      if (first.current) first.current = false
      else reload()
    }, [reload]),
  )
}
