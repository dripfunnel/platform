export const screenStates = ['empty', 'loading', 'error', 'denied', 'readonly', 'confirm'] as const

export type ScreenState = (typeof screenStates)[number]
