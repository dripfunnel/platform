import type { AuthRefusal, Country, Invitation } from '../../api/auth'

// The views each getting-in screen designs (designs/PortalAuth.dc.html), reachable with ?state= in a
// harness build (ui/README.md §6), named apart from StaffSessionRoot's, which every screen also reads.
export const signInStates = ['wrong', 'code', 'codeApp', 'wrongCode', 'backup', 'enrol', 'enrolCode', 'codes', 'locked', 'forgot', 'sent', 'sessionExpired', 'signedOut', 'notConnected', 'rateLimited'] as const

export type SignInState = (typeof signInStates)[number]

export const signUpStates = ['email', 'store', 'taken', 'phone', 'phoneCode', 'building', 'closed'] as const

export type SignUpState = (typeof signUpStates)[number]

export const invitationStates = ['new', 'join', 'supplier', 'linkExpired', 'linkUsed', 'linkReplaced', 'linkInvalid'] as const

export type InvitationState = (typeof invitationStates)[number]

export const resetStates = ['linkInvalid', 'mismatch'] as const

export const confirmEmailStates = ['done', 'bad'] as const

// What ?state= substitutes for the API's answers. The condition is a build-time constant Vite folds,
// so a production bundle carries none of these literals (as the partner console's authStates.ts).
const samples =
  import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'
    ? {
        hint: '•••• 2113',
        email: 'farhan@gmail.com',
        codes: ['k7pm-2qxd', 'r4tn-8vhc', 'w9fz-3jbe', 'm2gs-6ykq', 'h5dc-7nup', 'x3lv-9rta', 'b8qw-4mfe', 'p6jh-2czs', 'e7rk-5tnw', 'u4xb-8gdl'],
        countries: [
          { code: 'IN', name: 'India', currency: 'INR' },
          { code: 'US', name: 'United States', currency: 'USD' },
        ] satisfies Country[],
        invitation: { store: 'Northwind Goods', role: 'staff', supplier: null, email: 'farhan@gmail.com', invitedBy: 'Nadia', path: 'new' } satisfies Invitation,
        suggestions: ['northwind-goods-2', 'northwind-shop'],
      }
    : null

export const sampleHint = samples?.hint ?? ''
export const sampleEmail = samples?.email ?? ''
export const sampleCodes: readonly string[] = samples?.codes ?? []
export const sampleCountries: readonly Country[] = samples?.countries ?? []
export const sampleSuggestions: readonly string[] = samples?.suggestions ?? []

const linkCodes = { linkExpired: 'INVITATION_EXPIRED', linkUsed: 'INVITATION_USED', linkReplaced: 'INVITATION_REPLACED', linkInvalid: 'INVITATION_INVALID' } as const

export const sampleInvitation = (state: InvitationState): { ok: true; invitation: Invitation } | AuthRefusal => {
  if (!samples) return { ok: false, code: 'NOT_CONNECTED' }
  if (state === 'new') return { ok: true, invitation: samples.invitation }
  if (state === 'join') return { ok: true, invitation: { ...samples.invitation, path: 'join' } }
  if (state === 'supplier') return { ok: true, invitation: { ...samples.invitation, role: 'supplier-admin', supplier: 'Loom & Co' } }
  return { ok: false, code: linkCodes[state], invitedBy: samples.invitation.invitedBy }
}
