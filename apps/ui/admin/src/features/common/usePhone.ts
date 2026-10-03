import { useSyncExternalStore } from 'react'

// The shell's phone breakpoint (shared/ui/shell.css): below it the console shows only the
// phone states of FIRST-RELEASE.md §5, chosen here by viewport so a URL means the same everywhere.
const phoneQuery = '(max-width: 639px)'

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(phoneQuery)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export const usePhone = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(phoneQuery).matches,
    () => false,
  )
