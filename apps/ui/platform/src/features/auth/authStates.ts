// The sign-in screen's steps and the states the prototype designs for each (FIRST-RELEASE §3).
export const signInSteps = ['credentials', 'code', 'forgot', 'sent'] as const

export type SignInStep = (typeof signInSteps)[number]

export const signInStates = ['wrong', 'code', 'wrongCode', 'expiredCode', 'locked', 'forgot', 'sent', 'expired', 'notConnected'] as const

export type SignInState = (typeof signInStates)[number]

// What the Worker's sign-in reports in the address (`?outcome=`): read in production too.
export const signInOutcomes = ['expired'] as const
