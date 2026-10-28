import { anthropicOAuth } from './anthropic'
import { openaiOAuth } from './openai'
import type { OAuthProvider, OAuthProviders } from './types'

/** Both sign-ins are off unless `enabled` (AI_SIGN_IN): the provider's own terms and the CLI client ids make them an operator's call. */
export const createOAuthProviders = (enabled: boolean): OAuthProviders => {
  const gated = (p: OAuthProvider): OAuthProvider => (enabled ? p : { ...p, availability: () => ({ available: false, reason: 'PROVIDER_DOES_NOT_ALLOW' }) })
  return { anthropic: gated(anthropicOAuth()), openai: gated(openaiOAuth()) }
}
export { anthropicOAuth, anthropicOAuthScopes } from './anthropic'
export { createPkce } from './pkce'
export { openaiOAuth, openaiOAuthScopes } from './openai'
export { oauthErrorCodes, OAuthError, type OAuthAvailability, type OAuthErrorCode, type OAuthProvider, type OAuthProviders, type OAuthTokens, type OAuthUnavailable } from './types'
