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

// Generic because a screen may have states of its own, such as the sign-in screen's.
export const parseScreenState = <State extends string>(
  value: unknown,
  allowed: readonly State[],
): State | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as State) : null
