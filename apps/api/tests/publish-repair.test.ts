import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { recordGate } from '#db/scoped/builds'
import { moveDraft } from '#db/scoped/studio'
import { digestOf, goBack, publishBefore, runPublish, startPublish, type PublishDeps, type PublishRepair } from '#saas/storefronts/index'
import { failAttempt, finishRepaired, selectExpiredBuilds, selectFailingChecks, setBisectCommit, setRepairAttempts } from '#db/scoped/publishing'
import { draftBundle, stagingFolder } from '#saas/storefronts/layout'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { fakeSites, putText, type FakeSites } from './support/sites'

// Card #483 part 5: a design publish that fails the gate is repaired, then bisected to the change that broke it, then
// refused (storefront ARCHITECTURE §4.2 step 4); "publish everything before this change" publishes what came before.

let db: TestDatabase
let t: Tenants
let sites: FakeSites
let assets: FakeSites
let drafts: FakeSites
let dispatched: string[]
const commit = (n: number) => n.toString(16).padStart(40, '0')
const hex = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('')

const deps = (repair?: PublishRepair): PublishDeps => ({
  sql: db.sql,
  sites,
  assets,
  drafts,
  assetOrigin: null,
  dispatch: async (_repo, buildId) => {
    dispatched.push(buildId)
    return true
  },
  now: () => new Date(),
  ...(repair ? { repair } : {}),
})

const buildOf = async (id: string) => (await db.sql<{ commit: string; state: string; attempt: string | null; error: string | null }[]>`select commit, state, attempt, error from publish_run where id = ${id}`)[0]

/** The workflow, played by the test: a build of a commit in `bad` fails its report, any other passes, then uploads. */
const workflow = (bad: ReadonlySet<string>) => ({
  do: (_: string, work: () => Promise<string>) => work(),
  waitFor: async (_: string, event: string) => {
    const id = dispatched.at(-1) ?? ''
    const build = await buildOf(id)
    if (!build) throw new Error('nothing was dispatched')
    if (event === 'reported') {
      const passed = !bad.has(build.commit)
      await withSystemScope(db.sql, (tx) => recordGate(tx, { buildId: id, gate: { passed, checks: [{ name: 'axe', passed, detail: passed ? undefined : 'The home page at 390 px breaks accessibility rules: image-alt.' }] }, digest: 'd'.repeat(64), passed, at: new Date() }))
      return
    }
    const [run] = await db.sql<{ store_id: string }[]>`select store_id from publish_run where id = ${id}`
    const html = `<h1>${id}</h1>`
    const files = [{ path: 'index.html', sha256: await putText(sites, `${stagingFolder(run?.store_id ?? '', id)}index.html`, html), size: html.length }]
    await db.sql`update publish_run set gate_digest = ${await digestOf(files)}, uploaded_at = now(), upload_manifest = ${db.sql.json({ files })} where id = ${id}`
  },
})

const draftWith = async (storeId: string, commits: string[]) => {
  await db.sql`delete from design_draft where store_id = ${storeId}`
  await db.sql`insert into design_draft (store_id, head_commit, template, core_version, commits) values (${storeId}, ${commits.at(-1) ?? commit(1)}, 'linen', '1.0.0', ${`{${commits.join(',')}}`}::text[])`
}
const publishDesign = (storeId: string, head: string) =>
  withSystemScope(db.sql, (tx) => startPublish(tx, { storeId, kind: 'design', commit: head, template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() })).then((r) => (r.ok ? r.runId : ''))
