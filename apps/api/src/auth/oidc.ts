import { z } from 'zod'

/**
 * Behind an interface so #13 builds and tests without one. Microsoft Entra ID
 * (THIRD-PARTY-ACCESS.md §2.5); #89 wires the real exchange.
 */
export interface IdentityProvider {
  /** Where to send the browser, and the state to remember for the callback. */
  authorizeUrl: (options: { redirectUri: string; state: string; nonce: string }) => string
  /** Exchange the callback's code. Throws `SignInFailed` for anything the caller may not see. */
  exchange: (options: { code: string; redirectUri: string; nonce: string }) => Promise<IdentityClaims>
}

export const identityClaims = z.object({
  /** Stable per person per tenant: `staff_user.sso_subject`. Never an email, which changes. */
  subject: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
})

export type IdentityClaims = z.infer<typeof identityClaims>

/**
 * Every refusal the caller is allowed to see, which is one refusal. CONSOLE-DESIGN A1:
 * "Unknown or removed staff are refused with no detail."
 */
export class SignInFailed extends Error {
  constructor(readonly reason: string) {
    super('sign-in failed')
    this.name = 'SignInFailed'
  }
}
