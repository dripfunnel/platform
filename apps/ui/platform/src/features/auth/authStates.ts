// The sign-in screen's steps and the states the prototype designs for each (FIRST-RELEASE §3).
export const signInSteps = ['credentials', 'code', 'forgot', 'sent'] as const

export type SignInStep = (typeof signInSteps)[number]

export const signInStates = ['wrong', 'code', 'wrongCode', 'expiredCode', 'locked', 'forgot', 'sent', 'expired', 'notConnected'] as const

export type SignInState = (typeof signInStates)[number]

// What the Worker's sign-in reports in the address (`?outcome=`): read in production too.
export const signInOutcomes = ['expired'] as const

export interface SignInView {
  step: SignInStep
  error: string | null
  locked: boolean
  // The "session expired" words on the credentials step, only until the user moves on.
  expired: boolean
}

export type SignInAction =
  | { type: 'reset'; view: SignInView }
  | { type: 'back' }
  | { type: 'forgot' }
  | { type: 'code' }
  | { type: 'sent' }
  | { type: 'error'; error: string | null }
  | { type: 'locked'; error: string }

export const credentialsView: SignInView = { step: 'credentials', error: null, locked: false, expired: false }

// One place decides what each move does to the card, so leaving a step clears what belonged to it.
export const signInReducer = (view: SignInView, action: SignInAction): SignInView => {
  switch (action.type) {
    case 'reset':
      return action.view
    case 'back':
      return credentialsView
    case 'forgot':
      return { ...credentialsView, step: 'forgot' }
    case 'code':
      return { ...view, step: 'code', error: null, expired: false }
    case 'sent':
      return { ...view, step: 'sent', error: null }
    case 'error':
      return { ...view, error: action.error }
    case 'locked':
      return { ...view, error: action.error, locked: true }
  }
}
