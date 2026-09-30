import { z } from 'zod'

/**
 * The identity provider, behind an interface so #13 can be built and tested without one.
 * Microsoft Entra ID (decided 2026-10-01, THIRD-PARTY-ACCESS.md §2.5); #89 wires the real
 * exchange and the failure states the prototype designs.
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
