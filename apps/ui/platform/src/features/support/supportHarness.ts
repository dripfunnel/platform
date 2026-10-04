export const supportTabs = ['users', 'sessions'] as const
export type SupportTab = (typeof supportTabs)[number]

export const supportStates = ['loading', 'error', 'denied'] as const
export type SupportState = (typeof supportStates)[number]

export type SearchState = 'ready' | 'searching' | 'failed'

// A search's rows show only once its own answer is in; the last search's never stand in for it.
export const searchState = (search: string | undefined, found: unknown, failed: boolean): SearchState =>
  !search ? 'ready' : failed ? 'failed' : found === null ? 'searching' : 'ready'
