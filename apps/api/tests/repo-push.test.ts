import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { handleGitHubHook } from '#hooks/github'
import { storefrontRepoPushDeliverer } from '#jobs/queues/deliverers/storefrontRepoPush'
import { createGitHubApp, storeRepos, type StoreRepos } from '#integrations/github/index'
import { localGitHub, type LocalGitHub } from '#integrations/local/github'
import { NotYet } from '#saas/outbox/index'
import {
  digestOf,
  dispatchBuild,
  FreezeRefused,
  freezeBuild,
  handleRepoPush,
  runPublish,
  sameWorkflow,
  startPublish,
  storefrontRepoPushKind,
  type PublishDeps,
  type RepoPush,
} from '#saas/storefronts/index'
import { sourceBundle, stagingFolder } from '#saas/storefronts/layout'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { testProbe, type TestProbe } from './support/edgeProbe'
import { fakeSites, putText, type FakeSites } from './support/sites'

// #968: a push to a store repo's `main` builds that commit and puts it live as a `repo` publish (storefront LIVE-SHOP.md
// §4), unless the platform pushed it or it changed `.github/**`; later catalogue publishes build it.

let db: TestDatabase
let t: Tenants
let github: LocalGitHub
let repos: StoreRepos
let sites: FakeSites
let assets: FakeSites
let drafts: FakeSites
let probe: TestProbe
const repoA1 = 'sf-pushpush01'
const repoA2 = 'sf-pushpush02'
const repoIds: Record<string, string> = {}
const fetched: string[] = []
const secret = 'a-webhook-secret-of-some-length'

const steps = {
  do: (_: string, work: () => Promise<string>) => work(),
  waitFor: async () => {
    throw new Error('waitForEvent timed out')
  },
}
const deps = (): PublishDeps => ({
  sql: db.sql,
  sites,
  assets,
  drafts,
  assetOrigin: null,
  shopDomain: 'shop.example',
  mapsFrameOrigin: null,
  dispatch: async () => true,
  fetchSource: async (repo, commit) => (fetched.push(`${repo}@${commit}`), new TextEncoder().encode(`bundle of ${commit}`).buffer),
  workflowIntact: async (repo, known) => sameWorkflow(repos, repo, known, (await repos.head(repo)) ?? ''),
  now: () => new Date(),
  probe,
  assetHost: 'sf-assets.my-store.one',
  wait: async () => undefined,
})
const pushDeps = () => ({ sql: db.sql, repos, now: () => new Date() })

/** A commit on `main` as a person's push leaves it: `changes` over the head's files. */
const push = async (repo: string, changes: { path: string; content: string | null }[]) => {
  const head = (await repos.head(repo)) ?? ''
  const tree = await repos.writeTree(repo, await repos.treeOf(repo, head), changes)
  const commit = await repos.commit(repo, { tree, parent: head, message: 'A hand edit', at: new Date() })
  await repos.advance(repo, commit)
  return commit
}
const pushed = (repo: string, commit: string, pusher = 'dev-one'): RepoPush => ({ repoId: repoIds[repo] ?? '', commit, pusher })
const banner = (words: string) => [{ path: 'src/theme/components/Banner.tsx', content: `export const Banner = () => <p>${words}</p>\n` }]

const repoHead = async (storeId: string) => (await db.sql<{ repo_head: string }[]>`select repo_head from storefront where store_id = ${storeId}`)[0]?.repo_head
const live = async (storeId: string) => (await db.sql<{ live_build_id: string | null }[]>`select live_build_id from storefront where store_id = ${storeId}`)[0]?.live_build_id ?? null
const runs = (storeId: string) => db.sql<{ id: string; kind: string; state: string; commit: string; uses_allowance: boolean }[]>`select id, kind, state, commit, uses_allowance from publish_run where store_id = ${storeId} order by created_at`
const entries = (storeId: string) =>
  db.sql<{ result: string; reason: string | null; actor_kind: string; actor_label: string; visibility: string }[]>`select result, reason, actor_kind, actor_label, visibility from activity_log where store_id = ${storeId} and action = 'storefront.repo_publish' order by occurred_at`
