import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { refusalForProviderError, SignInFailed } from '#auth/oidc'

// "Continue with Google" on a partner's portal host, on the partner's own client (#1046;
// THIRD-PARTY-ACCESS §2.9): OpenID Connect with PKCE, checked against Google's published keys.

export interface GoogleClient {
  clientId: string
  clientSecret: string
}

export interface GoogleClaims {
  email: string
  name: string
}

export interface GoogleSignIn {
  authorizeUrl: (options: { clientId: string; redirectUri: string; state: string; nonce: string; codeChallenge: string; email?: string }) => string
  /** The callback's code for a checked ID token. Throws `SignInFailed`. */
  exchange: (options: { client: GoogleClient; code: string; redirectUri: string; codeVerifier: string; nonce: string }) => Promise<GoogleClaims>
  /** An ID token the merchant app got from Google's native sign-in, issued for the partner's web client. Throws `SignInFailed`. */
  verify: (idToken: string, clientId: string) => Promise<GoogleClaims>
}

const authorizeEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth'
const tokenEndpoint = 'https://oauth2.googleapis.com/token'
const keysEndpoint = 'https://www.googleapis.com/oauth2/v3/certs'

/** Every outbound call is bounded (AGENTS "Reliability"). */
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

export const checkGoogleIdToken = async (idToken: string, keys: JWTVerifyGetKey, clientId: string, nonce: string | null): Promise<GoogleClaims> => {
  let payload
  try {
    ;({ payload } = await jwtVerify(idToken, keys, {
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'email'],
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
      clockTolerance: 60,
    }))
  } catch {
    throw new SignInFailed('bad_claims')
  }
  if (nonce !== null && payload['nonce'] !== nonce) throw new SignInFailed('bad_claims')
  // Only an address Google has proven stands for the person (ACCESS.md §2).
  if (payload['email_verified'] !== true || typeof payload['email'] !== 'string') throw new SignInFailed('bad_claims')
  return { email: payload['email'], name: typeof payload['name'] === 'string' ? payload['name'] : '' }
}

export const googleSignIn = (): GoogleSignIn => {
  // Held by the provider, which index.ts builds once per isolate, so Google's keys are fetched once.
  const keys = createRemoteJWKSet(new URL(keysEndpoint), { timeoutDuration: timeoutMs })
  return {
    authorizeUrl: ({ clientId, redirectUri, state, nonce, codeChallenge }) => {
      const url = new URL(authorizeEndpoint)
      for (const [key, value] of Object.entries({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      })) {
        url.searchParams.set(key, value)
      }
      return url.toString()
    },
    exchange: async ({ client, code, redirectUri, codeVerifier, nonce }) => {
      const response = await fetchWithTimeout(tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier }),
      })
      const body = (await response.json().catch(() => ({}))) as { id_token?: unknown; error?: unknown; error_description?: unknown }
      if (!response.ok) {
        throw new SignInFailed(refusalForProviderError(typeof body.error === 'string' ? body.error : '', typeof body.error_description === 'string' ? body.error_description : ''))
      }
      if (typeof body.id_token !== 'string') throw new SignInFailed('bad_claims')
      return checkGoogleIdToken(body.id_token, keys, client.clientId, nonce)
    },
    verify: (idToken, clientId) => checkGoogleIdToken(idToken, keys, clientId, null),
  }
}
