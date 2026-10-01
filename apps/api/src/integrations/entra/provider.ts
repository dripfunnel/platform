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
    // Signature, `iss`, `aud` and expiry; `tid` and `nonce` are checked below because jose
    // has no opinion about them.
    ;({ payload } = await jwtVerify(idToken, context.jwks, {
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

  const email = typeof payload.email === 'string' ? payload.email : payload.preferred_username
  return {
    subject: String(payload.oid ?? payload.sub ?? ''),
    email: typeof email === 'string' ? email : '',
    name: typeof payload.name === 'string' ? payload.name : '',
  }
}
