import type { Reauth } from '../../api/impersonation'

// Users (?state=): loading, empty, error, denied (asks as Finance, who has no Impersonate row),
// nomatch, and reauthFailed / reauthCancelled, the company sign-in's two refusals.
export const usersStates = ['loading', 'empty', 'error', 'denied', 'nomatch', 'reauthFailed', 'reauthCancelled'] as const
export type UsersState = (typeof usersStates)[number]

// Sessions (?state=): loading, empty (nothing open, no history), error, denied.
export const sessionsStates = ['loading', 'empty', 'error', 'denied'] as const
export type SessionsState = (typeof sessionsStates)[number]

export const sessionStates = ['loading', 'error'] as const
export type SessionScreenState = (typeof sessionStates)[number]

export const simulatedReauth = (state: string | null): Reauth | null =>
  state === 'reauthFailed' ? { ok: false, outcome: 'failed' } : state === 'reauthCancelled' ? { ok: false, outcome: 'cancelled' } : null
