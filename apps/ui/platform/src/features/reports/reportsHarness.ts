export const reportsStates = ['loading', 'error', 'fresh'] as const
export type ReportsState = (typeof reportsStates)[number]
