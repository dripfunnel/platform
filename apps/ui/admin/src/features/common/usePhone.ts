import { useSyncExternalStore } from 'react'

// The shell's phone breakpoint (shared/ui/shell.css): below it the console shows only the
// phone states of FIRST-RELEASE.md §5, chosen here by viewport so a URL means the same everywhere.
const phoneQuery = '(max-width: 639px)'

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(phoneQuery)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export const isPhone = (): boolean => window.matchMedia(phoneQuery).matches

/** A route loader for a page a phone replaces (phoneView): nothing to load there. */
export const unlessPhone = <T>(load: () => Promise<T>): Promise<T> | null => (isPhone() ? null : load())

/** The screen has just widened past a phone's, so pages a phone skipped must load now. */
export const widened = (wasPhone: boolean, phone: boolean): boolean => wasPhone && !phone

export const usePhone = (): boolean => useSyncExternalStore(subscribe, isPhone, () => false)
