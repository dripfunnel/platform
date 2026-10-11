import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { acceptRun, actionsIssuer, actionsKeys, TokenRefused, verifyActionsToken, type ActionsRun } from './oidc'

// INF 2b (#517): GitHub's OIDC token for a store build, against fake GitHub keys (storefront LIVE-SHOP.md §9).

const audience = 'https://hooks.dripfunnel.com'
const now = new Date('2026-10-11T10:00:00Z')
const keys: { kid: string; privateKey: CryptoKey; jwk: JWK }[] = []
let served: JWK[] = []
let fetches = 0

const fakeGitHub = (async () => {
  fetches += 1
  return Response.json({ keys: served })
}) as unknown as typeof fetch

const newKey = async (kid: string) => {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const key = { kid, privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } }
  keys.push(key)
  return key
}

const claims = {
  repository: 'dripfunnel/sf-abcdefghij',
  repository_id: '4242',
  job_workflow_ref: 'dripfunnel/sf-abcdefghij/.github/workflows/build.yml@refs/heads/main',
  ref: 'refs/heads/main',
  event_name: 'workflow_dispatch',
  run_id: '9001',
}

const token = async (o: { extra?: Record<string, unknown>; kid?: string; aud?: string; iss?: string; exp?: number; key?: CryptoKey } = {}) => {
  const signer = keys.find((k) => k.kid === (o.kid ?? 'k1'))
  if (!signer) throw new Error('no such key')
  const at = Math.floor(now.getTime() / 1000)
  return new SignJWT({ ...claims, ...o.extra })
    .setProtectedHeader({ alg: 'RS256', kid: o.kid ?? 'k1' })
    .setIssuer(o.iss ?? actionsIssuer)
    .setAudience(o.aud ?? audience)
    .setIssuedAt(at - 60)
    .setExpirationTime(o.exp ?? at + 240)
    .sign(o.key ?? signer.privateKey)
}

const refusal = (work: Promise<unknown>) =>
  work.then(
    () => 'accepted',
    (error: unknown) => (error instanceof TokenRefused ? error.reason : String(error)),
  )

beforeAll(async () => {
  await newKey('k1')
  await newKey('k2')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('verifyActionsToken', () => {
  it('accepts GitHub’s signature for our audience and answers the run’s claims', async () => {
    served = [keys[0]?.jwk ?? {}]
    const run = await verifyActionsToken(await token(), actionsKeys(fakeGitHub), audience, now)
    expect(run).toEqual({ repositoryId: '4242', jobWorkflowRef: claims.job_workflow_ref, ref: 'refs/heads/main', eventName: 'workflow_dispatch', runId: '9001' })
  })

  it('refuses an expired token, another audience, another issuer and a forged signature', async () => {
    served = [keys[0]?.jwk ?? {}]
    const keySet = actionsKeys(fakeGitHub)
    const at = Math.floor(now.getTime() / 1000)
    expect(await refusal(verifyActionsToken(await token({ exp: at - 120 }), keySet, audience, now))).toBe('bad_token')
    expect(await refusal(verifyActionsToken(await token({ aud: 'https://hooks.example.com' }), keySet, audience, now))).toBe('bad_token')
    expect(await refusal(verifyActionsToken(await token({ iss: 'https://evil.example.com' }), keySet, audience, now))).toBe('bad_token')
    // Signed by a key GitHub never published, under the published key's id.
    expect(await refusal(verifyActionsToken(await token({ key: keys[1]?.privateKey }), keySet, audience, now))).toBe('bad_token')
    expect(await refusal(verifyActionsToken('not.a.token', keySet, audience, now))).toBe('bad_token')
  })

  it('refuses an unsigned token and an HMAC one, whatever the key set holds', async () => {
    served = [keys[0]?.jwk ?? {}]
    const keySet = actionsKeys(fakeGitHub)
    const body = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    const at = Math.floor(now.getTime() / 1000)
    const payload = body({ ...claims, iss: actionsIssuer, aud: audience, iat: at, exp: at + 60 })
    expect(await refusal(verifyActionsToken(`${body({ alg: 'none' })}.${payload}.`, keySet, audience, now))).toBe('bad_token')
    const hs = await new SignJWT({ ...claims }).setProtectedHeader({ alg: 'HS256', kid: 'k1' }).setIssuer(actionsIssuer).setAudience(audience).setIssuedAt(at).setExpirationTime(at + 60).sign(new TextEncoder().encode('x'.repeat(32)))
    expect(await refusal(verifyActionsToken(hs, keySet, audience, now))).toBe('bad_token')
  })

  it('refuses a token missing a claim the check needs', async () => {
    served = [keys[0]?.jwk ?? {}]
    expect(await refusal(verifyActionsToken(await token({ extra: { run_id: undefined } }), actionsKeys(fakeGitHub), audience, now))).toBe('bad_token')
    expect(await refusal(verifyActionsToken(await token({ extra: { repository_id: 4242 } }), actionsKeys(fakeGitHub), audience, now))).toBe('bad_token')
  })

  it('keeps the key set, and fetches it again only for a key id it doesn’t hold', async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] })
    served = [keys[0]?.jwk ?? {}]
    fetches = 0
    const keySet = actionsKeys(fakeGitHub)
    await verifyActionsToken(await token(), keySet, audience, now)
    await verifyActionsToken(await token(), keySet, audience, now)
    expect(fetches).toBe(1)
    // GitHub rotates: the new key is published, and a token under it makes one fetch once the cooldown is over.
    served = [keys[0]?.jwk ?? {}, keys[1]?.jwk ?? {}]
    vi.advanceTimersByTime(31_000)
    await verifyActionsToken(await token({ kid: 'k2' }), keySet, audience, now)
    expect(fetches).toBe(2)
  })

  it('says GitHub’s keys are unavailable, not that the token is bad, when they don’t arrive', async () => {
    const down = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch
    expect(await refusal(verifyActionsToken(await token(), actionsKeys(down), audience, now))).toBe('keys_unavailable')
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await refusal(verifyActionsToken(await token(), actionsKeys(offline), audience, now))).toBe('keys_unavailable')
  })
})

