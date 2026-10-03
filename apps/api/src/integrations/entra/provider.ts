import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { IdentityClaims, IdentityProvider } from '#auth/oidc'
import { refusalForProviderError, SignInFailed } from '#auth/oidc'

export interface EntraConfig {
  tenantId: string
  clientId: string
  clientSecret: string
}

const authority = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}`

/** Every outbound call is bounded (AGENTS "Reliability"); 20s is what the screen promises. */
const timeoutMs = 20_000

const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: abort.signal })
  } catch {
    throw new SignInFailed('provider_unavailable')
  } finally {
    clearTimeout(timer)
  }
}

interface TokenResponse {
  id_token?: unknown
  error?: unknown
  error_description?: unknown
}

export const entraProvider = (config: EntraConfig): IdentityProvider => {
  // Held by this provider, so it is only reused if the provider is (index.ts builds one per
  // isolate). A provider per request would refetch the key set on every sign-in.
  const jwks = createRemoteJWKSet(new URL(`${authority(config.tenantId)}/discovery/v2.0/keys`), {
    timeoutDuration: timeoutMs,
  })

  return {
    authorizeUrl: ({ redirectUri, state, nonce, prompt }) => {
      const url = new URL(`${authority(config.tenantId)}/oauth2/v2.0/authorize`)
      for (const [key, value] of Object.entries({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: 'openid profile email',
        state,
        nonce,
        // `prompt=login` makes Microsoft ask again rather than reuse its own session, which
        // is the whole point of re-authentication (CONSOLE-DESIGN A2).
        ...(prompt ? { prompt } : {}),
      })) {
        url.searchParams.set(key, value)
      }
      return url.toString()
    },

    exchange: async ({ code, redirectUri, nonce }) => {
      const response = await fetchWithTimeout(`${authority(config.tenantId)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          scope: 'openid profile email',
        }),
      })

      const body = (await response.json().catch(() => ({}))) as TokenResponse
      if (!response.ok) {
        throw new SignInFailed(
          refusalForProviderError(
            typeof body.error === 'string' ? body.error : '',
            typeof body.error_description === 'string' ? body.error_description : '',
          ),
        )
      }
      if (typeof body.id_token !== 'string') throw new SignInFailed('bad_claims')

      return verifyIdToken(body.id_token, { jwks, config, nonce })
    },
  }
}

const verifyIdToken = async (
  idToken: string,
  context: { jwks: ReturnType<typeof createRemoteJWKSet>; config: EntraConfig; nonce: string },
): Promise<IdentityClaims> => {
  const { config, nonce } = context
  let payload
  try {
    // Pinned: jose would otherwise accept any algorithm the key set can verify, and only
    // checks `exp` when the token happens to carry one.
    ;({ payload } = await jwtVerify(idToken, context.jwks, {
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'nonce', 'tid'],
      issuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
      audience: config.clientId,
      clockTolerance: 60,
    }))
  } catch {
    throw new SignInFailed('bad_claims')
  }

  // A registration that accepts any Microsoft account would otherwise let a personal account
  // reach the staff table's lookup (#89).
  if (payload.tid !== config.tenantId) throw new SignInFailed('wrong_tenant')
  if (payload.nonce !== nonce) throw new SignInFailed('bad_claims')

  // `oid` only: `sub` is pairwise per app registration, so it could never match a stored
  // `sso_subject` and would refuse as `unknown_subject` instead of saying what went wrong.
  if (typeof payload.oid !== 'string' || payload.oid === '') throw new SignInFailed('bad_claims')

  const email = typeof payload.email === 'string' ? payload.email : payload.preferred_username
  return {
    subject: payload.oid,
    email: typeof email === 'string' ? email : '',
    name: typeof payload.name === 'string' ? payload.name : '',
    // `amr` lists how the person authenticated; Entra adds it as an optional claim (THIRD-PARTY-ACCESS §2.5).
    twoFactor: Array.isArray(payload['amr']) && payload['amr'].includes('mfa'),
  }
}
