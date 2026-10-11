import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CallerContext } from '#core/tenancy'
import { withScope } from '#db/scoped/index'
import { createGitHubApp, GitHubUnavailable, storeRepos, type StoreRepos } from '#integrations/github/index'
import { localGitHub, type LocalGitHub } from '#integrations/local/github'
import { pushToRepo, type PushDeps } from '#saas/storefronts/index'
import { commitToMain } from '#saas/storefronts/push'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// INF 1 (#316): the push API against a fake GitHub (the App client's real requests, answered in memory) and the real
// database. One squashed commit per call, fast-forward only, never twice, never `.github`, never another store's repo.

let db: TestDatabase
let t: Tenants
let github: LocalGitHub
let deps: PushDeps
let clock = new Date('2026-10-11T09:00:00Z')
const repoOf = { A1: 'sf-a1a1a1a1a1', A2: 'sf-a2a2a2a2a2' }
const buildId = '0b8e4a52-5d7c-4c1e-9f3a-6f1d2e3c4b5a'

const theme = (words: string) => [
  { path: 'routes.json', content: '{"routes":{"home":"HomePage"}}' },
  { path: 'src/theme/pages/HomePage.tsx', content: `export const HomePage = () => null // ${words}` },
  { path: 'content/en/home.json', content: `{"title":"${words}"}` },
]

/** A store's repo as creation leaves it: the skeleton, a theme and the locked workflow on `main`, recorded as ready. */
const seedRepo = async (storeId: string, name: string, repos: StoreRepos) => {
  await repos.create(name)
  const first = (await repos.head(name)) ?? ''
  const tree = await repos.writeTree(name, null, [
    { path: 'package.json', content: '{"dependencies":{"@dripfunnel/storefront-core":"1.0.0"}}' },
    { path: '.github/workflows/build.yml', content: 'on: workflow_dispatch\n' },
    { path: 'src/theme/pages/OldPage.tsx', content: 'export const OldPage = () => null' },
    ...theme('first'),
  ])
  const head = await repos.commit(name, { tree, parent: first, message: 'Start from the bloom template', at: clock })
  await repos.advance(name, head)
  await db.sql`update storefront set repo = ${name}, repo_state = 'ready', repo_head = ${head} where store_id = ${storeId}`
  return head
}

const publish = (key: string, version = 2, files = theme(`v${version}`)) => ({ storeId: t.storeA1, key, reason: { kind: 'publish', version, buildId }, files })

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
})

afterAll(async () => {
  await db.drop()
})

