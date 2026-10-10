import type { KeyboardEvent } from 'react'

/** WAI-ARIA tabs' keys: the arrows move with wrap, Home and End go to the ends, and the tab reached is chosen and focused. */
export const tabKeyHandler =
  <T,>(tabs: readonly T[], current: T, choose: (tab: T) => void, focus: (tab: T) => void) =>
  (event: KeyboardEvent) => {
    const at = tabs.indexOf(current)
    const step = ({ ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 } as Partial<Record<string, number>>)[event.key]
    const next = step === undefined || tabs.length === 0 ? undefined : tabs[(step + tabs.length) % tabs.length]
    if (next === undefined) return
    event.preventDefault()
    choose(next)
    focus(next)
  }