const live = async (storeId: string) => (await db.sql<{ live_build_id: string | null }[]>`select live_build_id from storefront where store_id = ${storeId}`)[0]?.live_build_id ?? null
const root = async (id: string) => (await db.sql<{ state: string; error: string | null; bisect_commit: string | null; repair_attempts: number }[]>`select state, error, bisect_commit, repair_attempts from publish_run where id = ${id}`)[0]
const attemptsOf = (id: string) => db.sql<{ commit: string; state: string; attempt: string }[]>`select commit, state, attempt from publish_run where attempt_of = ${id} order by created_at`

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set status = 'active' where id in (${t.storeA1}, ${t.storeA2})`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  await db.sql`update storefront set repo = 'sf-r1r1r1r1r1', repo_id = 9201 where store_id = ${t.storeA1}`
  await db.sql`update storefront set repo = 'sf-r2r2r2r2r2', repo_id = 9202 where store_id = ${t.storeA2}`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(async () => {
  sites = fakeSites()
  assets = fakeSites()
  drafts = fakeSites()
  dispatched = []
  for (const store of [t.storeA1, t.storeA2]) await drafts.put(draftBundle(store), new TextEncoder().encode('draft').buffer, { sha256: await hex('draft') })
})

describe('a design publish that fails the gate', () => {
  it('is bisected to the first change that broke it among five, with each probe checked and never uploaded, then refused', async () => {
    const chain = [1, 2, 3, 4, 5].map((n) => commit(100 + n))
    await draftWith(t.storeA1, chain)
    const before = await live(t.storeA1)
    const runId = await publishDesign(t.storeA1, chain[4] ?? '')
    const broken = new Set(chain.slice(2))
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, workflow(broken))).toBe('failed')
    expect(await root(runId)).toMatchObject({ state: 'failed', error: 'bisected', bisect_commit: chain[2], repair_attempts: 0 })
    const probes = await attemptsOf(runId)
    // Binary search over five changes: no more than three probes, each of a commit inside the chain.
    expect(probes.length).toBeLessThanOrEqual(3)
    for (const probe of probes) expect(probe).toMatchObject({ attempt: 'bisect', state: broken.has(probe.commit) ? 'failed' : 'checked' })
    expect(probes.map((p) => p.commit)).toContain(chain[1])
    expect(probes.map((p) => p.commit)).toContain(chain[2])
    expect(await live(t.storeA1)).toBe(before)
    expect(await db.sql`select 1 from publish_run where attempt_of = ${runId} and uploaded_at is not null`).toHaveLength(0)
    // Every probe, the passing ones too, is left to clean-up (LIVE-SHOP §4 step 11).
    const due = new Set((await withSystemScope(db.sql, (tx) => selectExpiredBuilds(tx, 20, 1000))).map((b) => b.id))
    const ids = await db.sql<{ id: string; state: string }[]>`select id, state from publish_run where attempt_of = ${runId}`
    expect(ids.some((p) => p.state === 'checked')).toBe(true)
    for (const probe of ids) expect(due.has(probe.id)).toBe(true)
  })

  it('offers "publish everything before this change", and that publish passes and goes live', async () => {
    const chain = [1, 2, 3, 4, 5].map((n) => commit(100 + n))
    const offered = await withSystemScope(db.sql, (tx) => publishBefore(tx, { storeId: t.storeA1, commit: chain[2] ?? '', by: null, at: new Date() }))
    expect(offered.ok).toBe(true)
    const runId = offered.ok ? offered.runId : ''
    expect((await buildOf(runId))?.commit).toBe(chain[1])
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, workflow(new Set(chain.slice(2))))).toBe('live')
    expect(await live(t.storeA1)).toBe(runId)
    // The published changes leave the draft's list; the one that broke and those after it stay to fix.
    expect((await db.sql<{ commits: string[] }[]>`select to_jsonb(commits) as commits from design_draft where store_id = ${t.storeA1}`)[0]?.commits).toEqual(chain.slice(2))
  })

  it('refuses "publish everything before" for a change no bisect named, another store’s, or the draft’s first', async () => {
    const at = new Date()
    expect(await withSystemScope(db.sql, (tx) => publishBefore(tx, { storeId: t.storeA1, commit: commit(104), by: null, at }))).toEqual({ ok: false, reason: 'NOT_BISECTED' })
    expect(await withSystemScope(db.sql, (tx) => publishBefore(tx, { storeId: t.storeA2, commit: commit(103), by: null, at }))).toEqual({ ok: false, reason: 'NOT_BISECTED' })
    const chain = [commit(201), commit(202)]
    await draftWith(t.storeA2, chain)
    const runId = await publishDesign(t.storeA2, chain[1] ?? '')
    expect(await runPublish(deps(), { runId, storeId: t.storeA2 }, workflow(new Set(chain)))).toBe('failed')
    // The draft's very first change broke it: there is nothing before it to publish, so the publish is refused outright.
    expect(await root(runId)).toMatchObject({ state: 'failed', error: 'gate_failed', bisect_commit: chain[0] })
    expect(await withSystemScope(db.sql, (tx) => publishBefore(tx, { storeId: t.storeA2, commit: chain[0] ?? '', by: null, at }))).toEqual({ ok: false, reason: 'NOTHING_BEFORE' })
  })

  it('is repaired from its failing checks, and the repair’s build goes live in its place', async () => {
    const chain = [commit(301), commit(302)]
    await draftWith(t.storeA2, chain)
    const asked: string[][] = []
    const keys: string[] = []
    const repaired = commit(303)
    const repair: PublishRepair = async (_store, failing, key) => {
      asked.push(failing)
      keys.push(key)
      return asked.length === 1 ? commit(399) : repaired
    }
    const [user] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'publisher@example.com', 'Publisher', 'active') returning id`
    const runId = await withSystemScope(db.sql, (tx) => startPublish(tx, { storeId: t.storeA2, kind: 'design', commit: chain[1] ?? '', template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'user', id: user?.id ?? null }, at: new Date() })).then((r) => (r.ok ? r.runId : ''))
    // The first repair's build fails another check, which is what the second try is told.
    const failing = new Set([chain[1] ?? '', commit(399)])
    const play = workflow(failing)
    const otherCheck = { ...play, waitFor: async (name: string, event: string) => {
      await play.waitFor(name, event)
      if (name === 'repair-1:report') await db.sql`update publish_run set gate = ${db.sql.json({ passed: false, checks: [{ name: 'no-js', passed: false, detail: 'The home page shows no main text without JavaScript.' }] })} where attempt_of = ${runId} and commit = ${commit(399)}`
    } }
    expect(await runPublish(deps(repair), { runId, storeId: t.storeA2 }, otherCheck)).toBe('live')
    expect(asked[0]).toEqual(['axe: The home page at 390 px breaks accessibility rules: image-alt.'])
    expect(asked[1]).toEqual(['no-js: The home page shows no main text without JavaScript.'])
    expect(keys).toEqual([`${runId}:1`, `${runId}:2`])
    // The version and the publish record keep the person who pressed Publish, though the repair's build went live.
    const [version] = await db.sql<{ published_by: string | null }[]>`select published_by from design_version where store_id = ${t.storeA2} and state = 'live'`
    expect(version?.published_by).toBe(user?.id)
    expect(await root(runId)).toMatchObject({ state: 'live', repair_attempts: 2, bisect_commit: null })
    const tries = await attemptsOf(runId)
    expect(tries.map((x) => [x.attempt, x.commit, x.state])).toEqual([
      ['repair', commit(399), 'failed'],
      ['repair', repaired, 'live'],
    ])
    const [pointer] = await db.sql<{ live_build_id: string }[]>`select live_build_id from storefront where store_id = ${t.storeA2}`
    expect((await buildOf(pointer?.live_build_id ?? ''))?.commit).toBe(repaired)
  })

  it('stops repairing after three tries, then bisects', async () => {
    const chain = [commit(401), commit(402), commit(403)]
    await draftWith(t.storeA2, chain)
    let tries = 0
    const runId = await publishDesign(t.storeA2, chain[2] ?? '')
    const result = await runPublish(
      deps(async () => commit(490 + ++tries)),
      { runId, storeId: t.storeA2 },
      workflow(new Set([chain[1] ?? '', chain[2] ?? '', commit(491), commit(492), commit(493)])),
    )
    expect(result).toBe('failed')
    expect(tries).toBe(3)
    expect(await root(runId)).toMatchObject({ state: 'failed', error: 'bisected', repair_attempts: 3, bisect_commit: chain[1] })
  })
})

