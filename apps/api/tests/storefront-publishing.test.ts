import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { recordGate } from '#db/scoped/builds'
import { withSystemScope } from '#db/scoped/index'
import { createGitHubApp, storeRepos, type StoreRepos } from '#integrations/github/index'
import type { AiAnswer, AiProvider } from '#integrations/ai/index'
import { localGitHub, type LocalGitHub } from '#integrations/local/github'
import { designModel, repairBrief } from '#saas/ai-designer/index'
import { digestOf, pushToRepo, runPublish, type PublishDeps, type PublishRepair, type PublishSteps } from '#saas/storefronts/index'
import { stagingFolder } from '#saas/storefronts/layout'
import { StudioRunner, type DraftsBucket } from '#saas/studio/index'
import { testProbe } from './support/edgeProbe'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { sandboxProcess, type SandboxProcess } from './support/sandboxProcess'
import { fakeSites, putText, type FakeSites } from './support/sites'
import { seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'
import { localStudio } from './support/studio'

// Card #318 (SAPI 17), part 3: publishing from the studio (storefront AI-STUDIO §6; SAAS §9.1–§9.2) end to end: a fake
// model, the real sandbox, the real database, the publish pipeline played step by step, and the GitHub App's real client
// answered in memory; R2 is in memory.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 })

const core = '0.4.0'
const baselineDir = fileURLToPath(new URL('../../../packages/storefront-core/src/guard/fixtures/baseline/', import.meta.url))
let clock = Date.parse('2026-10-12T09:00:00.000Z')
const now = () => new Date((clock += 1000))
const repo = 'sf-pubpubpub1'

const walk = async (dir: string, prefix = ''): Promise<{ path: string; content: string }[]> =>
  (
    await Promise.all(
      (await readdir(join(dir, prefix))).map(async (name) => {
        const rel = prefix ? `${prefix}/${name}` : name
        return (await stat(join(dir, rel))).isDirectory() ? walk(dir, rel) : [{ path: rel, content: await readFile(join(dir, rel), 'utf8') }]
      }),
    )
  ).flat()
const hex = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')

let db: TestDatabase
let t: Tenants
let w: StoreWorld
let sites: FakeSites
let assets: FakeSites
let drafts: FakeSites
let host: SandboxProcess
let github: LocalGitHub
let repos: StoreRepos
let template: { path: string; content: string }[]
const dispatched: string[] = []

/** The runner's view of the drafts bucket: the same objects the publish pipeline reads. */
const draftsBucket = (): DraftsBucket => ({
  get: (key) => drafts.get(key),
  put: async (key, value) => drafts.put(key, value, { sha256: await hex(value) }),
  delete: (key) => drafts.delete([key]),
})
const runners = new Map<string, StudioRunner>()
const runnerOf = (storeId: string): StudioRunner => {
  const found = runners.get(storeId)
  if (found) return found
  const runner = new StudioRunner({
    db: (work) => work(db.sql),
    storeId,
    host: async () => host,
    drafts: draftsBucket(),
    sites,
    capacity: { acquire: async () => ({ granted: true }), release: async () => undefined },
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    onBundle: () => undefined,
  })
  runners.set(storeId, runner)
  return runner
}
const local = localStudio(() => db.sql, runnerOf)

const answers: string[] = []
const provider: AiProvider = {
  complete: async (): Promise<AiAnswer> => ({ text: answers.shift() ?? JSON.stringify({ files: [], reply: '', changed: [], page: null }), model: 'fake-model', tokensIn: 500, tokensOut: 100, costAmount: 1, costCurrency: 'USD' }),
}
const enPages = () => template.find((f) => f.path === 'content/en/pages.json')?.content ?? ''
const lead = (words: string) => JSON.stringify({ files: [{ path: 'content/en/pages.json', content: enPages().replace(/"lead": "[^"]*"/, `"lead": "${words}"`) }], reply: 'Done.', changed: ['Lead'], page: 'home' })

const ask = async (text: string, answer: string) => {
  answers.push(answer)
  const asked = await w.gql('owner', 'mutation A($t: String!) { askDesign(text: $t, page: "home", device: "desktop") { outcome message { id } } }', { t: text })
  return asked.data?.['askDesign'] as { outcome: string; message: { id: string } }
}
const head = async () => (await db.sql<{ head_commit: string }[]>`select head_commit from design_draft where store_id = ${t.storeA1}`)[0]?.head_commit ?? null
const liveBuild = async () => (await db.sql<{ live_build_id: string | null }[]>`select live_build_id from storefront where store_id = ${t.storeA1}`)[0]?.live_build_id ?? null
const leadNow = async () => ((await w.gql('owner', '{ designText(page: "home", locale: "en-IN") { key text } }')).data?.['designText'] as { key: string; text: string }[]).find((e) => e.key === 'pages:home.lead')?.text

const deps = (repair?: PublishRepair): PublishDeps => ({
  sql: db.sql,
  sites,
  assets,
  drafts,
  assetOrigin: null, shopDomain: 'shop.example',
  dispatch: async (_repo, buildId) => {
    dispatched.push(buildId)
    return true
  },
  now: () => new Date(),
  probe: testProbe(db.sql, { sites, assets }),
  assetHost: 'sf-assets.my-store.one',
  wait: async () => undefined,
  push: (input) => pushToRepo({ sql: db.sql, repos, now: () => new Date() }, { storeId: input.storeId, key: `publish:${input.buildId}`, reason: { kind: 'publish', version: input.version, buildId: input.buildId }, files: input.files }),
  ...(repair ? { repair } : {}),
})

/** The store repo's workflow, played by the test: a build of a commit in `bad` fails its report; any other passes and uploads. */
const workflow = (bad: ReadonlySet<string>): PublishSteps => ({
  do: (_: string, work: () => Promise<string>) => work(),
  waitFor: async (_: string, event: string) => {
    const id = dispatched.at(-1) ?? ''
    const [build] = await db.sql<{ commit: string; store_id: string }[]>`select commit, store_id from publish_run where id = ${id}`
    if (!build) throw new Error('nothing was dispatched')
    if (event === 'reported') {
      const passed = !bad.has(build.commit)
      await withSystemScope(db.sql, (tx) => recordGate(tx, { buildId: id, gate: { passed, checks: [{ name: 'axe', passed, detail: passed ? undefined : 'The home page breaks accessibility rules: image-alt.' }] }, digest: 'd'.repeat(64), passed, at: new Date() }))
      return
    }
    const html = `<h1>${id}</h1>`
    const files = await Promise.all(['index.html', 'checkout/index.html'].map(async (path) => ({ path, sha256: await putText(sites, `${stagingFolder(build.store_id, id)}${path}`, html), size: html.length })))
    await db.sql`update publish_run set gate_digest = ${await digestOf(files)}, uploaded_at = now(), upload_manifest = ${db.sql.json({ files })} where id = ${id}`
  },
})

const publish = async (who: Who = 'owner') => (await w.gql(who, 'mutation { publishDesign }')) as { data: { publishDesign: string } | null; code: string | undefined }
const pushedMessages = () => github.history(repo).map((c) => c.message)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, {
    now,
    secrets: null,
    lookup: null,
    studio: local.studio,
    extra: { preview: { domain: 'my-store.one', links: { seal: async () => 'x', open: async () => null } }, design: { ai: () => provider, screenshots: null, readAsset: null } },
  })
  host = await sandboxProcess()
  sites = fakeSites()
  assets = fakeSites()
  drafts = fakeSites()
  template = await walk(baselineDir)
  await putText(sites, `templates/${core}/skeleton.json`, JSON.stringify({ files: [{ path: 'package.json', content: '{"name":"store"}\n' }, { path: '.github/workflows/build.yml', content: 'on: workflow_dispatch\n' }] }))
  await putText(sites, `templates/${core}/themes/baseline/source.json`, JSON.stringify({ files: template }))
  github = localGitHub({ org: 'dripfunnel', installationId: '42', appId: '7' })
  const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey))))}\n-----END PRIVATE KEY-----`
  repos = storeRepos(createGitHubApp({ appId: '7', installationId: '42', privateKey: pem, fetchImpl: github.fetch, sleep: async () => undefined }).session(), 'dripfunnel')
  await repos.create(repo)
  const first = (await repos.head(repo)) ?? ''
  const tree = await repos.writeTree(repo, null, [{ path: 'package.json', content: '{"name":"store"}\n' }, { path: '.github/workflows/build.yml', content: 'on: workflow_dispatch\n' }, ...template])
  const main = await repos.commit(repo, { tree, parent: first, message: 'Start from the baseline template', at: new Date() })
  await repos.advance(repo, main)
  await db.sql`update store set status = 'active', core_version = ${core}, main_language = 'en-IN' where id = ${t.storeA1}`
  await db.sql`insert into store_language (store_id, language) values (${t.storeA1}, 'en-IN'), (${t.storeA1}, 'hi-IN') on conflict do nothing`
  await db.sql`update storefront set repo = ${repo}, repo_id = 9301, repo_state = 'ready', repo_head = ${main}, template = 'baseline' where store_id = ${t.storeA1}`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, 'ai_mode', 1 from store where plan_id is not null`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, 'ai_prompts', 50 from store where plan_id is not null`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, 'history_days', 90 from store where plan_id is not null`
}, 240_000)