/** A run's passing report and upload, as the build calls leave them. */
const uploaded = async (storeId: string, runId: string) => {
  const html = `<p>${runId}</p>`
  const files = await Promise.all(['index.html', 'checkout/index.html'].map(async (path) => ({ path, sha256: await putText(sites, `${stagingFolder(storeId, runId)}${path}`, html), size: html.length })))
  await db.sql`
    update publish_run set state = 'deploying', started_at = now(), gate = ${db.sql.json({ passed: true, checks: [] })}, gate_digest = ${await digestOf(files)},
      uploaded_at = now(), upload_manifest = ${db.sql.json({ files })} where id = ${runId}`
}
const goLive = async (storeId: string, runId: string) => {
  await uploaded(storeId, runId)
  expect(await runPublish(deps(), { runId, storeId }, steps)).toBe('live')
}
/** A store's first live build, of its repo's head, as the merchant's first Publish leaves it. */
const firstPublish = async (storeId: string, repo: string) => {
  const head = (await repos.head(repo)) ?? ''
  const started = await withSystemScope(db.sql, (tx) =>
    startPublish(tx, { storeId, kind: 'manual', commit: head, template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() }),
  )
  await goLive(storeId, started.ok ? started.runId : '')
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set status = 'active' where id in (${t.storeA1}, ${t.storeA2})`
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  github = localGitHub({ org: 'dripfunnel', installationId: '42', appId: '7' })
  const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey))))}\n-----END PRIVATE KEY-----`
  repos = storeRepos(createGitHubApp({ appId: '7', installationId: '42', privateKey: pem, fetchImpl: github.fetch, sleep: async () => undefined }).session(), 'dripfunnel')
  for (const [storeId, repo] of [
    [t.storeA1, repoA1],
    [t.storeA2, repoA2],
  ] as const) {
    const { id } = await repos.create(repo)
    repoIds[repo] = String(id)
    const first = (await repos.head(repo)) ?? ''
    const tree = await repos.writeTree(repo, null, [{ path: 'package.json', content: '{"name":"store"}\n' }, { path: '.github/workflows/build.yml', content: 'on: workflow_dispatch\n' }, ...banner('Welcome')])
    const main = await repos.commit(repo, { tree, parent: first, message: 'Start from the linen template', at: new Date() })
    await repos.advance(repo, main)
    await db.sql`update storefront set repo = ${repo}, repo_id = ${id}, repo_state = 'ready', repo_head = ${main}, template = 'linen' where store_id = ${storeId}`
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(() => {
  sites = fakeSites()
  assets = fakeSites()
  drafts = fakeSites()
  probe = testProbe(db.sql, { sites, assets })
})

describe('a push to main', () => {
  it('waits for the store’s first Publish: before it, a push builds nothing', async () => {
    const commit = await push(repoA1, banner('Too early'))
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, commit))).toBe('not_live')
    expect(await runs(t.storeA1)).toEqual([])
    await db.sql`update storefront set repo_head = ${commit} where store_id = ${t.storeA1}`
    await firstPublish(t.storeA1, repoA1)
    await firstPublish(t.storeA2, repoA2)
  })

  it('builds the pushed commit from GitHub and puts it live; repo_head and the private copy become it, with no press used', async () => {
    const before = await live(t.storeA1)
    const commit = await push(repoA1, banner('Spring sale'))
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, commit))).toBe('started')
    const run = (await runs(t.storeA1)).at(-1)
    expect(run).toMatchObject({ kind: 'repo', state: 'queued', commit, uses_allowance: false })
    expect(await freezeBuild(deps(), t.storeA1, run?.id ?? '')).toBe('frozen')
    expect(fetched).toContain(`${repoA1}@${commit}`)
    expect(await (await drafts.get(sourceBundle(t.storeA1, run?.id ?? '')))?.text()).toBe(`bundle of ${commit}`)
    await goLive(t.storeA1, run?.id ?? '')
    expect(await live(t.storeA1)).not.toBe(before)
    expect(await live(t.storeA1)).toBe(run?.id)
    expect(await repoHead(t.storeA1)).toBe(commit)
    // Nothing is pushed back: main already has it.
    expect(github.history(repoA1)[0]?.message).toBe('A hand edit')
    expect((await entries(t.storeA1)).at(-1)).toEqual({ result: 'success', reason: null, actor_kind: 'provider', actor_label: 'dev-one on GitHub', visibility: 'partner' })
  })

  it('starts nothing for the platform’s own commits: main as it knows it, or one it pushed', async () => {
    const count = (await runs(t.storeA1)).length
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, (await repoHead(t.storeA1)) ?? ''))).toBe('own_commit')
    const own = await push(repoA1, banner('Publish version 3'))
    await db.sql`insert into storefront_push (store_id, key, parent_sha, commit_sha, state) values (${t.storeA1}, 'publish:own', ${(await repoHead(t.storeA1)) ?? ''}, ${own}, 'pending')`
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, own))).toBe('own_commit')
    expect(await runs(t.storeA1)).toHaveLength(count)
    await db.sql`update storefront set repo_head = ${own} where store_id = ${t.storeA1}`
  })

  it('refuses a push that changed .github/**, with a security entry, and keeps the live build', async () => {
    const before = await live(t.storeA1)
    const count = (await runs(t.storeA1)).length
    const commit = await push(repoA1, [{ path: '.github/workflows/build.yml', content: 'on: push\n' }])
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, commit))).toBe('workflow_changed')
    expect(await runs(t.storeA1)).toHaveLength(count)
    expect(await live(t.storeA1)).toBe(before)
    expect((await entries(t.storeA1)).at(-1)).toMatchObject({ result: 'denied', reason: 'workflow_changed', visibility: 'staff' })
    // Any later build would run main's workflow, so none is dispatched while it differs.
    const head = (await repoHead(t.storeA1)) ?? ''
    const press = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeA1, kind: 'manual', commit: head, template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() }),
    )
    const pressId = press.ok ? press.runId : ''
    await expect(dispatchBuild(deps(), t.storeA1, pressId)).rejects.toThrow(new FreezeRefused('workflow_changed'))
    // Put back, as a person would: builds are dispatched again.
    await push(repoA1, [{ path: '.github/workflows/build.yml', content: 'on: workflow_dispatch\n' }])
    expect(await dispatchBuild(deps(), t.storeA1, pressId)).toBe('dispatched')
    await db.sql`update publish_run set state = 'failed', error = 'deploy_failed' where id = ${pressId}`
  })

  it('builds only main’s own head: a push delivered after a newer one starts nothing', async () => {
    const older = await push(repoA1, banner('Older'))
    const newer = await push(repoA1, banner('Newer'))
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, older))).toBe('stale')
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, newer))).toBe('started')
    expect((await runs(t.storeA1)).at(-1)).toMatchObject({ kind: 'repo', commit: newer })
    await db.sql`update publish_run set state = 'failed', error = 'deploy_failed' where store_id = ${t.storeA1} and state = 'queued'`
  })

  it('waits behind the studio’s or the bot’s waiting run: the delivery is tried again later, nothing recorded', async () => {
    const head = (await repoHead(t.storeA1)) ?? ''
    const running = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeA1, kind: 'automatic', commit: head, template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() }),
    )
    await db.sql`update publish_run set state = 'building', started_at = now() where id = ${running.ok ? running.runId : ''}`
    await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeA1, kind: 'design', commit: 'd'.repeat(40), template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() }),
    )
    const entriesBefore = (await entries(t.storeA1)).length
    const commit = await push(repoA1, banner('Behind the studio'))
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, commit))).toBe('busy')
    const deliverer = storefrontRepoPushDeliverer(db.sql, repos)
    const effect = { id: 'e', kind: storefrontRepoPushKind, idempotencyKey: 'k', payload: pushed(repoA1, commit), partnerId: null, storeId: t.storeA1, attempt: 1 }
    await expect(deliverer.deliver(effect, new AbortController().signal)).rejects.toBeInstanceOf(NotYet)
    expect(await entries(t.storeA1)).toHaveLength(entriesBefore)
    expect((await runs(t.storeA1)).at(-1)).toMatchObject({ kind: 'design' })
    await db.sql`update publish_run set state = 'failed', error = 'deploy_failed' where store_id = ${t.storeA1} and state in ('building', 'queued')`
  })

  it('queues a second push behind a running build, and a third takes its place; a redelivery starts nothing', async () => {
    const first = await push(repoA1, banner('One'))
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, first))).toBe('started')
    const running = (await runs(t.storeA1)).at(-1)?.id ?? ''
    await db.sql`update publish_run set state = 'building', started_at = now() where id = ${running}`
    const second = await push(repoA1, banner('Two'))
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, second))).toBe('started')
    const waiting = (await runs(t.storeA1)).at(-1)
    expect(waiting).toMatchObject({ kind: 'repo', state: 'queued', commit: second })
    const third = await push(repoA1, banner('Three'))
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, third))).toBe('merged')
    expect((await runs(t.storeA1)).at(-1)).toMatchObject({ id: waiting?.id, commit: third })
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, third))).toBe('duplicate')
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, first))).toBe('stale')
    await db.sql`update publish_run set state = 'failed', error = 'deploy_failed' where store_id = ${t.storeA1} and state in ('building', 'queued')`
  })

  it('takes over a waiting catalogue publish, which would otherwise build the old code', async () => {
    const head = (await repoHead(t.storeA1)) ?? ''
    const running = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeA1, kind: 'automatic', commit: head, template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() }),
    )
    await db.sql`update publish_run set state = 'building', started_at = now() where id = ${running.ok ? running.runId : ''}`
    const press = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeA1, kind: 'manual', commit: 'a'.repeat(40), template: 'linen', coreVersion: '1.0.0', usesAllowance: true, startedBy: { kind: 'system', id: null }, at: new Date() }),
    )
    const commit = await push(repoA1, banner('Four'))
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, commit))).toBe('merged')
    expect((await runs(t.storeA1)).at(-1)).toMatchObject({ id: press.ok ? press.runId : '', kind: 'repo', commit, uses_allowance: false })
    await db.sql`update publish_run set state = 'failed', error = 'deploy_failed' where store_id = ${t.storeA1} and state in ('building', 'queued')`
  })

  it('keeps the live site and repo_head when the pushed build fails', async () => {
    const before = await live(t.storeA1)
    const head = await repoHead(t.storeA1)
    const commit = await push(repoA1, banner('Broken'))
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, commit))).toBe('started')
    const runId = (await runs(t.storeA1)).at(-1)?.id ?? ''
    // A passing report whose files never arrived, as a build that broke after its checks.
    await db.sql`update publish_run set state = 'deploying', started_at = now(), gate = ${db.sql.json({ passed: true, checks: [] })}, gate_digest = ${'d'.repeat(64)} where id = ${runId}`
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, steps)).toBe('failed')
    expect(await live(t.storeA1)).toBe(before)
    expect(await repoHead(t.storeA1)).toBe(head)
  })

  it('has a catalogue publish queued behind a push build the pushed commit once it is live', async () => {
    const commit = await push(repoA1, banner('Five'))
    expect(await handleRepoPush(pushDeps(), pushed(repoA1, commit))).toBe('started')
    const pushRun = (await runs(t.storeA1)).at(-1)?.id ?? ''
    await db.sql`update publish_run set state = 'building', started_at = now() where id = ${pushRun}`
    // "Publish now" during the build names the live commit as it then was.
    const press = await withSystemScope(db.sql, async (tx) => {
      const [old] = await tx<{ commit: string }[]>`select r.commit from publish_run r join storefront f on f.live_build_id = r.id where f.store_id = ${t.storeA1}`
      return startPublish(tx, { storeId: t.storeA1, kind: 'manual', commit: old?.commit ?? '', template: 'linen', coreVersion: '1.0.0', usesAllowance: true, startedBy: { kind: 'system', id: null }, at: new Date() })
    })
    const pressId = press.ok ? press.runId : ''
    expect((await runs(t.storeA1)).find((r) => r.id === pressId)?.commit).not.toBe(commit)
    await goLive(t.storeA1, pushRun)
    // Only the claim: the build itself is the same as any publish's.
    const claimOnly = {
      do: async (name: string, work: () => Promise<string>) => {
        if (name !== 'claim') throw new Error('stopped after the claim')
        return work()
      },
      waitFor: async () => undefined,
    }
    await expect(runPublish(deps(), { runId: pressId, storeId: t.storeA1 }, claimOnly)).rejects.toThrow('stopped after the claim')
    expect((await runs(t.storeA1)).find((r) => r.id === pressId)).toMatchObject({ kind: 'manual', state: 'building', commit })
    await db.sql`update publish_run set state = 'failed', error = 'deploy_failed' where id = ${pressId}`
  })
})

