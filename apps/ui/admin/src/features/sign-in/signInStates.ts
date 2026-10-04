// The states the admin prototype designs for staff sign-in with Microsoft Entra ID; `start`
// is the default, and `?state=start` opens the walkthrough at its first step.
export const signInStates = [
  'start',
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

export type SignInState = (typeof signInStates)[number]

/** The prototype's steps play only on an address with ?state=; otherwise the button goes to Microsoft. */
export const walksThrough = (forced: SignInState | null): boolean => forced !== null

/**
 * What the Worker's callback reports (apis/admin/auth.ts). Read in production, unlike the
 * ?state= harness: these are real results, and `refused` is every account question at once.
 */
export const signInOutcomes = ['cancelled', 'denied', 'unavailable', 'blocked', 'refused'] as const

export type SignInOutcome = (typeof signInOutcomes)[number]

export const problemStates = ['cancelled', 'denied', 'unavailable', 'blocked'] as const

export type ProblemState = (typeof problemStates)[number]

export const isProblemState = (state: SignInState): state is ProblemState =>
  (problemStates as readonly string[]).includes(state)