beforeEach(async () => {
  github = localGitHub({ org: 'dripfunnel', installationId: '42', appId: '7' })
  const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey))))}\n-----END PRIVATE KEY-----`
  const app = createGitHubApp({ appId: '7', installationId: '42', privateKey: pem, fetchImpl: github.fetch, sleep: async () => undefined })
  clock = new Date(clock.getTime() + 60_000)
  deps = { sql: db.sql, repos: storeRepos(app.session(), 'dripfunnel'), now: () => clock }
  await db.sql`delete from storefront_push`
  await db.sql`update storefront set repo = null, repo_state = 'none', repo_head = null`
  await seedRepo(t.storeA1, repoOf.A1, deps.repos)
  await seedRepo(t.storeA2, repoOf.A2, deps.repos)
})

describe('the push API', () => {
  it('lands a publish as one commit on main, with the platform’s message, replacing the theme', async () => {
    const before = github.history(repoOf.A1).length
    const result = await pushToRepo(deps, publish('publish:2'))
    expect(result).toEqual({ ok: true, commit: expect.stringMatching(/^[0-9a-f]{40}$/) })
    const history = github.history(repoOf.A1)
    expect(history).toHaveLength(before + 1)
    expect(history[0]?.message).toBe(`Publish version 2\n\nBuild ${buildId}`)
    const files = github.files(repoOf.A1)
    expect(files?.get('src/theme/pages/HomePage.tsx')).toContain('v2')
    // The old theme's page went with it; the skeleton and the locked workflow stayed.
    expect(files?.has('src/theme/pages/OldPage.tsx')).toBe(false)
    expect(files?.get('.github/workflows/build.yml')).toBe('on: workflow_dispatch\n')
    expect(files?.has('package.json')).toBe(true)
    const [row] = await db.sql<{ repo_head: string }[]>`select repo_head from storefront where store_id = ${t.storeA1}`
    expect(row?.repo_head).toBe(result.ok ? result.commit : '')
  })

  it('never pushes twice for one key', async () => {
    const first = await pushToRepo(deps, publish('publish:2'))
    const commits = github.calls.filter((c) => c.endsWith('/git/commits')).length
    expect(await pushToRepo(deps, publish('publish:2'))).toEqual(first)
    expect(github.calls.filter((c) => c.endsWith('/git/commits'))).toHaveLength(commits)
    expect(github.history(repoOf.A1)[1]?.message).toBe('Start from the bloom template')
  })

  it('finishes, without a second commit, a push whose advance landed but whose answer was lost', async () => {
    const lost: StoreRepos = {
      ...deps.repos,
      advance: async (name, commit) => {
        await deps.repos.advance(name, commit)
        throw new GitHubUnavailable('GitHub did not answer')
      },
    }
    await expect(pushToRepo({ ...deps, repos: lost }, publish('publish:2'))).rejects.toBeInstanceOf(GitHubUnavailable)
    const [pending] = await db.sql<{ state: string }[]>`select state from storefront_push where key = 'publish:2'`
    expect(pending?.state).toBe('pending')
    clock = new Date(clock.getTime() + 60_000)
    const retried = await pushToRepo(deps, publish('publish:2'))
    expect(retried).toEqual({ ok: true, commit: github.repos.get(repoOf.A1)?.main })
    expect(github.history(repoOf.A1).filter((c) => c.message.startsWith('Publish version 2'))).toHaveLength(1)
  })

  it('finishes a push whose advance landed even after main moved on, never pushing it a second time', async () => {
    const lost: StoreRepos = {
      ...deps.repos,
      advance: async (name, commit) => {
        await deps.repos.advance(name, commit)
        throw new GitHubUnavailable('GitHub did not answer')
      },
    }
    await expect(pushToRepo({ ...deps, repos: lost }, publish('publish:2'))).rejects.toBeInstanceOf(GitHubUnavailable)
    const landed = github.repos.get(repoOf.A1)?.main ?? ''
    const tree = await deps.repos.writeTree(repoOf.A1, await deps.repos.treeOf(repoOf.A1, landed), [{ path: 'README.md', content: 'edited on GitHub' }])
    const later = await deps.repos.commit(repoOf.A1, { tree, parent: landed, message: 'Someone else', at: clock })
    await deps.repos.advance(repoOf.A1, later)

    expect(await pushToRepo(deps, publish('publish:2'))).toEqual({ ok: true, commit: landed })
    expect(github.history(repoOf.A1).filter((c) => c.message.startsWith('Publish version 2'))).toHaveLength(1)
    const [row] = await db.sql<{ state: string }[]>`select state from storefront_push where key = 'publish:2'`
    expect(row?.state).toBe('done')
    // main moved past what the platform pushed, so the next push is refused rather than built on someone else's commit.
    expect(await pushToRepo(deps, publish('publish:3', 3))).toEqual({ ok: false, code: 'MAIN_MOVED' })
  })

  it('retries a GitHub outage, and a push that gave up makes the same commit when tried again', async () => {
    github.fail(/^POST .*\/git\/commits$/, 503, 2)
    expect((await pushToRepo(deps, publish('publish:2'))).ok).toBe(true)
    github.fail(/^POST .*\/git\/trees$/, 503, 3)
    await expect(pushToRepo(deps, publish('publish:3', 3))).rejects.toBeInstanceOf(GitHubUnavailable)
    expect((await pushToRepo(deps, publish('publish:3', 3))).ok).toBe(true)
    expect(github.history(repoOf.A1).map((c) => c.message.split('\n')[0]).slice(0, 3)).toEqual(['Publish version 3', 'Publish version 2', 'Start from the bloom template'])
  })

  it('refuses when main moved, leaving main and the record as they were', async () => {
    const elsewhere = github.repos.get(repoOf.A1)?.main ?? ''
    const tree = await deps.repos.writeTree(repoOf.A1, await deps.repos.treeOf(repoOf.A1, elsewhere), [{ path: 'README.md', content: 'edited on GitHub' }])
    const moved = await deps.repos.commit(repoOf.A1, { tree, parent: elsewhere, message: 'Someone else', at: clock })
    await deps.repos.advance(repoOf.A1, moved)
    expect(await pushToRepo(deps, publish('publish:2'))).toEqual({ ok: false, code: 'MAIN_MOVED' })
    expect(github.repos.get(repoOf.A1)?.main).toBe(moved)
    expect(await db.sql`select 1 from storefront_push where key = 'publish:2'`).toHaveLength(0)
    const [row] = await db.sql<{ repo_head: string }[]>`select repo_head from storefront where store_id = ${t.storeA1}`
    expect(row?.repo_head).toBe(elsewhere)
  })

  it('refuses a theme push outside ARCHITECTURE §3.4’s paths, and any push touching .github', async () => {
    github.calls.length = 0
    const outside = [...theme('x'), { path: 'package.json', content: '{}' }]
    expect(await pushToRepo(deps, publish('a', 2, outside))).toEqual({ ok: false, code: 'PATH_NOT_ALLOWED' })
    expect(await pushToRepo(deps, publish('b', 2, [...theme('x'), { path: '.github/workflows/build.yml', content: 'on: push' }]))).toEqual({ ok: false, code: 'PATH_NOT_ALLOWED' })
    expect(await pushToRepo(deps, publish('c', 2, [...theme('x'), { path: 'src/theme/../store.config.ts', content: '' }]))).toEqual({ ok: false, code: 'INVALID' })
    const upgrade = (files: { path: string; content: string }[], removed: string[] = []) => ({ storeId: t.storeA1, key: 'u', reason: { kind: 'upgrade', coreVersion: '1.1.0' }, files, removed })
    expect(await pushToRepo(deps, upgrade([{ path: '.GitHub/workflows/x.yml', content: '' }]))).toEqual({ ok: false, code: 'PATH_NOT_ALLOWED' })
    expect(await pushToRepo(deps, upgrade([], ['.github/workflows/build.yml']))).toEqual({ ok: false, code: 'PATH_NOT_ALLOWED' })
    // A merchant's words never reach the message: the reason is the platform's, and nothing else is accepted.
    expect(await pushToRepo(deps, { ...publish('d'), reason: { kind: 'publish', version: 2, buildId, label: 'Make it pink' } })).toEqual({ ok: false, code: 'INVALID' })
    expect(github.calls.filter((c) => c.startsWith('POST'))).not.toContainEqual(expect.stringMatching(/git\/commits$/))
  })

  it('lets the upgrade bot change the pin and keep the theme', async () => {
    const result = await pushToRepo(deps, { storeId: t.storeA1, key: 'upgrade:1.1.0', reason: { kind: 'upgrade', coreVersion: '1.1.0' }, files: [{ path: 'package.json', content: '{"dependencies":{"@dripfunnel/storefront-core":"1.1.0"}}' }] })
    expect(result.ok).toBe(true)
    const files = github.files(repoOf.A1)
    expect(files?.get('package.json')).toContain('1.1.0')
    expect(files?.has('src/theme/pages/OldPage.tsx')).toBe(true)
    expect(github.history(repoOf.A1)[0]?.message).toBe('Upgrade storefront-core to 1.1.0')
  })

  it('touches only the store’s own repo, and refuses a store without one', async () => {
    const a2Main = github.repos.get(repoOf.A2)?.main
    github.calls.length = 0
    await pushToRepo(deps, publish('publish:2'))
    expect(github.calls.filter((c) => c.includes('/repos/'))).not.toContainEqual(expect.stringContaining(repoOf.A2))
    expect(github.repos.get(repoOf.A2)?.main).toBe(a2Main)
    expect(await pushToRepo(deps, { ...publish('publish:2'), storeId: t.storeB1 })).toEqual({ ok: false, code: 'NOT_READY' })
    await db.sql`update storefront set repo_state = 'creating' where store_id = ${t.storeA2}`
    expect(await pushToRepo(deps, { ...publish('publish:2'), storeId: t.storeA2 })).toEqual({ ok: false, code: 'NOT_READY' })
  })

  it('lets a platform commit through while the repo is still being created', async () => {
    await db.sql`update storefront set repo_state = 'creating' where store_id = ${t.storeA1}`
    const result = await commitToMain(deps, t.storeA1, 'config', 'Store settings', ['creating'], async () => ({ replace: false, changes: [{ path: 'store.config.ts', content: 'export {}' }] }))
    expect(result.ok).toBe(true)
    expect(github.files(repoOf.A1)?.get('store.config.ts')).toBe('export {}')
  })

  it('keeps no token in any row, and the push log from every request role', async () => {
    await pushToRepo(deps, publish('publish:2'))
    const rows = await db.sql`select * from storefront_push`
    const stores = await db.sql`select * from storefront`
    expect(JSON.stringify([rows, stores])).not.toMatch(/ghs_|Bearer|PRIVATE KEY/)
    const caller: CallerContext = { caller: { kind: 'person', userId: '00000000-0000-4000-8000-0000000000aa', sessionId: 's' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' }
    await expect(withScope(db.sql, caller, (tx) => tx`select key from storefront_push`)).rejects.toThrow(/permission denied/i)
  })
})