describe('a publish whose repair never reports', () => {
  it('ends with its open repair build, so the store can publish again', async () => {
    const chain = [commit(601)]
    await draftWith(t.storeA2, chain)
    const runId = await publishDesign(t.storeA2, chain[0] ?? '')
    const silentRepair = {
      ...workflow(new Set(chain)),
      waitFor: async (name: string, event: string) => {
        if (name.startsWith('repair-')) throw new Error('waitForEvent timed out')
        return workflow(new Set(chain)).waitFor(name, event)
      },
    }
    expect(await runPublish(deps(async () => commit(602)), { runId, storeId: t.storeA2 }, silentRepair)).toBe('failed')
    expect(await root(runId)).toMatchObject({ state: 'failed', error: 'report_timed_out' })
    expect((await attemptsOf(runId)).map((a) => a.state)).toEqual(['failed'])
    expect(await db.sql`select 1 from publish_run where store_id = ${t.storeA2} and state in ('building', 'checking', 'deploying')`).toHaveLength(0)
    expect((await db.sql<{ build_state: string }[]>`select build_state from store where id = ${t.storeA2}`)[0]?.build_state).not.toBe('building')
  })
})

describe('a catalogue publish that fails the gate', () => {
  it('is refused at once: no repair, no bisect, no build beside it', async () => {
    let asked = 0
    const runId = await withSystemScope(db.sql, (tx) => startPublish(tx, { storeId: t.storeA1, kind: 'manual', commit: commit(701), template: 'linen', coreVersion: '1.0.0', usesAllowance: true, startedBy: { kind: 'system', id: null }, at: new Date() })).then((r) => (r.ok ? r.runId : ''))
    const liveId = await live(t.storeA1)
    await drafts.put(`sources/${t.storeA1}/${liveId ?? ''}.bundle`, new TextEncoder().encode('live').buffer, { sha256: await hex('live') })
    expect(await runPublish(deps(async () => (asked += 1, commit(702))), { runId, storeId: t.storeA1 }, workflow(new Set([commit(701)])))).toBe('failed')
    expect(await root(runId)).toMatchObject({ state: 'failed', error: 'gate_failed', repair_attempts: 0, bisect_commit: null })
    expect(await attemptsOf(runId)).toHaveLength(0)
    expect(asked).toBe(0)
  })
})

