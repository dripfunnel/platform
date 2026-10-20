import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { allowanceUsed } from '#db/scoped/publishing'
import { recordGate } from '#db/scoped/builds'
import { createGitHubApp, GitHubRefused, GitHubUnavailable, noAnswer, storeRepos } from '#integrations/github/index'
import { localGitHub } from '#integrations/local/github'
import { digestOf, dispatchBuild, runPublish, startPublish, type PublishDeps } from '#saas/storefronts/index'
import { draftBundle, snapshotFile, sourceBundle, stagingFolder } from '#saas/storefronts/layout'
import { testProbe } from './support/edgeProbe'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { fakeSites, type FakeSites } from './support/sites'

// Card #483 part 4: the publish run freezes its input, starts the store repo's locked workflow and waits for its report
// (storefront LIVE-SHOP.md §4 steps 2–7); a failing report ends the publish with the live site as it was (SAAS §9.1).

let db: TestDatabase
let t: Tenants
let sites: FakeSites
let assets: FakeSites
let drafts: FakeSites
let dispatched: { repo: string; buildId: string }[]
const commit = (n: number) => n.toString(16).padStart(40, '0')
const bundleBytes = (text: string) => new TextEncoder().encode(text).buffer

const deps = (): PublishDeps => ({
  sql: db.sql,
  sites,
  assets,
  drafts,
  assetOrigin: 'https://sf-assets.my-store.one', shopDomain: 'shop.example',
  dispatch: async (repo, buildId) => {
    dispatched.push({ repo, buildId })
    return true
  },
  now: () => new Date(),
  probe: testProbe(db.sql, { sites, assets }),
  assetHost: 'sf-assets.my-store.one',
  wait: async () => undefined,
})

/** The workflow's report arrives while the run waits, as the build's `report` call records it (builds.ts). */
const reportOn = (passed: boolean) => ({
  do: (_: string, work: () => Promise<string>) => work(),
  waitFor: async (_: string, event: string) => {
    if (event === 'uploaded') throw new Error('waitForEvent timed out')
    const [run] = await db.sql<{ id: string }[]>`select id from publish_run where state = 'building' order by created_at desc limit 1`
    await withSystemScope(db.sql, (tx) => recordGate(tx, { buildId: run?.id ?? '', gate: { passed, checks: [{ name: 'axe', passed }] }, digest: 'd'.repeat(64), passed, at: new Date(Date.now() + 61_000) }))
  },
})
const noReport = { do: (_: string, work: () => Promise<string>) => work(), waitFor: async () => Promise.reject(new Error('waitForEvent timed out')) }

const start = (storeId: string, kind: 'design' | 'manual', n: number) =>
  withSystemScope(db.sql, (tx) =>
    startPublish(tx, { storeId, kind, commit: commit(n), template: 'linen', coreVersion: '1.0.0', usesAllowance: kind === 'manual', startedBy: { kind: 'system', id: null }, at: new Date() }),
  ).then((r) => (r.ok ? r.runId : ''))
const runOf = async (id: string) =>
  (await db.sql<{ state: string; error: string | null; dispatched_at: Date | null; build_minutes: number | null; started_at: Date | null }[]>`
    select state, error, dispatched_at, build_minutes, started_at from publish_run where id = ${id}`)[0]
const live = async (storeId: string) => (await db.sql<{ live_build_id: string | null }[]>`select live_build_id from storefront where store_id = ${storeId}`)[0]?.live_build_id ?? null

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set status = 'active' where id in (${t.storeA1}, ${t.storeA2})`
  await db.sql`update storefront set repo = 'sf-a1a1a1a1a1', repo_id = 9101 where store_id = ${t.storeA1}`
  await db.sql`update storefront set repo = 'sf-a2a2a2a2a2', repo_id = 9102 where store_id = ${t.storeA2}`
  await db.sql`insert into design_draft (store_id, head_commit, template, core_version) values (${t.storeA1}, ${commit(9)}, 'linen', '1.0.0')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(async () => {
  sites = fakeSites()
  assets = fakeSites()
  drafts = fakeSites()
  dispatched = []
  await drafts.put(draftBundle(t.storeA1), bundleBytes('draft A1'), { sha256: await hexOf('draft A1') })
})

