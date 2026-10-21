import type { AuthRefusal, Invitation } from '../../api/auth'
import { fill, messages, plural } from '../../messages'

const words = messages.auth
const su = words.signup
const iv = words.invite

/** The words for a refusal on these screens, by its code; tries left where the API counts them. */
export const refusalText = (refusal: AuthRefusal): string => {
  switch (refusal.code) {
    case 'INVALID_CREDENTIALS':
      return words.signIn.refused
    case 'WRONG_CODE':
      return refusal.triesLeft === undefined ? words.secondFactor.wrongPlain : fill(words.secondFactor.wrong, { tries: fill(plural(words.secondFactor.tries, refusal.triesLeft), { count: String(refusal.triesLeft) }) })
    case 'CODE_EXPIRED':
      return words.secondFactor.expired
    case 'RATE_LIMITED':
      return words.rateLimited
    case 'INVALID_PHONE':
      return words.enrol.invalidPhone
    default:
      return words.notConnected
  }
}

/** The sign-up's refusals, worded; the rest are sign-in's. */
export const signupText = (refusal: AuthRefusal): string => {
  switch (refusal.code) {
    case 'NAME_REQUIRED':
      return su.su1.nameMissing
    case 'INVALID_EMAIL':
      return su.su1.emailBad
    case 'WEAK_PASSWORD':
      return su.su1.weak
    case 'SIGNUP_CLOSED':
      return su.su1.closed
    case 'SIGNUP_EXPIRED':
      return su.expired
    case 'INVALID_SUBDOMAIN':
      return su.su3.subBad
    case 'SUBDOMAIN_TAKEN':
      return refusal.suggestions?.length ? fill(su.su3.taken, { suggestions: refusal.suggestions.join(` ${su.su3.or} `) }) : su.su3.takenNone
    case 'COUNTRY_UNAVAILABLE':
      return su.su3.countryNone
    default:
      return refusalText(refusal)
  }
}

/** How an invitation names the seat it offers and what that seat can do (ACCESS.md §3). */
export const roleWords = (facts: Invitation): { role: string; can: string } => {
  if (facts.supplier) return { role: fill(iv.roles.supplier, { seller: facts.supplier }), can: iv.can.supplier }
  const key = facts.role === 'owner' || facts.role === 'manager' ? facts.role : 'staff'
  return { role: iv.roles[key], can: iv.can[key] }
}

/** Which of the inviteBad views a refused invitation link shows. */
export const badInvitationKey = (refusal: AuthRefusal): keyof Omit<typeof words.inviteBad, 'signIn'> =>
  refusal.code === 'INVITATION_EXPIRED' ? 'expired' : refusal.code === 'INVITATION_USED' ? 'used' : refusal.code === 'INVITATION_REPLACED' ? 'replaced' : 'invalid'
