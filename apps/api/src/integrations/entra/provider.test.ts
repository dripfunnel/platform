import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SignInFailed } from '#auth/oidc'
import { entraProvider } from './provider'

const tenantId = '11111111-1111-1111-1111-111111111111'
const clientId = 'client-id'
const config = { tenantId, clientId, clientSecret: 'secret' }
const nonce = 'nonce-we-sent'
const redirectUri = 'https://admin.dripfunnel.com/api/auth/callback'

let signingKey: CryptoKey
let otherKey: CryptoKey
let jwks: { keys: JWK[] }

beforeAll(async () => {
  const ours = await generateKeyPair('RS256', { extractable: true })
  const theirs = await generateKeyPair('RS256', { extractable: true })
  signingKey = ours.privateKey
  otherKey = theirs.privateKey
  jwks = { keys: [{ ...(await exportJWK(ours.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] }
})

const idToken = async (
  claims: Record<string, unknown> = {},
  options: { key?: CryptoKey; expiresIn?: string } = {},
) =>
  new SignJWT({
    tid: tenantId,
    nonce,
    oid: 'subject-1',
    email: 'staff@dripfunnel.com',
    name: 'A Staff Member',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience(clientId)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(options.key ?? signingKey)

/** Entra, as far as the provider can tell: the key set and the token endpoint. */
const fakeEntra = (token: { body: unknown; ok?: boolean }) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/discovery/v2.0/keys')) return Response.json(jwks)
    if (url.includes('/oauth2/v2.0/token')) {
      return Response.json(token.body, { status: token.ok === false ? 400 : 200 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })

const exchange = () => entraProvider(config).exchange({ code: 'code', redirectUri, nonce })

const refusalFrom = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (error) {
    if (error instanceof SignInFailed) return error.refusal
    throw error
  }
  throw new Error('expected a refusal, got a sign-in')
}

afterEach(() => vi.restoreAllMocks())

describe('the authorize redirect', () => {
  it('asks for a code, carrying the state and nonce we chose', () => {
    const url = new URL(entraProvider(config).authorizeUrl({ redirectUri, state: 'st', nonce }))
    expect(url.origin + url.pathname).toBe(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`)
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state: 'st',
      nonce,
    })
  })

  it('never puts the client secret in the URL the browser follows', () => {
    const url = entraProvider(config).authorizeUrl({ redirectUri, state: 'st', nonce })
    expect(url).not.toContain('secret')
  })
})

describe('the token exchange', () => {
  it('returns the claims from a token this tenant signed', async () => {
    fakeEntra({ body: { id_token: await idToken() } })
    await expect(exchange()).resolves.toEqual({
      subject: 'subject-1',
      email: 'staff@dripfunnel.com',
      name: 'A Staff Member',
    })
  })

  it('refuses a token from another tenant', async () => {
    // An app registration left on "any Microsoft account" would otherwise let a personal
    // account reach the staff lookup (#89).
    fakeEntra({ body: { id_token: await idToken({ tid: '22222222-2222-2222-2222-222222222222' }) } })
    expect(await refusalFrom(exchange())).toBe('wrong_tenant')
  })

  it('refuses a token signed by a key that is not in the tenant key set', async () => {
    fakeEntra({ body: { id_token: await idToken({}, { key: otherKey }) } })
    expect(await refusalFrom(exchange())).toBe('bad_claims')
  })

  it('refuses a replayed token whose nonce is not the one we sent', async () => {
    fakeEntra({ body: { id_token: await idToken({ nonce: 'some-other-nonce' }) } })
    expect(await refusalFrom(exchange())).toBe('bad_claims')
  })

  it('refuses a token issued for another application', async () => {
    const token = await new SignJWT({ tid: tenantId, nonce, oid: 'x', email: 'a@b.com', name: 'A' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
      .setAudience('a-different-client')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(signingKey)
    fakeEntra({ body: { id_token: token } })
    expect(await refusalFrom(exchange())).toBe('bad_claims')
  })

  it('refuses an expired token', async () => {
    fakeEntra({ body: { id_token: await idToken({}, { expiresIn: '-10m' }) } })
    expect(await refusalFrom(exchange())).toBe('bad_claims')
  })

  it('refuses a response with no token at all', async () => {
    fakeEntra({ body: {} })
    expect(await refusalFrom(exchange())).toBe('bad_claims')
  })
})

describe('what the provider says went wrong', () => {
  const cases: [string, string, string][] = [
    ['the Authenticator request was denied', 'AADSTS500121: Authentication failed', 'mfa_denied'],
    ['the device is not compliant', 'AADSTS53003: Blocked by Conditional Access', 'device_not_compliant'],
    ['the person cancelled', 'AADSTS65004: User declined to consent', 'user_cancelled'],
  ]

  for (const [name, description, expected] of cases) {
    it(`reports ${name} as ${expected}`, async () => {
      fakeEntra({ ok: false, body: { error: 'invalid_grant', error_description: description } })
      expect(await refusalFrom(exchange())).toBe(expected)
    })
  }

  it('reports a bare access_denied as cancelled', async () => {
    fakeEntra({ ok: false, body: { error: 'access_denied', error_description: '' } })
    expect(await refusalFrom(exchange())).toBe('user_cancelled')
  })

  it('reports anything it does not recognise as a plain refusal', async () => {
    fakeEntra({ ok: false, body: { error: 'invalid_grant', error_description: 'AADSTS70000: whatever' } })
    expect(await refusalFrom(exchange())).toBe('provider_refused')
  })

  it('reports Microsoft not answering as unavailable, not as a refusal', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    expect(await refusalFrom(exchange())).toBe('provider_unavailable')
  })
})