describe('the attempts’ own writes', () => {
  it('never touch another store’s builds', async () => {
    const [other] = await db.sql<{ id: string }[]>`select id from publish_run where store_id = ${t.storeA2} and attempt_of is not null limit 1`
    const before = await buildOf(other?.id ?? '')
    await withSystemScope(db.sql, (tx) => failAttempt(tx, t.storeA1, other?.id ?? '', new Date()))
    expect(await buildOf(other?.id ?? '')).toEqual(before)
    expect(await withSystemScope(db.sql, (tx) => selectFailingChecks(tx, t.storeA1, other?.id ?? ''))).toEqual([])
    // The publish's own record, named with the wrong store, is left alone too.
    const [publish] = await db.sql<{ id: string }[]>`select id from publish_run where store_id = ${t.storeA2} and attempt_of is null and state = 'failed' limit 1`
    const kept = await root(publish?.id ?? '')
    await withSystemScope(db.sql, async (tx) => {
      await setRepairAttempts(tx, t.storeA1, publish?.id ?? '', 3)
      await setBisectCommit(tx, t.storeA1, publish?.id ?? '', commit(999))
      await db.sql`update publish_run set state = 'checking' where id = ${publish?.id ?? ''}`
      await finishRepaired(tx, t.storeA1, publish?.id ?? '', new Date())
    })
    expect(await root(publish?.id ?? '')).toEqual({ ...kept, state: 'checking' })
    await db.sql`update publish_run set state = 'failed' where id = ${publish?.id ?? ''}`
  })
})

describe('the draft’s changes', () => {
  it('are cleared when the store goes back to a version', async () => {
    // A kept version to go back to, on the store's live build.
    const liveId = await live(t.storeA1)
    const [kept] = await db.sql<{ id: string }[]>`
      insert into design_version (store_id, number, commit, template, core_version, build_id, published_at, state)
      values (${t.storeA1}, 99, ${commit(800)}, 'linen', '1.0.0', ${liveId}, now(), 'kept') returning id`
    await draftWith(t.storeA1, [commit(801), commit(802)])
    const actor = { actorKind: 'person' as const, actorId: null, actorLabel: 'Owner', api: 'store' as const, requestId: null, ip: null, userAgent: null }
    expect(await goBack(db.sql, { storeId: t.storeA1, versionId: kept?.id ?? '', by: null, actor, now: new Date() })).toEqual({ ok: true })
    expect((await db.sql<{ commits: string[] }[]>`select to_jsonb(commits) as commits from design_draft where store_id = ${t.storeA1}`)[0]?.commits).toEqual([])
  })

  it('are listed as the studio accepts them', async () => {
    await draftWith(t.storeA2, [])
    const [user] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'draft-owner@example.com', 'Owner', 'active') returning id`
    for (const n of [501, 502, 502, 503]) {
      await withSystemScope(db.sql, (tx) => moveDraft(tx, { storeId: t.storeA2, head: commit(n), template: 'linen', coreVersion: '1.0.0', previewRef: `p${n}`, userId: user?.id ?? '', at: new Date(), customPaths: [] }))
    }
    expect((await db.sql<{ commits: string[] }[]>`select to_jsonb(commits) as commits from design_draft where store_id = ${t.storeA2}`)[0]?.commits).toEqual([commit(501), commit(502), commit(503)])
  })
})
