import { applyTheme, resolveTheme, themeStore, type ThemeChoice } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'

// The key the prototype uses (designs/design.md §10).
const storageKey = 'df-admin-theme'

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

export const useTheme = (): { choice: ThemeChoice; setChoice: (choice: ThemeChoice) => void } => {
  // Memoised: a new store each render would change `setChoice`'s identity.
  const store = useMemo(
    () => themeStore(storageKey, typeof localStorage === 'undefined' ? undefined : localStorage),
    [],
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