describe('isolation', () => {
  it('starts a push only on the store whose repo GitHub named; an unknown repo starts nothing', async () => {
    const a1 = (await runs(t.storeA1)).length
    const commit = await push(repoA2, banner('Other store'))
    expect(await handleRepoPush(pushDeps(), pushed(repoA2, commit))).toBe('started')
    expect((await runs(t.storeA2)).at(-1)).toMatchObject({ kind: 'repo', commit })
    expect(await runs(t.storeA1)).toHaveLength(a1)
    expect(await handleRepoPush(pushDeps(), { repoId: '999999', commit, pusher: 'stranger' })).toBe('unknown_repo')
    // Another store's commit named under this store's repo id is a commit GitHub doesn't have there.
    await expect(handleRepoPush(pushDeps(), pushed(repoA1, commit))).rejects.toThrow()
    expect(await runs(t.storeA1)).toHaveLength(a1)
  })
})

describe('the GitHub webhook', () => {
  const hookDeps = () => ({ sql: db.sql, secret, org: 'dripfunnel' })
  const queued = (storeId: string) => db.sql<{ payload: RepoPush }[]>`select payload from outbox where kind = ${storefrontRepoPushKind} and store_id = ${storeId} order by created_at`
  const sign = async (body: string, key = secret) => {
    const hmac = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(body)))
    return `sha256=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`
  }
  const deliver = async (payload: unknown, o: { event?: string; key?: string } = {}) => {
    const body = JSON.stringify(payload)
    return handleGitHubHook(
      new Request('https://hooks.dripfunnel.ai/github', { method: 'POST', body, headers: { 'x-github-event': o.event ?? 'push', 'x-hub-signature-256': await sign(body, o.key) } }),
      hookDeps(),
    )
  }
  const event = (commit: string, o: { ref?: string; owner?: string; deleted?: boolean } = {}) => ({
    ref: o.ref ?? 'refs/heads/main',
    after: commit,
    deleted: o.deleted ?? false,
    repository: { id: Number(repoIds[repoA2]), owner: { login: o.owner ?? 'dripfunnel' } },
    sender: { login: 'dev-two' },
  })

  it('refuses a body not signed with the App’s secret, another method, or one too large, and queues nothing', async () => {
    const commit = await push(repoA2, banner('Unsigned'))
    expect((await deliver(event(commit), { key: 'another-secret-entirely-here' })).status).toBe(401)
    const url = 'https://hooks.dripfunnel.ai/github'
    expect((await handleGitHubHook(new Request(url), hookDeps())).status).toBe(405)
    expect((await handleGitHubHook(new Request(url, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) }), hookDeps())).status).toBe(413)
    expect(await queued(t.storeA2)).toEqual([])
  })

  it('answers but ignores other events, other branches, deleted branches, other organisations and unknown repos', async () => {
    const commit = await push(repoA2, banner('Ignored'))
    for (const response of [
      await deliver(event(commit), { event: 'ping' }),
      await deliver(event(commit, { ref: 'refs/heads/feature' })),
      await deliver(event(commit, { deleted: true })),
      await deliver(event(commit, { owner: 'someone-else' })),
      await deliver({ ...event(commit), repository: { id: 999_999, owner: { login: 'dripfunnel' } } }),
    ])
      expect(response.status).toBe(200)
    expect(await queued(t.storeA2)).toEqual([])
  })

  it('queues a signed push to main once, and its delivery starts the repo publish naming the pusher', async () => {
    await db.sql`update publish_run set state = 'failed', error = 'deploy_failed' where store_id = ${t.storeA2} and state in ('building', 'queued')`
    const commit = await push(repoA2, banner('Signed'))
    expect((await deliver(event(commit))).status).toBe(200)
    expect((await deliver(event(commit))).status).toBe(200)
    const rows = await queued(t.storeA2)
    expect(rows.map((r) => r.payload)).toEqual([{ repoId: repoIds[repoA2], commit, pusher: 'dev-two' }])
    const effect = { id: 'e', kind: storefrontRepoPushKind, idempotencyKey: 'k', payload: rows[0]?.payload, partnerId: null, storeId: t.storeA2, attempt: 1 }
    await storefrontRepoPushDeliverer(db.sql, repos).deliver(effect, new AbortController().signal)
    expect((await runs(t.storeA2)).at(-1)).toMatchObject({ kind: 'repo', state: 'queued', commit })
    expect((await entries(t.storeA2)).at(-1)).toMatchObject({ result: 'success', actor_label: 'dev-two on GitHub' })
  })
})
