import type { AuthRefusal, Invitation } from '../../api/auth'

// The sign-in screen's steps and the states the prototype designs for each (FIRST-RELEASE §3).
// `enrol` is the API's: a user without 2-factor whose partner requires it sets it up first (§3).
export const signInSteps = ['credentials', 'code', 'enrol', 'forgot', 'sent'] as const

export type SignInStep = (typeof signInSteps)[number]

export const signInStates = ['wrong', 'code', 'wrongCode', 'expiredCode', 'locked', 'enrol', 'forgot', 'sent', 'expired', 'notConnected', 'rateLimited'] as const

export type SignInState = (typeof signInStates)[number]

// What the Worker's sign-in reports in the address (`?outcome=`): read in production too.
export const signInOutcomes = ['expired'] as const

export const acceptInviteStates = ['expired', 'used', 'replaced', 'invalid', 'member', 'twoFactor', 'required'] as const

export type AcceptInviteState = (typeof acceptInviteStates)[number]

// The lock the harness shows; a real one carries its own minutes.
export const sampleLockMinutes = 15

// What ?state= substitutes for the API's answer, in a harness build only: the condition is a
// build-time constant Vite folds, so a production bundle carries none of these literals.
const samples =
  import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'
    ? {
        owner: { partner: 'Kaufladen Digital', role: 'partner-owner', email: 'jonas@kaufladen.de', invitedBy: 'DripFunnel', secondFactorRequired: false } satisfies Invitation,
        member: { partner: 'Kaufladen Digital', role: 'partner-admin', email: 'petra@kaufladen.de', invitedBy: 'Jonas Weber, the Owner', secondFactorRequired: false } satisfies Invitation,
        secret: 'JBSWY3DPEHPK3PXP',
      }
    : null

export const sampleSecret = samples?.secret ?? ''

const linkCodes = { expired: 'INVITATION_EXPIRED', used: 'INVITATION_USED', replaced: 'INVITATION_REPLACED', invalid: 'INVITATION_INVALID' } as const

export const sampleInvitation = (state: AcceptInviteState): { ok: true; invitation: Invitation } | AuthRefusal => {
  if (!samples) return { ok: false, code: 'NOT_CONNECTED' }
  if (state === 'member') return { ok: true, invitation: samples.member }
  if (state === 'twoFactor') return { ok: true, invitation: samples.owner }
  if (state === 'required') return { ok: true, invitation: { ...samples.member, secondFactorRequired: true } }
  return { ok: false, code: linkCodes[state] }
}

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
  | { type: 'enrol' }
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
    case 'enrol':
      return { ...view, step: 'enrol', error: null, expired: false }
    case 'sent':
      return { ...view, step: 'sent', error: null }
    case 'error':
      return { ...view, error: action.error }
    case 'locked':
      return { ...view, error: action.error, locked: true }
  }
}
