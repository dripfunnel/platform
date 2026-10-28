import { anthropicOAuth } from './anthropic'
import { openaiOAuth } from './openai'
import type { OAuthProviders } from './types'

export const createOAuthProviders = (): OAuthProviders => ({ anthropic: anthropicOAuth(), openai: openaiOAuth() })
export { anthropicOAuth, anthropicOAuthScopes } from './anthropic'
export { createPkce } from './pkce'
export { openaiOAuth, openaiOAuthScopes } from './openai'
export { oauthErrorCodes, OAuthError, type OAuthAvailability, type OAuthErrorCode, type OAuthProvider, type OAuthProviders, type OAuthTokens, type OAuthUnavailable } from './types'