const hexOf = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('')

describe('a publish’s build', () => {
  it('freezes the draft and the snapshot under its build id, starts the workflow once, and is building until its report', async () => {
    const runId = await start(t.storeA1, 'design', 1)
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, noReport)).toBe('failed')
    expect(dispatched).toEqual([{ repo: 'sf-a1a1a1a1a1', buildId: runId }])
    expect(new TextDecoder().decode(new Uint8Array((await (await drafts.get(sourceBundle(t.storeA1, runId)))?.arrayBuffer()) ?? new ArrayBuffer(0)))).toBe('draft A1')
    const snapshot = JSON.parse((await (await drafts.get(snapshotFile(t.storeA1, runId)))?.text()) ?? '{}') as Record<string, unknown>
    const [store] = await db.sql<{ code: string; name: string; main_language: string }[]>`select code, name, main_language from store where id = ${t.storeA1}`
    expect(snapshot).toMatchObject({
      version: 1,
      origin: `https://${store?.code ?? ''}.shop.example`,
      store: { name: store?.name, mainLanguage: store?.main_language, language: store?.main_language },
      csp: { assetOrigin: 'https://sf-assets.my-store.one', mediaOrigins: [], analytics: [], payments: [] },
      assetBase: `https://sf-assets.my-store.one/stores/${t.storeA1}/builds/${runId}/assets/`,
      guard: { usedPaths: [], brand: { name: store?.name } },
    })
    // No report within the build id's 2 hours: the publish fails and the live site is as it was.
    expect(await runOf(runId)).toMatchObject({ state: 'failed', error: 'report_timed_out' })
    expect((await runOf(runId))?.dispatched_at).not.toBeNull()
  })

  it('refuses a failing report: checking, then failed, with nothing uploaded, pushed or made live, and the next publish starts', async () => {
    const before = await live(t.storeA2)
    await drafts.put(draftBundle(t.storeA2), bundleBytes('draft A2'), { sha256: await hexOf('draft A2') })
    await db.sql`insert into design_draft (store_id, head_commit, template, core_version) values (${t.storeA2}, ${commit(8)}, 'linen', '1.0.0') on conflict do nothing`
    const runId = await start(t.storeA2, 'design', 2)
    const next = await start(t.storeA2, 'design', 3)
    expect(await runPublish(deps(), { runId, storeId: t.storeA2 }, reportOn(false))).toBe('failed')
    expect(await runOf(runId)).toMatchObject({ state: 'failed', error: 'gate_failed', build_minutes: 2 })
    expect(await live(t.storeA2)).toBe(before)
    expect(sites.keys(stagingFolder(t.storeA2, runId))).toEqual([])
    expect(await db.sql`select 1 from storefront_push where store_id = ${t.storeA2}`).toHaveLength(0)
    expect((await db.sql<{ payload: { runId: string } }[]>`select payload from outbox where kind = 'storefront.publish' and store_id = ${t.storeA2}`).map((r) => r.payload.runId)).toContain(next)
    // A design the gate refused is recorded as refused, naming the failing check (#318, LOGGING §3).
    const [entry] = await db.sql<{ action: string; changes: unknown }[]>`select action, changes from activity_log where store_id = ${t.storeA2} and action = 'storefront.publish_refused'`
    expect(entry?.action).toBe('storefront.publish_refused')
    await db.sql`update publish_run set state = 'failed' where id = ${next}`
  })

  it('builds a catalogue publish from the live build’s own source bundle, never the draft, and refuses one with nothing live', async () => {
    const first = await start(t.storeA1, 'manual', 4)
    expect(await runPublish(deps(), { runId: first, storeId: t.storeA1 }, noReport)).toBe('failed')
    expect(await runOf(first)).toMatchObject({ state: 'failed', error: 'no_source' })
    expect(dispatched).toEqual([])
    const liveBuild = await start(t.storeA1, 'design', 5)
    await db.sql`update publish_run set state = 'live', finished_at = now() where id = ${liveBuild}`
    await db.sql`update storefront set live_build_id = ${liveBuild} where store_id = ${t.storeA1}`
    await drafts.put(sourceBundle(t.storeA1, liveBuild), bundleBytes('live source'), { sha256: await hexOf('live source') })
    const manual = await start(t.storeA1, 'manual', 6)
    await runPublish(deps(), { runId: manual, storeId: t.storeA1 }, noReport)
    expect(await (await drafts.get(sourceBundle(t.storeA1, manual)))?.text()).toBe('live source')
  })
})

