// The states the admin prototype designs for staff sign-in with Microsoft Entra ID; `start`
// is the default and is not a ?state= value.
export const signInStates = [
  'signing',
  'approve',
  'code',
  'cancelled',
  'denied',
  'unavailable',
  'blocked',
  'refused',
  'expired',
] as const

export type SignInState = 'start' | (typeof signInStates)[number]

export const problemStates = ['cancelled', 'denied', 'unavailable', 'blocked'] as const

export type ProblemState = (typeof problemStates)[number]

export const isProblemState = (state: SignInState): state is ProblemState =>
  (problemStates as readonly string[]).includes(state)
