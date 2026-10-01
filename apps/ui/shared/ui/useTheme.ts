import { applyTheme, resolveTheme, themeStore, type ThemeChoice } from './theme'
import { useCallback, useEffect, useMemo, useState } from 'react'

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

// `storageKey` is the app's, the one its index.html reads before the first paint (design.md §10).
export const useTheme = (storageKey: string): { choice: ThemeChoice; setChoice: (choice: ThemeChoice) => void } => {
  // Memoised: a new store each render would change `setChoice`'s identity.
  const store = useMemo(
    () => themeStore(storageKey, typeof localStorage === 'undefined' ? undefined : localStorage),
    [storageKey],
  )
  const [choice, setStoredChoice] = useState<ThemeChoice>(() => store.read())

  // index.html paints it first; this keeps it in step, including when the OS flips.
  useEffect(() => {
    const paint = () => applyTheme(document.documentElement, resolveTheme(choice, darkQuery().matches))
    paint()
    if (choice !== 'system') return
    const query = darkQuery()
    query.addEventListener('change', paint)
    return () => query.removeEventListener('change', paint)
  }, [choice])

  const setChoice = useCallback(
    (next: ThemeChoice) => {
      store.write(next)
      setStoredChoice(next)
    },
    [store],
  )

  return { choice, setChoice }
}