describe('the dispatch', () => {
  it('starts at most one run however often its step is retried, and asks again only when GitHub definitely said no', async () => {
    const runId = await start(t.storeA2, 'design', 20)
    await db.sql`update publish_run set state = 'building', started_at = now() where id = ${runId}`
    let answers: (() => Promise<boolean>)[] = [async () => Promise.reject(new GitHubRefused(422)), async () => Promise.reject(new GitHubUnavailable('GitHub answered 429', 429)), async () => true]
    const asked: string[] = []
    const retrying = { ...deps(), dispatch: async (repo: string) => {
      asked.push(repo)
      return (answers.shift() ?? (async () => true))()
    } }
    await expect(dispatchBuild(retrying, t.storeA2, runId)).rejects.toThrow(GitHubRefused)
    await expect(dispatchBuild(retrying, t.storeA2, runId)).rejects.toThrow(GitHubUnavailable)
    expect(await dispatchBuild(retrying, t.storeA2, runId)).toBe('dispatched')
    // The step failing after GitHub started the run: its retry finds the start recorded and starts nothing.
    expect(await dispatchBuild(retrying, t.storeA2, runId)).toBe('skipped')
    expect(asked).toHaveLength(3)
    // A 5xx or no answer at all may hide a started run: the start stands and nothing is asked again.
    await db.sql`update publish_run set state = 'failed' where id = ${runId}`
    for (const [n, unclear] of [[21, new GitHubUnavailable('GitHub answered 502', 502)], [22, new GitHubUnavailable(noAnswer)]] as const) {
      const run = await start(t.storeA2, 'design', n)
      await db.sql`update publish_run set state = 'building', started_at = now() where id = ${run}`
      answers = [async () => Promise.reject(unclear)]
      await expect(dispatchBuild(retrying, t.storeA2, run)).rejects.toThrow(GitHubUnavailable)
      expect(await dispatchBuild(retrying, t.storeA2, run)).toBe('skipped')
      await db.sql`update publish_run set state = 'failed' where id = ${run}`
    }
    expect(asked).toHaveLength(5)
  })

  it('is sent to GitHub once: a 5xx isn’t sent again by the client, and the step’s retry starts nothing', async () => {
    const github = localGitHub({ org: 'dripfunnel', installationId: '42', appId: '7' })
    const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey))))}\n-----END PRIVATE KEY-----`
    const repos = storeRepos(createGitHubApp({ appId: '7', installationId: '42', privateKey: pem, fetchImpl: github.fetch, sleep: async () => undefined }).session(), 'dripfunnel')
    await repos.create('sf-a2a2a2a2a2')
    const run = await start(t.storeA2, 'design', 23)
    await db.sql`update publish_run set state = 'building', started_at = now() where id = ${run}`
    github.fail(/dispatches$/, 502, 3)
    const real = { ...deps(), dispatch: (repo: string, buildId: string) => repos.dispatchBuild(repo, { build_id: buildId, api: 'https://hooks.dripfunnel.com' }) }
    await expect(dispatchBuild(real, t.storeA2, run)).rejects.toThrow(GitHubUnavailable)
    expect(await dispatchBuild(real, t.storeA2, run)).toBe('skipped')
    expect(github.calls.filter((c) => c.endsWith('/dispatches'))).toHaveLength(1)
    await db.sql`update publish_run set state = 'failed' where id = ${run}`
  })

  it('fails a publish whose repo GitHub doesn’t know as no_repo, at once, asking GitHub once per try', async () => {
    const runId = await start(t.storeA1, 'design', 25)
    let asked = 0
    const missing = { ...deps(), dispatch: async () => {
      asked += 1
      return false
    } }
    // The Workflow's own retries of the step, played here: each try asks again and fails the same way.
    const retried = { do: async (name: string, work: () => Promise<string>) => {
      for (let tries = 1; ; tries += 1) {
        try {
          return await work()
        } catch (error) {
          if (name !== 'dispatch' || tries >= 3) throw error
        }
      }
    }, waitFor: async () => Promise.reject(new Error('waitForEvent timed out')) }
    expect(await runPublish(missing, { runId, storeId: t.storeA1 }, retried)).toBe('failed')
    expect(await runOf(runId)).toMatchObject({ state: 'failed', error: 'no_repo', dispatched_at: null })
    expect(asked).toBe(3)
  })

  it('waits for the report and the upload only until the build id’s 2 hours from its claim run out', async () => {
    const runId = await start(t.storeA1, 'design', 24)
    const waits: number[] = []
    const claimedLate = {
      do: async (name: string, work: () => Promise<string>) => {
        const done = await work()
        if (name === 'claim') await db.sql`update publish_run set started_at = now() - interval '110 minutes' where id = ${runId}`
        return done
      },
      waitFor: async (_: string, __: string, minutes: number) => {
        waits.push(minutes)
        throw new Error('waitForEvent timed out')
      },
    }
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, claimedLate)).toBe('failed')
    expect(waits).toEqual([10])
  })
})

describe('"Publish now"’s allowance', () => {
  it('is never used by a refused or failed publish', async () => {
    const since = new Date(Date.now() - 60_000)
    const used = await withSystemScope(db.sql, (tx) => allowanceUsed(tx, t.storeA1, since))
    const refused = await start(t.storeA1, 'manual', 7)
    expect(await runPublish(deps(), { runId: refused, storeId: t.storeA1 }, reportOn(false))).toBe('failed')
    expect(await withSystemScope(db.sql, (tx) => allowanceUsed(tx, t.storeA1, since))).toBe(used)
    // A press that went live is the one that counts.
    const pressed = await start(t.storeA1, 'manual', 8)
    await db.sql`update publish_run set state = 'live', finished_at = now() where id = ${pressed}`
    expect(await withSystemScope(db.sql, (tx) => allowanceUsed(tx, t.storeA1, since))).toBe(used + 1)
    expect(await withSystemScope(db.sql, (tx) => allowanceUsed(tx, t.storeA2, since))).toBe(0)
  })
})

describe('the locked workflow’s dispatch', () => {
  it('starts build.yml on main with the build id and the hooks host, and knows a repo GitHub doesn’t', async () => {
    const github = localGitHub({ org: 'dripfunnel', installationId: '42', appId: '7' })
    const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey))))}\n-----END PRIVATE KEY-----`
    const repos = storeRepos(createGitHubApp({ appId: '7', installationId: '42', privateKey: pem, fetchImpl: github.fetch, sleep: async () => undefined }).session(), 'dripfunnel')
    await repos.create('sf-dispatch01')
    const buildId = crypto.randomUUID()
    expect(await repos.dispatchBuild('sf-dispatch01', { build_id: buildId, api: 'https://hooks.dripfunnel.com' })).toBe(true)
    expect(github.dispatches).toEqual([{ repo: 'sf-dispatch01', workflow: 'build.yml', ref: 'main', inputs: { build_id: buildId, api: 'https://hooks.dripfunnel.com' } }])
    expect(await repos.dispatchBuild('sf-missing00', { build_id: buildId, api: 'https://hooks.dripfunnel.com' })).toBe(false)
  })
})