describe('acceptRun', () => {
  const store = { org: 'dripfunnel', repo: 'sf-abcdefghij', repoId: '4242' }
  const run: ActionsRun = { repositoryId: '4242', jobWorkflowRef: claims.job_workflow_ref, ref: 'refs/heads/main', eventName: 'workflow_dispatch', runId: '9001' }

  it('accepts the store’s own repo, its locked workflow on main, dispatched', () => {
    expect(acceptRun(run, store)).toBeNull()
    expect(acceptRun({ ...run, jobWorkflowRef: 'DripFunnel/SF-ABCDEFGHIJ/.github/workflows/build.yml@refs/heads/main' }, store)).toBeNull()
  })

  it('refuses another repo, even one with the store’s name', () => {
    expect(acceptRun({ ...run, repositoryId: '4243' }, store)).toBe('wrong_repo')
  })

  it('refuses another workflow file, and the locked file called from another repo', () => {
    expect(acceptRun({ ...run, jobWorkflowRef: 'dripfunnel/sf-abcdefghij/.github/workflows/other.yml@refs/heads/main' }, store)).toBe('wrong_workflow')
    expect(acceptRun({ ...run, jobWorkflowRef: 'attacker/tools/.github/workflows/build.yml@refs/heads/main' }, store)).toBe('wrong_workflow')
    expect(acceptRun({ ...run, jobWorkflowRef: 'no-ref-at-all' }, store)).toBe('wrong_workflow')
  })

  it('refuses another branch, by the workflow’s ref or the run’s', () => {
    expect(acceptRun({ ...run, jobWorkflowRef: 'dripfunnel/sf-abcdefghij/.github/workflows/build.yml@refs/heads/feature' }, store)).toBe('wrong_branch')
    expect(acceptRun({ ...run, ref: 'refs/heads/feature' }, store)).toBe('wrong_branch')
    expect(acceptRun({ ...run, ref: 'refs/tags/v1' }, store)).toBe('wrong_branch')
  })

  it('refuses a push and a pull request', () => {
    expect(acceptRun({ ...run, eventName: 'push' }, store)).toBe('wrong_event')
    expect(acceptRun({ ...run, eventName: 'pull_request_target' }, store)).toBe('wrong_event')
  })
})
