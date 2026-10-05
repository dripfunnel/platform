import { useSyncExternalStore } from 'react'

// The shell's phone breakpoint (shared/ui/shell.css): below it a screen shows its phone layout, chosen here
// by viewport so a URL means the same everywhere.
const phoneQuery = '(max-width: 639px)'

const subscribe = (onChange: () => void) => {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(phoneQuery)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export const isPhone = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia(phoneQuery).matches

export const usePhone = (): boolean => useSyncExternalStore(subscribe, isPhone, () => false)