describe('the locked workflow (LIVE-SHOP §4 step 5)', () => {
  const workflow = readFileSync(new URL('../../../templates/storefront/.github/workflows/build.yml', import.meta.url), 'utf8')
  const step = (name: string) => (new RegExp(`- name: ${name}\\n[\\s\\S]*?(?=\\n {6}- name: |$)`).exec(workflow)?.[0] ?? '').replace(/^ {10}/gm, '')

  it('is one job of fetch, build, check and upload, with the OIDC permission alone, no artifact, no checkout and no push', () => {
    expect([...workflow.matchAll(/^ {6}- name: (\w+)$/gm)].map((m) => m[1])).toEqual(['fetch', 'build', 'check', 'upload'])
    expect([...workflow.matchAll(/^ {2}[a-z]+:\n {4}runs-on:/gm)]).toHaveLength(1)
    expect(workflow).toMatch(/^permissions:\n {2}id-token: write\nconcurrency:/m)
    expect(workflow).not.toMatch(/upload-artifact|download-artifact|actions\/checkout|git push|contents: write|^\s*-?\s*uses:/m)
  })

  it('runs the AI’s code only in --network none containers that see nothing of the runner’s, the input read-only', () => {
    const runs = [...workflow.matchAll(/docker run ([\s\S]*?)node \/opt\/sandbox\/dist\/publish\.js (build|check)/g)]
    expect(runs.map((r) => r[2])).toEqual(['build', 'check'])
    for (const [, flags = ''] of runs) {
      expect(flags).toContain('--network none')
      expect(flags).toContain('--read-only')
      expect(flags).toContain('--cap-drop ALL')
      expect(flags).toContain('-v "$IN:/in:ro"')
      // The only variable a container gets: no GITHUB_TOKEN, no ACTIONS_* and no OIDC request URL.
      expect([...flags.matchAll(/(?:^|\s)(?:-e|--env)\s+(\S+)/g)].map((m) => m[1])).toEqual(['HOME=/tmp'])
      expect(flags).not.toMatch(/--env-file|GITHUB_|ACTIONS_|--privileged|--network host/)
    }
    expect(step('check')).toContain('-v "$BUILT:/built:ro"')
  })

  it('logs only which step ran and whether it passed', () => {
    for (const name of ['fetch', 'build', 'check', 'upload']) {
      const said = [...step(name).matchAll(/echo "([^"$]*)"(?!\s*>)/g)].map((m) => m[1] ?? '')
      expect(said.length).toBeGreaterThan(0)
      for (const words of said) expect(words).toMatch(/^(fetch|build|check|upload): (done|failed|passed|refused)$/)
    }
    // The containers' own output never reaches the log.
    expect([...workflow.matchAll(/publish\.js (?:build|check)[^\n]*(?:\n[^\n]*?){0,2}> \/dev\/null 2>&1/g)]).toHaveLength(2)
  })

  it('takes a passing verdict only from the check container: the build container’s report can only refuse', () => {
    const pick = /--argjson stopped "\$stopped" '([^']*)'/.exec(step('check'))?.[1] ?? ''
    const stopped = /stopped='([^']*)'/.exec(step('check'))?.[1] ?? ''
    const verdict = (report: string) => JSON.parse(execFileSync('jq', ['-c', '--argjson', 'stopped', stopped, pick], { input: report, encoding: 'utf8' })) as unknown
    const forged = JSON.stringify({ passed: true, checks: [{ name: 'contracts', passed: true }] })
    expect(verdict(forged)).toEqual({ passed: false, checks: JSON.parse(stopped) as unknown })
    expect(verdict(JSON.stringify({ passed: false, checks: [{ name: 'validator', passed: false, detail: 'No.' }, { name: 'axe', passed: true }] }))).toEqual({ passed: false, checks: [{ name: 'validator', passed: false, detail: 'No.' }] })
    expect(verdict('{}')).toEqual({ passed: false, checks: JSON.parse(stopped) as unknown })
    // The check container runs whenever there is a site, whatever the build left beside it.
    expect(step('check')).toContain('if [[ -d "$SITE" ]]; then')
    expect(step('check')).not.toContain('report="$BUILT/report.json"')
  })

  it('reports the digest of exactly the files it handed to the check, as the API computes it', async () => {
    const list = (/cat > "\$RUNNER_TEMP\/list\.py" <<'PY'\n([\s\S]*?)\nPY\n/.exec(step('fetch'))?.[1] ?? '')
    const digest = (/digest=\$\(python3 "\$RUNNER_TEMP\/list\.py" "\$SITE" \| python3 -c '([^']*)'\)/.exec(step('check'))?.[1] ?? '')
    const root = mkdtempSync(join(tmpdir(), 'site-'))
    try {
      const site: Record<string, string> = { 'index.html': '<h1>Home</h1>', 'cart/index.html': '<h1>Cart</h1>', 'assets/entry-ab12.js': 'x()' }
      for (const [path, text] of Object.entries(site)) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), text)
      }
      const listed = execFileSync('python3', ['-c', list, root], { encoding: 'utf8' })
      const sent = execFileSync('python3', ['-c', digest], { input: listed, encoding: 'utf8' }).trim()
      expect(sent).toBe(await digestOf((JSON.parse(listed) as { files: { path: string; sha256: string }[] }).files))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
