import type { ChatProvider, GatewayProvider } from '../gateway'

// A provider's OAuth sign-in for an AI account (THIRD-PARTY-ACCESS §2.6); a provider that doesn't allow it says so.
export interface OAuthTokens {
  accessToken: string
  refreshToken: string | null
  /** Epoch milliseconds. */
  expiresAt: number
  /** What the person signed in as (the account's email), for display; never a credential. */
  accountLabel: string | null
  /** The ChatGPT workspace the Codex endpoint is called as; null for a provider with none. */
  accountId: string | null
}

export type OAuthUnavailable = 'PROVIDER_DOES_NOT_ALLOW' | 'CLIENT_NOT_CONFIGURED'
export type OAuthAvailability = { available: true } | { available: false; reason: OAuthUnavailable }

export const oauthErrorCodes = ['UNAVAILABLE', 'EXCHANGE_FAILED', 'REFRESH_REJECTED', 'CLIENT_REFUSED', 'PROVIDER_DOWN'] as const
export type OAuthErrorCode = (typeof oauthErrorCodes)[number]

/** Why a sign-in step failed, with no upstream body, header or token in it. `REFRESH_REJECTED` means the grant is gone; `CLIENT_REFUSED`, that our own client is. */
export class OAuthError extends Error {
  override name = 'OAuthError'
  constructor(readonly code: OAuthErrorCode) {
    super(code)
  }
}

export interface OAuthProvider {
  readonly id: GatewayProvider
  availability: () => OAuthAvailability
  /** Where the provider sends the person with the code: its own page or a loopback address, never ours (the person pastes it back). */
  readonly redirectUri: string
  authorizeUrl: (input: { state: string; challenge: string }) => string
  exchangeCode: (input: { code: string; state: string; verifier: string }) => Promise<OAuthTokens>
  refresh: (tokens: OAuthTokens) => Promise<OAuthTokens>
  /** Best effort: a provider that cannot be reached still lets the account be removed here. */
  revoke: (tokens: OAuthTokens) => Promise<void>
  /** The adapter that calls the provider's model endpoint with the access token. */
  chat: (tokens: { accessToken: string; accountId: string | null }) => ChatProvider
}

export type OAuthProviders = Readonly<Record<GatewayProvider, OAuthProvider>>
