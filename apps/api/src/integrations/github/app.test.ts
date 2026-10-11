import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { localGitHub } from '../local/github'
import { appPermissions, createGitHubApp, GitHubRefused, GitHubUnavailable } from './app'
import { storeRepos } from './repos'

const keys = (type: 'pkcs1' | 'pkcs8') => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type, format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  return { privateKey: pair.privateKey, publicKey: pair.publicKey }
}

const verifyKeyOf = (pem: string) =>
  crypto.subtle.importKey('spki', createPublicKey(pem).export({ type: 'spki', format: 'der' }), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])

const setup = async (type: 'pkcs1' | 'pkcs8' = 'pkcs1') => {
  const { privateKey, publicKey } = keys(type)
  const github = localGitHub({ org: 'dripfunnel', installationId: '42', appId: '7', verifyKey: await verifyKeyOf(publicKey) })
  const waits: number[] = []
  const app = createGitHubApp({ appId: '7', installationId: '42', privateKey, fetchImpl: github.fetch, sleep: async (ms) => void waits.push(ms) })
  return { github, app, waits, privateKey }
}

describe('the GitHub App client', () => {
  it.each(['pkcs1', 'pkcs8'] as const)('signs its JWT from a %s key and asks for exactly the five permissions', async (type) => {
    const { github, app } = await setup(type)
    const repos = storeRepos(app.session(), 'dripfunnel')
    expect(await repos.create('sf-abcdefghij')).toEqual({ id: expect.any(Number) })
    expect(github.grants).toEqual([appPermissions])
    expect(appPermissions).toEqual({ administration: 'write', contents: 'write', workflows: 'write', actions: 'write', metadata: 'read' })
  })

  it('takes one installation token per session, never one for good', async () => {
    const { github, app } = await setup()
    const first = storeRepos(app.session(), 'dripfunnel')
    await first.create('sf-abcdefghij')
    await first.find('sf-abcdefghij')
    await storeRepos(app.session(), 'dripfunnel').find('sf-abcdefghij')
    expect(github.calls.filter((c) => c.endsWith('/access_tokens'))).toHaveLength(2)
  })

  it('retries an outage with growing waits, then gives up as unavailable', async () => {
    const { github, app, waits } = await setup()
    const repos = storeRepos(app.session(), 'dripfunnel')
    github.fail(/^POST \/orgs\/dripfunnel\/repos$/, 503, 2)
    await expect(repos.create('sf-abcdefghij')).resolves.toEqual({ id: expect.any(Number) })
    expect(waits).toEqual([500, 2000])
    github.fail(/^GET \/repos\//, 502, 3)
    await expect(repos.find('sf-abcdefghij')).rejects.toBeInstanceOf(GitHubUnavailable)
  })

  it('refuses a 4xx without retrying, and reads the ones the caller names', async () => {
    const { github, app, waits } = await setup()
    const repos = storeRepos(app.session(), 'dripfunnel')
    expect(await repos.find('sf-missingone')).toBeNull()
    github.fail(/^POST \/orgs\//, 403)
    await expect(repos.create('sf-abcdefghij')).rejects.toEqual(new GitHubRefused(403))
    expect(waits).toEqual([])
  })

  it('keeps no token or key in what it throws', async () => {
    const { github, app, privateKey } = await setup()
    const repos = storeRepos(app.session(), 'dripfunnel')
    await repos.create('sf-abcdefghij')
    github.fail(/./, 500, 3)
    const error = await repos.find('sf-abcdefghij').catch((e: unknown) => e)
    const text = JSON.stringify(error, Object.getOwnPropertyNames(error)) + String(error)
    expect(text).not.toMatch(/ghs_|BEGIN|Bearer|eyJ/)
    expect(text).not.toContain(privateKey.slice(40, 80))
  })

  it('creates a repo once: a create whose answer was lost finds the one it made', async () => {
    const { github, app } = await setup()
    const repos = storeRepos(app.session(), 'dripfunnel')
    const made = await repos.create('sf-abcdefghij')
    expect(await repos.create('sf-abcdefghij')).toEqual(made)
    expect(github.repos.size).toBe(1)
    expect(github.repos.get('sf-abcdefghij')?.private).toBe(false)
  })

  it('locks Actions: GitHub-owned actions only, a read-only token, every outside contributor approved first', async () => {
    const { github, app } = await setup()
    const repos = storeRepos(app.session(), 'dripfunnel')
    await repos.create('sf-abcdefghij')
    await repos.lockActions('sf-abcdefghij')
    expect(github.repos.get('sf-abcdefghij')?.settings).toEqual({
      '/actions/permissions': { enabled: true, allowed_actions: 'selected' },
      '/actions/permissions/selected-actions': { github_owned_allowed: true, verified_allowed: false, patterns_allowed: [] },
      '/actions/permissions/workflow': { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false },
      '/actions/permissions/fork-pr-contributor-approval': { approval_policy: 'all_external_contributors' },
    })
  })

  it('moves main only forward', async () => {
    const { app } = await setup()
    const repos = storeRepos(app.session(), 'dripfunnel')
    await repos.create('sf-abcdefghij')
    const first = (await repos.head('sf-abcdefghij')) ?? ''
    const tree = await repos.writeTree('sf-abcdefghij', await repos.treeOf('sf-abcdefghij', first), [{ path: 'a.txt', content: 'a' }])
    const next = await repos.commit('sf-abcdefghij', { tree, parent: first, message: 'One', at: new Date('2026-10-11T00:00:00Z') })
    const sibling = await repos.commit('sf-abcdefghij', { tree, parent: first, message: 'Two', at: new Date('2026-10-11T00:00:00Z') })
    expect(await repos.advance('sf-abcdefghij', next)).toBe(true)
    expect(await repos.advance('sf-abcdefghij', sibling)).toBe(false)
    expect(await repos.head('sf-abcdefghij')).toBe(next)
  })
})
