export const activityStates = ['loading', 'error', 'empty'] as const
export type ActivityState = (typeof activityStates)[number]