afterAll(async () => {
  await host?.close()
  await db?.drop()
})

let firstRun = ''
let firstLead = ''

describe('publishing from the studio', () => {
  it('changes, undoes and publishes: the version goes live and only then one squashed commit reaches main', async () => {
    expect((await ask('Make the lead about linen', lead('Linen, slowly made.'))).outcome).toBe('changed')
    const undone = await ask('Try another lead', lead('A lead to undo.'))
    expect((await w.gql('owner', 'mutation U($id: ID!) { undoDesignChange(messageId: $id) { undone } }', { id: undone.message.id })).code).toBeUndefined()
    firstLead = (await leadNow()) ?? ''
    expect(firstLead).toBe('Linen, slowly made.')
    const pushed = pushedMessages().length
    const started = await publish()
    expect(started.code).toBeUndefined()
    firstRun = started.data?.publishDesign ?? ''
    // Nothing reaches the repo before the publish is live.
    expect(pushedMessages()).toHaveLength(pushed)
    expect(await runPublish(deps(), { runId: firstRun, storeId: t.storeA1 }, workflow(new Set()))).toBe('live')
    expect(await liveBuild()).toBe(firstRun)
    const history = pushedMessages()
    expect(history).toHaveLength(pushed + 1)
    expect(history[0]).toBe(`Publish version 1\n\nBuild ${firstRun}`)
    // No merchant words in the public history; the published words in the tree.
    expect(history.join('\n')).not.toMatch(/linen|undo|lead/i)
    expect(github.files(repo)?.get('content/en/pages.json')).toContain('Linen, slowly made.')
    // The draft was published to its head: no draft, so the status is the live site's.
    expect(await head()).toBeNull()
    const read = await w.gql('owner', '{ storefront { status live { number } history { number live } } }')
    expect(read.data?.['storefront']).toEqual({ status: 'same_as_live', live: { number: 1 }, history: [{ number: 1, live: true }] })
    const run = await w.gql('manager', 'query R($id: ID!) { publishRun(id: $id) { state step version checks { name passed } } }', { id: firstRun })
    expect(run.data?.['publishRun']).toMatchObject({ state: 'live', step: 'live', version: 1, checks: expect.arrayContaining([{ name: 'axe', passed: true }]) })
    const actions = (await db.sql<{ action: string }[]>`select action from activity_log where store_id = ${t.storeA1} and action in ('storefront.publish_started', 'storefront.published')`).map((r) => r.action)
    expect(actions.sort()).toEqual(['storefront.publish_started', 'storefront.published'])
  })

  it('goes back to a version by moving the pointer, with no build, and resets the draft to it', async () => {
    expect((await ask('A second look', lead('Version two.'))).outcome).toBe('changed')
    const second = (await publish()).data?.publishDesign ?? ''
    expect(await runPublish(deps(), { runId: second, storeId: t.storeA1 }, workflow(new Set()))).toBe('live')
    expect(pushedMessages()[0]).toBe(`Publish version 2\n\nBuild ${second}`)
    expect((await ask('An unpublished change', lead('Not published.'))).outcome).toBe('changed')
    const runs = async () => (await db.sql<{ n: number }[]>`select count(*)::int as n from publish_run where store_id = ${t.storeA1}`)[0]?.n
    const before = await runs()
    expect((await w.gql('manager', 'mutation { goBackToVersion(number: 1) }')).code).toBe('FORBIDDEN')
    expect(await w.gql('owner', 'mutation { goBackToVersion(number: 1) }')).toMatchObject({ code: undefined, data: { goBackToVersion: true } })
    expect(await liveBuild()).toBe(firstRun)
    expect(await runs()).toBe(before)
    expect(await head()).toBeNull()
    expect(await leadNow()).toBe(firstLead)
    expect((await w.gql('owner', 'mutation { goBackToVersion(number: 1) }')).code).toBe('ALREADY_LIVE')
    expect((await w.gql('owner', 'mutation { goBackToVersion(number: 9) }')).code).toBe('NOT_FOUND')
  })

  it('a refused publish keeps the live site, pushes nothing, names the change to leave out, and publishes everything before it', async () => {
    const good = await ask('A good change', lead('A good change.'))
    const goodCommit = await head()
    const broken = await ask('A change the gate refuses', lead('A broken change.'))
    const brokenCommit = (await head()) ?? ''
    const live = await liveBuild()
    const pushed = pushedMessages().length
    const runId = (await publish()).data?.publishDesign ?? ''
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, workflow(new Set([brokenCommit])))).toBe('failed')
    expect(await liveBuild()).toBe(live)
    expect(pushedMessages()).toHaveLength(pushed)
    const run = await w.gql('owner', 'query R($id: ID!) { publishRun(id: $id) { state error bisectMessageId checks { name passed words } } }', { id: runId })
    expect(run.data?.['publishRun']).toMatchObject({ state: 'failed', error: 'bisected', bisectMessageId: broken.message.id })
    const [refused] = await db.sql<{ changes: unknown }[]>`select changes from activity_log where store_id = ${t.storeA1} and action = 'storefront.publish_refused'`
    expect(refused?.changes).toEqual([expect.objectContaining({ field: 'error', after: 'bisected' }), expect.objectContaining({ field: 'check', after: 'axe' })])
    expect((await w.gql('owner', 'mutation P($m: ID!) { publishBefore(messageId: $m) }', { m: good.message.id })).code).toBe('NOT_BISECTED')
    const before = (await w.gql('owner', 'mutation P($m: ID!) { publishBefore(messageId: $m) }', { m: broken.message.id })).data?.['publishBefore'] as string
    expect((await db.sql<{ commit: string }[]>`select commit from publish_run where id = ${before}`)[0]?.commit).toBe(goodCommit)
    expect(await runPublish(deps(), { runId: before, storeId: t.storeA1 }, workflow(new Set([brokenCommit])))).toBe('live')
    expect(github.files(repo)?.get('content/en/pages.json')).toContain('A good change.')
    // The change left out is still the draft's, to fix in the studio.
    expect(await head()).toBe(brokenCommit)
  })

  it('a failing design is repaired by the AI at the platform’s cost, and the repair is what goes live and is pushed', async () => {
    const answerRepair = lead('Repaired at publish.')
    const repair: PublishRepair = async (storeId, failing) => {
      answers.push(answerRepair)
      return runnerOf(storeId).repairPublish(failing, designModel(provider, repairBrief))
    }
    const broken = (await head()) ?? ''
    const runId = (await publish()).data?.publishDesign ?? ''
    expect(await runPublish(deps(repair), { runId, storeId: t.storeA1 }, workflow(new Set([broken])))).toBe('live')
    expect(github.files(repo)?.get('content/en/pages.json')).toContain('Repaired at publish.')
    const repaired = await db.sql<{ billed_to: string; requested_by: string | null }[]>`select billed_to, requested_by from ai_run where store_id = ${t.storeA1} and billed_to = 'platform'`
    expect(repaired.length).toBeGreaterThan(0)
    expect(repaired.every((r) => r.requested_by === null)).toBe(true)
  })

  it('never goes back across a newer security release of core: the live site and the draft stay', async () => {
    await db.sql`insert into core_release (version, kind, sandbox_image, security) values ('0.4.1', 'patch', ${`registry.cloudflare.com/sandbox@sha256:${'a'.repeat(64)}`}, true) on conflict (version) do update set security = true`
    const live = await liveBuild()
    const runs = (await db.sql<{ n: number }[]>`select count(*)::int as n from publish_run where store_id = ${t.storeA1}`)[0]?.n
    expect((await w.gql('owner', 'mutation { goBackToVersion(number: 1) }')).code).toBe('SECURITY_RELEASE')
    expect(await liveBuild()).toBe(live)
    expect((await db.sql<{ n: number }[]>`select count(*)::int as n from publish_run where store_id = ${t.storeA1}`)[0]?.n).toBe(runs)
  })

  it('shows a store its own publishes only; Staff and suppliers are refused', async () => {
    expect((await w.gql('bOwner', 'query R($id: ID!) { publishRun(id: $id) { id } }', { id: firstRun })).data?.['publishRun']).toBeNull()
    for (const who of ['staff', 'supplier'] as const) expect((await w.gql(who, 'query R($id: ID!) { publishRun(id: $id) { id } }', { id: firstRun })).code).toBe('FORBIDDEN')
    for (const who of ['manager', 'staff', 'supplier', 'bOwner'] as const) expect((await publish(who)).code).toBe(who === 'bOwner' ? 'NOTHING_TO_PUBLISH' : 'FORBIDDEN')
  })
})
