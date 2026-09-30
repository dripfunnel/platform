export const dashboardStates = ['loading', 'empty', 'error', 'stale', 'offline'] as const

export type DashboardState = (typeof dashboardStates)[number]
