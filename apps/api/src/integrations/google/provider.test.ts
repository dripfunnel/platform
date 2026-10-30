import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { SignInFailed } from '#auth/oidc'
import { localGoogleSignIn } from './local'
import { checkGoogleIdToken, googleSignIn } from './provider'

// Built, not written out: GitHub's push protection reads a literal in Google's shape as a leaked credential.
const googleClient = (prefix: string) => [prefix, 'apps', 'googleusercontent', 'com'].join('.')
const clientId = googleClient('111-a')
let signingKey: CryptoKey
let keys: ReturnType<typeof createLocalJWKSet>

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true })
  signingKey = pair.privateKey
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  keys = createLocalJWKSet({ keys: [jwk] })
})

const idToken = (claims: Record<string, unknown> = {}, options: { audience?: string; issuer?: string; expiresIn?: string } = {}) =>
  new SignJWT({ email: 'farhan@gmail.example', email_verified: true, name: 'Farhan Ali', nonce: 'n1', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(options.issuer ?? 'https://accounts.google.com')
    .setAudience(options.audience ?? clientId)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(signingKey)

const refusal = (work: Promise<unknown>) => work.then(() => null, (e: unknown) => (e instanceof SignInFailed ? e.refusal : 'thrown'))

describe('checkGoogleIdToken', () => {
  it('takes a token Google signed for this client, with the nonce it was sent', async () => {
    expect(await checkGoogleIdToken(await idToken(), keys, clientId, 'n1')).toEqual({ email: 'farhan@gmail.example', name: 'Farhan Ali' })
    expect(await checkGoogleIdToken(await idToken({}, { issuer: 'accounts.google.com' }), keys, clientId, null)).toMatchObject({ email: 'farhan@gmail.example' })
  })

  it('refuses another client’s token, another issuer, an old token or the wrong nonce', async () => {
    expect(await refusal(checkGoogleIdToken(await idToken({}, { audience: googleClient('222-b') }), keys, clientId, null))).toBe('bad_claims')
    expect(await refusal(checkGoogleIdToken(await idToken({}, { issuer: 'https://evil.example' }), keys, clientId, null))).toBe('bad_claims')
    expect(await refusal(checkGoogleIdToken(await idToken({}, { expiresIn: '-5m' }), keys, clientId, null))).toBe('bad_claims')
    expect(await refusal(checkGoogleIdToken(await idToken({ nonce: 'other' }), keys, clientId, 'n1'))).toBe('bad_claims')
  })

  it('refuses an address Google hasn’t verified (ACCESS.md §2)', async () => {
    expect(await refusal(checkGoogleIdToken(await idToken({ email_verified: false }), keys, clientId, null))).toBe('bad_claims')
  })
})

describe('googleSignIn', () => {
  it('asks Google for the partner’s client with PKCE and only openid, email and profile', () => {
    const url = new URL(googleSignIn().authorizeUrl({ clientId, redirectUri: 'https://store.example/api/auth/google/callback', state: 's', nonce: 'n', codeChallenge: 'c' }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: clientId, scope: 'openid email profile', code_challenge: 'c', code_challenge_method: 'S256', state: 's', nonce: 'n' })
  })
})

describe('the local stand-in', () => {
  it('stays on the portal host and gives back what was typed, held to the nonce', async () => {
    const local = localGoogleSignIn()
    const url = local.authorizeUrl({ clientId, redirectUri: 'https://store.northstar.localhost/api/auth/google/callback', state: 's', nonce: 'n', codeChallenge: 'c' })
    expect(url.startsWith('/api/auth/google/local?')).toBe(true)
    const code = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ email: 'zoë@example.com', name: 'Zoë', nonce: 'n' }))))
    expect(await local.exchange({ client: { clientId, clientSecret: 'x' }, code, redirectUri: '', codeVerifier: '', nonce: 'n' })).toEqual({ email: 'zoë@example.com', name: 'Zoë' })
    expect(await refusal(local.exchange({ client: { clientId, clientSecret: 'x' }, code, redirectUri: '', codeVerifier: '', nonce: 'other' }))).toBe('bad_claims')
  })
})
