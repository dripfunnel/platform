import { z } from 'zod'

/**
 * Behind an interface so #13 builds and tests without one. Microsoft Entra ID
 * (THIRD-PARTY-ACCESS.md §2.5); #89 wires the real exchange.
 */
export interface IdentityProvider {
  /** Where to send the browser, and the state to remember for the callback. */
  authorizeUrl: (options: { redirectUri: string; state: string; nonce: string; prompt?: 'login' }) => string
  /** Exchange the callback's code. Throws `SignInFailed` for anything the caller may not see. */
  exchange: (options: { code: string; redirectUri: string; nonce: string }) => Promise<IdentityClaims>
}

export const identityClaims = z.object({
  /** Stable per person per tenant: `staff_user.sso_subject`. Never an email, which changes. */
  subject: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
})

/**
 * What the sign-in screen shows (apps/ui/admin .../signInStates.ts). Everything about whether
 * an account exists collapses to `refused`, so the screen cannot enumerate staff (A1).
 */
export type SignInOutcome = 'cancelled' | 'denied' | 'blocked' | 'unavailable' | 'refused'

export const signInStateFor = (refusal: SignInRefusal): SignInOutcome => {
  switch (refusal) {
    case 'user_cancelled':
      return 'cancelled'
    case 'mfa_denied':
      return 'denied'
    case 'device_not_compliant':
      return 'blocked'
    case 'provider_unavailable':
    case 'provider_unconfigured':
      return 'unavailable'
    default:
      return 'refused'
  }
}

export type IdentityClaims = z.infer<typeof identityClaims>

/** One mapping for both channels, so the callback's query and the token response cannot drift. */
export const refusalForProviderError = (error: string, description: string): SignInRefusal => {
  if (/AADSTS50158|AADSTS500121|AADSTS50076|AADSTS50079/.test(description)) return 'mfa_denied'
  if (/AADSTS53000|AADSTS53001|AADSTS53003|AADSTS530003/.test(description)) return 'device_not_compliant'
  if (/AADSTS65004|AADSTS50125|AADSTS50140/.test(description)) return 'user_cancelled'
  if (error === 'access_denied') return 'user_cancelled'
  if (error === 'temporarily_unavailable' || error === 'server_error') return 'provider_unavailable'
  return 'provider_refused'
}

/**
 * Why a sign-in was refused, for the operator only. Literals, so an entry can never carry a
 * subject or an email (LOGGING.md §4.1).
 */
export type SignInRefusal =
  | 'missing_code'
  | 'missing_handshake'
  | 'state_mismatch'
  | 'bad_claims'
  | 'unknown_subject'
  | 'staff_suspended'
  | 'staff_not_active'
  | 'provider_refused'
  | 'provider_unconfigured'
  | 'user_cancelled'
  | 'mfa_denied'
  | 'device_not_compliant'
  | 'provider_unavailable'
  | 'wrong_tenant'
  | 'no_session_to_reauth'
  | 'reauth_session_mismatch'

/**
 * Every refusal the caller is allowed to see, which is one refusal. CONSOLE-DESIGN A1:
 * "Unknown or removed staff are refused with no detail."
 */
export class SignInFailed extends Error {
  constructor(readonly refusal: SignInRefusal) {
    super('sign-in failed')
    this.name = 'SignInFailed'
  }
}
