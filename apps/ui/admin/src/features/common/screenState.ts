export const screenStates = ['empty', 'loading', 'error', 'denied', 'readonly', 'confirm'] as const

export type ScreenState = (typeof screenStates)[number]

export interface HarnessEnv {
  DEV: boolean
  VITE_STATE_HARNESS?: string
}

// Feature environments build in production mode, so DEV alone would hide the harness there
// (issue #16). The variable is opt-in; production never sets it.
export const isHarnessEnabled = (env: HarnessEnv): boolean =>
  env.DEV || env.VITE_STATE_HARNESS === '1'

export const parseScreenState = (
  value: unknown,
  allowed: readonly ScreenState[],
): ScreenState | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as ScreenState)
    : null
