import { z } from 'zod'
import { anthropicChat } from '../anthropicChat'
import { OAuthError, type OAuthProvider, type OAuthTokens } from './types'

// Claude Code's public PKCE client, with the code pasted back (THIRD-PARTY-ACCESS §2.6). It is not a registration of ours, and
// Anthropic's terms do not allow it; the screen says so before the Owner connects.
const clientId = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const authorizeEndpoint = 'https://claude.ai/oauth/authorize'
const tokenEndpoint = 'https://api.anthropic.com/v1/oauth/token'
const redirectUri = 'https://platform.claude.com/oauth/code/callback'
export const anthropicOAuthScopes = 'user:profile user:inference'
const timeoutMs = 20_000

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().refine((t) => t.toLowerCase() === 'bearer'),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().finite(),
})

export const anthropicOAuth = ({ fetch: send = fetch }: { fetch?: typeof fetch } = {}): OAuthProvider => {
  const post = (fields: Record<string, string>) =>
    send(tokenEndpoint, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ...fields, client_id: clientId }), signal: AbortSignal.timeout(timeoutMs) })

  const tokensFrom = async (response: Response, previous: OAuthTokens | null): Promise<OAuthTokens> => {
    const token = tokenSchema.parse(await response.json())
    return { accessToken: token.access_token, refreshToken: token.refresh_token ?? previous?.refreshToken ?? null, expiresAt: Date.now() + token.expires_in * 1000, accountLabel: null, accountId: null }
  }

  return {
    id: 'anthropic',
    redirectUri,
    availability: () => ({ available: true }),
    authorizeUrl: ({ state, challenge }) => {
      const url = new URL(authorizeEndpoint)
      for (const [key, value] of Object.entries({ code: 'true', prompt: 'login', response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: anthropicOAuthScopes, state, code_challenge: challenge, code_challenge_method: 'S256' })) url.searchParams.set(key, value)
      return url.toString()
    },
    exchangeCode: async ({ code, state, verifier }) => {
      try {
        const response = await post({ grant_type: 'authorization_code', code, state, redirect_uri: redirectUri, code_verifier: verifier })
        if (!response.ok) throw new OAuthError('EXCHANGE_FAILED')
        return await tokensFrom(response, null)
      } catch {
        // Anthropic's body can carry credentials, so none of it goes on.
        throw new OAuthError('EXCHANGE_FAILED')
      }
    },
    refresh: async (tokens) => {
      if (!tokens.refreshToken) throw new OAuthError('REFRESH_REJECTED')
      let response: Response
      try {
        response = await post({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken })
      } catch {
        throw new OAuthError('PROVIDER_DOWN')
      }
      if (response.status === 400 || response.status === 401) {
        const code = await response.json().then((b: unknown) => (typeof b === 'object' && b !== null && 'error' in b ? String(b.error) : ''), () => '')
        throw new OAuthError(code === 'invalid_grant' ? 'REFRESH_REJECTED' : 'CLIENT_REFUSED')
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new OAuthError('PROVIDER_DOWN')
      }
      try {
        return await tokensFrom(response, tokens)
      } catch {
        throw new OAuthError('PROVIDER_DOWN')
      }
    },
    // Anthropic publishes no revocation endpoint for this client: removing the account ends our use, and the person can revoke it in Claude.
    revoke: async () => undefined,
    chat: ({ accessToken }) => anthropicChat({ authToken: accessToken }),
  }
}
