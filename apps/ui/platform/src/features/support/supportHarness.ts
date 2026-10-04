export const supportTabs = ['users', 'sessions'] as const
export type SupportTab = (typeof supportTabs)[number]

export const supportStates = ['loading', 'error', 'denied'] as const
export type SupportState = (typeof supportStates)[number]
