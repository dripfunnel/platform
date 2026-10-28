import { z } from 'zod'
import { OAuthError, type OAuthProvider, type OAuthTokens } from './types'
import { openaiResponsesChat } from './openaiResponses'

// The Codex CLI's public PKCE client with its loopback redirect, and the code pasted back (THIRD-PARTY-ACCESS §2.6). It is not a
// registration of ours: OpenAI can refuse it at any time, and the screen says so before the Owner connects.
const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann'
const issuer = 'https://auth.openai.com'
const authorizeEndpoint = `${issuer}/oauth/authorize`
const tokenEndpoint = `${issuer}/oauth/token`
const redirectUri = 'http://localhost:1455/auth/callback'
export const openaiOAuthScopes = 'openid profile email offline_access api.connectors.read api.connectors.invoke'
const timeoutMs = 20_000
const grantErrors: ReadonlySet<string> = new Set(['invalid_grant', 'refresh_token_expired', 'refresh_token_reused'])

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().refine((t) => t.toLowerCase() === 'bearer'),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().positive().finite(),
})

/** The id_token came straight from OpenAI's token endpoint over TLS, so its claims are read without checking the signature. */
const claimsOf = (idToken: string | undefined): { email: string | null; accountId: string | null } => {
  try {
    const part = idToken?.split('.')[1]
    if (!part) return { email: null, accountId: null }
    const payload = JSON.parse(atob(part.replaceAll('-', '+').replaceAll('_', '/'))) as Record<string, unknown>
    const email = typeof payload['email'] === 'string' && payload['email'].length > 0 && payload['email'].length <= 200 ? payload['email'] : null
    const auth = payload['https://api.openai.com/auth']
    const id = typeof auth === 'object' && auth !== null && 'chatgpt_account_id' in auth ? auth.chatgpt_account_id : null
    return { email, accountId: typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : null }
  } catch {
    return { email: null, accountId: null }
  }
}

export const openaiOAuth = ({ fetch: send = fetch }: { fetch?: typeof fetch } = {}): OAuthProvider => {
  const post = (fields: Record<string, string>) =>
    send(tokenEndpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ ...fields, client_id: clientId }),
      signal: AbortSignal.timeout(timeoutMs),
    })

  const tokensFrom = async (response: Response, previous: OAuthTokens | null): Promise<OAuthTokens> => {
    const token = tokenSchema.parse(await response.json())
    const claims = claimsOf(token.id_token)
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? previous?.refreshToken ?? null,
      expiresAt: Date.now() + token.expires_in * 1000,
      accountLabel: claims.email ?? previous?.accountLabel ?? null,
      accountId: claims.accountId ?? previous?.accountId ?? null,
    }
  }

  return {
    id: 'openai',
    redirectUri,
    availability: () => ({ available: true }),
    authorizeUrl: ({ state, challenge }) => {
      const url = new URL(authorizeEndpoint)
      for (const [key, value] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: openaiOAuthScopes, state, code_challenge: challenge, code_challenge_method: 'S256', id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true', originator: 'codex_cli_rs', prompt: 'login' })) url.searchParams.set(key, value)
      return url.toString()
    },
    exchangeCode: async ({ code, verifier }) => {
      try {
        const response = await post({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier })
        if (!response.ok) throw new OAuthError('EXCHANGE_FAILED')
        return await tokensFrom(response, null)
      } catch {
        // OpenAI's body can carry credentials, so none of it goes on.
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
        // Only the grant's own errors end it; invalid_client and the like are ours to fix and must not strand every account.
        const code = await response.json().then((b: unknown) => (typeof b === 'object' && b !== null && 'error' in b ? String(b.error) : ''), () => '')
        throw new OAuthError(grantErrors.has(code) ? 'REFRESH_REJECTED' : 'CLIENT_REFUSED')
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
    // The Codex client has no revocation we may call: removing the account ends our use, and the person can revoke it in ChatGPT.
    revoke: async () => undefined,
    chat: ({ accessToken, accountId }) => openaiResponsesChat(accessToken, accountId),
  }
}
