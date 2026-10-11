import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { storefrontPublishDeliverer } from '#jobs/queues/deliverers/storefrontPublish'
import { GiveUp, type Effect } from '#jobs/queues/outbox-relay'
import { cleanStorefronts, digestOf, goBack, keptBuilds, lookupLiveHost, runPublish, startPublish, type GoBackActor, type PublishDeps } from '#saas/storefronts/index'
import { buildFolder, previewFolder, sourceBundle, stagingFolder, draftBundle, snapshotFile } from '#saas/storefronts/layout'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { fakeSites, putText, type FakeSites } from './support/sites'

// Card #317 part 2: the publish-storefront Workflow's queued → deploying → live | failed, the switch of the live pointer,
// go back and clean-up (storefront LIVE-SHOP.md §4 steps 1, 9 and 11; SAAS §9.1, §9.2).

let db: TestDatabase
let t: Tenants
let sites: FakeSites
let assets: FakeSites
let drafts: FakeSites
const shopsA1 = 'store-a1.shops.acme.example'
const commit = (n: number) => n.toString(16).padStart(40, '0')
// No "uploaded" ever arrives in these tests while a run waits: the wait ends as the Workflow's timeout does.
const steps = {
  do: (_: string, work: () => Promise<string>) => work(),
  waitFor: async () => {
    throw new Error('waitForEvent timed out')
  },
}
const deps = (): PublishDeps => ({ sql: db.sql, sites, assets, drafts, assetOrigin: null, dispatch: async () => true, now: () => new Date() })
const actor: GoBackActor = { actorKind: 'person', actorId: null, actorLabel: 'Owner', api: 'store', requestId: null, ip: null, userAgent: null }

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set status = 'active' where id in (${t.storeA1}, ${t.storeA2})`
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  await db.sql`insert into design_draft (store_id, head_commit, template, core_version, preview_deploy_ref) values (${t.storeA1}, ${commit(99)}, 'linen', '1.0.0', 'change-9')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(() => {
  sites = fakeSites()
  assets = fakeSites()
  drafts = fakeSites()
})

const start = (storeId: string, n: number) =>
  withSystemScope(db.sql, (tx) =>
    startPublish(tx, { storeId, kind: 'design', commit: commit(n), template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() }),
  )
const runIdOf = (r: Awaited<ReturnType<typeof start>>) => (r.ok ? r.runId : '')
/** A run's passing report and its upload, as #517's build calls leave them: one staged file under a frozen manifest. */
const uploaded = async (storeId: string, runId: string) => {
  const html = `<p>${runId}</p>`
  const files = [{ path: 'index.html', sha256: await putText(sites, `${stagingFolder(storeId, runId)}index.html`, html), size: html.length }]
  await db.sql`
    update publish_run set state = 'deploying', started_at = now(), gate = ${db.sql.json({ passed: true, checks: [] })}, gate_digest = ${await digestOf(files)},
      uploaded_at = now(), upload_manifest = ${db.sql.json({ files })} where id = ${runId}`
}
const publishQueue = (storeId: string) => db.sql<{ payload: { runId: string } }[]>`select payload from outbox where kind = 'storefront.publish' and store_id = ${storeId} order by created_at`
const live = async (storeId: string) => (await db.sql<{ live_build_id: string | null }[]>`select live_build_id from storefront where store_id = ${storeId}`)[0]?.live_build_id ?? null
const runState = async (id: string) => (await db.sql<{ state: string; error: string | null }[]>`select state, error from publish_run where id = ${id}`)[0]
const versions = (storeId: string) => db.sql<{ number: number; state: string; build_id: string }[]>`select number, state, build_id from design_version where store_id = ${storeId} order by number`
const publish = async (storeId: string, n: number) => {
  const runId = runIdOf(await start(storeId, n))
  await uploaded(storeId, runId)
  expect(await runPublish(deps(), { runId, storeId }, steps)).toBe('live')
  return runId
}

describe('a publish', () => {
  it('goes queued → deploying → live, moves the pointer, numbers the version and purges the lookup', async () => {
    const runId = runIdOf(await start(t.storeA1, 1))
    expect(await runState(runId)).toEqual({ state: 'queued', error: null })
    expect((await publishQueue(t.storeA1)).map((r) => r.payload.runId)).toEqual([runId])
    await uploaded(t.storeA1, runId)
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, steps)).toBe('live')
    expect(await runState(runId)).toEqual({ state: 'live', error: null })
    expect(await live(t.storeA1)).toBe(runId)
    expect(await versions(t.storeA1)).toEqual([{ number: 1, state: 'live', build_id: runId }])
    const [store] = await db.sql<{ build_state: string; core_version: string }[]>`select build_state, core_version from store where id = ${t.storeA1}`
    expect(store).toEqual({ build_state: 'live', core_version: '1.0.0' })
    const purges = await db.sql<{ payload: { storeId: string } }[]>`select payload from outbox where kind = 'cache.purge' and idempotency_key like ${`%:publish:${runId}`}`
    expect(purges.map((p) => p.payload.storeId)).toEqual([t.storeA1])
    expect(sites.keys(stagingFolder(t.storeA1, runId))).toEqual([])
    const [entry] = await db.sql<{ action: string }[]>`select action from activity_log where store_id = ${t.storeA1} and action = 'storefront.published'`
    expect(entry?.action).toBe('storefront.published')
  })

  it('makes a second build live at once: the next lookup names it, and a replayed run changes nothing', async () => {
    const first = await live(t.storeA1)
    const second = await publish(t.storeA1, 2)
    expect(await lookupLiveHost(db.sql, shopsA1, { localhost: false })).toMatchObject({ storeId: t.storeA1, buildId: second })
    expect((await versions(t.storeA1)).map((v) => [v.number, v.state])).toEqual([
      [1, 'kept'],
      [2, 'live'],
    ])
    const [run] = await db.sql<{ previous_build_id: string }[]>`select previous_build_id from publish_run where id = ${second}`
    expect(run?.previous_build_id).toBe(first)
    expect(await runPublish(deps(), { runId: second, storeId: t.storeA1 }, steps)).toBe('stopped')
    expect((await versions(t.storeA1)).length).toBe(2)
  })

  it('queues a second publish during a run, keeps one waiting, and starts it once the first finishes', async () => {
    const first = runIdOf(await start(t.storeA2, 10))
    await uploaded(t.storeA2, first)
    await db.sql`update publish_run set state = 'deploying' where id = ${first}`
    const second = runIdOf(await start(t.storeA2, 11))
    expect(second).not.toBe(first)
    expect(runIdOf(await start(t.storeA2, 12))).toBe(second)
    expect((await publishQueue(t.storeA2)).map((r) => r.payload.runId)).toEqual([first])
    expect(await runState(second)).toMatchObject({ state: 'queued' })
    // The database itself refuses a second running build for a store.
    await expect(db.sql`update publish_run set state = 'deploying' where id = ${second}`).rejects.toThrow(/publish_run_one_running/)
    expect(await runPublish(deps(), { runId: first, storeId: t.storeA2 }, steps)).toBe('live')
    expect((await publishQueue(t.storeA2)).map((r) => r.payload.runId)).toEqual([first, second])
    await uploaded(t.storeA2, second)
    expect(await runPublish(deps(), { runId: second, storeId: t.storeA2 }, steps)).toBe('live')
    expect(await live(t.storeA2)).toBe(second)
  })

  it('fails a run that finds another running without changing what the console shows for the running one', async () => {
    const running = runIdOf(await start(t.storeA2, 20))
    await db.sql`update publish_run set state = 'deploying' where id = ${running}`
    await db.sql`update store set build_state = 'building' where id = ${t.storeA2}`
    const raced = runIdOf(await start(t.storeA2, 21))
    expect(await runPublish(deps(), { runId: raced, storeId: t.storeA2 }, steps)).toBe('failed')
    expect(await runState(raced)).toEqual({ state: 'failed', error: 'busy' })
    const [store] = await db.sql<{ build_state: string }[]>`select build_state from store where id = ${t.storeA2}`
    expect(store?.build_state).toBe('building')
    expect(await runPublish(deps(), { runId: running, storeId: t.storeA1 }, steps)).toBe('stopped')
    await db.sql`update publish_run set state = 'failed', error = 'deploy_failed' where id = ${running}`
  })

  it('fails without touching the live build when its files never arrived', async () => {
    const before = await live(t.storeA1)
    const runId = runIdOf(await start(t.storeA1, 3))
    await putText(sites, `${stagingFolder(t.storeA1, runId)}index.html`, 'staged')
    // Its report passed, then nothing was uploaded.
    await db.sql`update publish_run set state = 'deploying', started_at = now(), gate = ${db.sql.json({ passed: true, checks: [] })}, gate_digest = ${'d'.repeat(64)} where id = ${runId}`
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, steps)).toBe('failed')
    expect(await runState(runId)).toEqual({ state: 'failed', error: 'upload_timed_out' })
    expect(await live(t.storeA1)).toBe(before)
    expect(await lookupLiveHost(db.sql, shopsA1, { localhost: false })).toMatchObject({ buildId: before })
    expect(sites.keys(stagingFolder(t.storeA1, runId))).toEqual([])
    const [store] = await db.sql<{ build_state: string }[]>`select build_state from store where id = ${t.storeA1}`
    expect(store?.build_state).toBe('live')
  })
})

describe('go back', () => {
  it('moves the pointer to a kept build with no build of its own, and resets the draft and the store’s core version to it', async () => {
    // Version 2 was built on a newer core, so going back must bring the mirror back to version 1's.
    await db.sql`update design_version set core_version = '1.2.0' where store_id = ${t.storeA1} and number = 2`
    await db.sql`update store set core_version = '1.2.0' where id = ${t.storeA1}`
    const [v1] = await db.sql<{ id: string; build_id: string; commit: string }[]>`select id, build_id, commit from design_version where store_id = ${t.storeA1} and number = 1`
    const runsBefore = (await db.sql`select id from publish_run where store_id = ${t.storeA1}`).length
    expect(await goBack(db.sql, { storeId: t.storeA1, versionId: v1?.id ?? '', by: null, actor, now: new Date() })).toEqual({ ok: true })
    expect(await live(t.storeA1)).toBe(v1?.build_id)
    expect((await db.sql`select id from publish_run where store_id = ${t.storeA1}`).length).toBe(runsBefore)
    expect(await lookupLiveHost(db.sql, shopsA1, { localhost: false })).toMatchObject({ buildId: v1?.build_id })
    expect((await versions(t.storeA1)).map((v) => [v.number, v.state])).toEqual([
      [1, 'live'],
      [2, 'kept'],
    ])
    const [mirror] = await db.sql<{ core_version: string }[]>`select core_version from store where id = ${t.storeA1}`
    expect(mirror?.core_version).toBe('1.0.0')
    const [draft] = await db.sql<{ head_commit: string; base_version_id: string }[]>`select head_commit, base_version_id from design_draft where store_id = ${t.storeA1}`
    expect(draft).toEqual({ head_commit: v1?.commit, base_version_id: v1?.id })
    const [entry] = await db.sql<{ visibility: string }[]>`select visibility from activity_log where store_id = ${t.storeA1} and action = 'storefront.reverted'`
    expect(entry?.visibility).toBe('store')
  })

  it('refuses the live version, another store’s version, a version during a publish and one whose build is gone', async () => {
    const [v1, v2] = await db.sql<{ id: string; build_id: string }[]>`select id, build_id from design_version where store_id = ${t.storeA1} order by number`
    const back = (storeId: string, versionId: string) => goBack(db.sql, { storeId, versionId, by: null, actor, now: new Date() })
    expect(await back(t.storeA1, v1?.id ?? '')).toEqual({ ok: false, reason: 'ALREADY_LIVE' })
    expect(await back(t.storeA2, v2?.id ?? '')).toEqual({ ok: false, reason: 'NOT_FOUND' })
    const running = runIdOf(await start(t.storeA1, 4))
    await db.sql`update publish_run set state = 'deploying' where id = ${running}`
    expect(await back(t.storeA1, v2?.id ?? '')).toEqual({ ok: false, reason: 'PUBLISH_RUNNING' })
    await db.sql`update publish_run set state = 'failed', error = 'deploy_failed' where id = ${running}`
    await db.sql`update publish_run set files_deleted_at = now() where id = ${v2?.build_id ?? ''}`
    expect(await back(t.storeA1, v2?.id ?? '')).toEqual({ ok: false, reason: 'BUILD_GONE' })
    await db.sql`update publish_run set files_deleted_at = null where id = ${v2?.build_id ?? ''}`
    expect(await live(t.storeA1)).toBe(v1?.build_id)
  })
})

describe('the storefront.publish deliverer', () => {
  const effect = (payload: unknown): Effect => ({ id: 'e', kind: 'storefront.publish', idempotencyKey: 'k', payload, partnerId: null, storeId: null, attempt: 1 })

  it('starts one Workflow run per publish, named by the run', async () => {
    const made: string[] = []
    const workflow = { get: async (id: string) => (made.includes(id) ? ({} as never) : Promise.reject(new Error('none'))), create: async (o?: { id?: string }) => (made.push(o?.id ?? ''), {} as never) }
    const deliverer = storefrontPublishDeliverer(workflow)
    const params = { runId: crypto.randomUUID(), storeId: t.storeA1 }
    await deliverer.deliver(effect(params), new AbortController().signal)
    await deliverer.deliver(effect(params), new AbortController().signal)
    expect(made).toEqual([params.runId])
    await expect(deliverer.deliver(effect({ runId: 'x' }), new AbortController().signal)).rejects.toBeInstanceOf(GiveUp)
  })
})

describe('clean-up', () => {
  it(`keeps the last ${keptBuilds} builds, the live one and every one a version names, and deletes the rest everywhere`, async () => {
    const [store] = await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, status) values (${t.partnerA}, 'Builds', 'builds', 'active') returning id`
    const storeId = store?.id ?? ''
    const ids: string[] = []
    for (let n = 0; n < keptBuilds + 3; n++) ids.push(await publish(storeId, 100 + n))
    const [oldest, second, third] = ids
    // The oldest is named by a kept version; the next two are past the 20 and named by none.
    await db.sql`delete from design_version where store_id = ${storeId} and build_id in (${second ?? ''}, ${third ?? ''})`
    for (const id of ids) {
      await putText(assets, `${buildFolder(storeId, id)}assets/app.js`, 'js')
      await putText(drafts, sourceBundle(storeId, id), 'bundle')
      await putText(drafts, snapshotFile(storeId, id), '{}')
    }
    const failed = runIdOf(await start(storeId, 200))
    await putText(sites, `${stagingFolder(storeId, failed)}index.html`, 'staged')
    await db.sql`update publish_run set state = 'failed', error = 'deploy_failed' where id = ${failed}`
    await putText(sites, `${buildFolder(t.storeA1, (await live(t.storeA1)) ?? '')}keep.html`, 'other store')

    await cleanStorefronts(db.sql, { sites, assets, drafts }, new Date())
    const deleted = await db.sql<{ id: string }[]>`select id from publish_run where store_id = ${storeId} and files_deleted_at is not null`
    expect(deleted.map((r) => r.id).sort()).toEqual([second, third, failed].sort())
    for (const gone of [second, third]) {
      expect(sites.keys(buildFolder(storeId, gone ?? ''))).toEqual([])
      expect(assets.keys(buildFolder(storeId, gone ?? ''))).toEqual([])
      expect(drafts.keys(sourceBundle(storeId, gone ?? ''))).toEqual([])
      expect(drafts.keys(snapshotFile(storeId, gone ?? ''))).toEqual([])
    }
    expect(sites.keys(stagingFolder(storeId, failed))).toEqual([])
    for (const kept of [oldest, ...ids.slice(3)]) expect(sites.keys(buildFolder(storeId, kept ?? '')).length).toBeGreaterThan(0)
    expect(sites.keys(`stores/${t.storeA1}/`).length).toBeGreaterThan(0)
    // Done once: the next run finds nothing.
    expect(await cleanStorefronts(db.sql, { sites, assets, drafts }, new Date())).toMatchObject({ builds: 0 })
  })

  it('deletes preview folders a publish made old, never the current one or one written since', async () => {
    // A publish since the last clean-up is what makes a store's folders old.
    await publish(t.storeA1, 50)
    await publish(t.storeA2, 51)
    const published = (await db.sql<{ at: Date }[]>`select max(finished_at) as at from publish_run where store_id = ${t.storeA1} and state = 'live'`)[0]?.at ?? new Date()
    for (const ref of ['change-1', 'change-2', 'change-9', 'change-10']) await putText(sites, `${previewFolder(t.storeA1, ref)}index.html`, ref)
    await putText(sites, `${previewFolder(t.storeA2, 'change-1')}index.html`, 'theirs')
    const before = new Date(published.getTime() - 60_000)
    for (const ref of ['change-1', 'change-2', 'change-9']) sites.age(previewFolder(t.storeA1, ref), before)
    sites.age(previewFolder(t.storeA2, 'change-1'), before)
    sites.age(previewFolder(t.storeA1, 'change-10'), new Date(published.getTime() + 60_000))
    expect((await cleanStorefronts(db.sql, { sites, assets, drafts }, new Date())).previews).toBe(3)
    expect(sites.keys(`stores/${t.storeA1}/preview/`)).toEqual([`${previewFolder(t.storeA1, 'change-10')}index.html`, `${previewFolder(t.storeA1, 'change-9')}index.html`])
    // Store A2 has no draft, so none of its folders is current, and its publish made them old.
    expect(sites.keys(`stores/${t.storeA2}/preview/`)).toEqual([])
    // Each store is tidied once per publish: the next run doesn't list them again.
    await putText(sites, `${previewFolder(t.storeA1, 'change-3')}index.html`, 'old')
    sites.age(previewFolder(t.storeA1, 'change-3'), before)
    await cleanStorefronts(db.sql, { sites, assets, drafts }, new Date())
    expect(sites.keys(previewFolder(t.storeA1, 'change-3'))).toHaveLength(1)
  })

  it('logs one item that fails and goes on with the rest', async () => {
    const [store] = await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, status) values (${t.partnerA}, 'Flaky', 'flaky', 'active') returning id`
    const storeId = store?.id ?? ''
    const failedRuns: string[] = []
    for (const n of [300, 301]) {
      const id = runIdOf(await start(storeId, n))
      await db.sql`update publish_run set state = 'failed', error = 'deploy_failed', created_at = now() - interval '1 year' + ${`${n} seconds`}::interval where id = ${id}`
      failedRuns.push(id)
    }
    const [first, second] = failedRuns
    const broken = { ...drafts, delete: async (keys: string[]) => (keys.some((k) => k.includes(first ?? '-')) ? Promise.reject(new Error('r2 down')) : drafts.delete(keys)) }
    const lines: string[] = []
    const log = console.log
    console.log = (line: string) => void lines.push(line)
    try {
      await cleanStorefronts(db.sql, { sites, assets, drafts: broken }, new Date())
    } finally {
      console.log = log
    }
    const done = await db.sql<{ id: string }[]>`select id from publish_run where store_id = ${storeId} and files_deleted_at is not null`
    expect(done.map((r) => r.id)).toEqual([second])
    expect(lines.filter((l) => l.includes('storefront_cleanup_item_failed'))).toHaveLength(1)
  })

  it('erases a store closed for 90 days from all three buckets, once, and no other store', async () => {
    const [store] = await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, status, closed_at) values (${t.partnerA}, 'Gone', 'gone', 'closed', now() - interval '91 days') returning id`
    const [recent] = await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, status, closed_at) values (${t.partnerA}, 'Recent', 'recent', 'closed', now() - interval '10 days') returning id`
    for (const id of [store?.id ?? '', recent?.id ?? '']) {
      await putText(sites, `stores/${id}/builds/b/index.html`, 'x')
      await putText(assets, `stores/${id}/builds/b/assets/a.js`, 'x')
      await putText(drafts, draftBundle(id), 'x')
      await putText(drafts, sourceBundle(id, 'b'), 'x')
      await putText(drafts, snapshotFile(id, 'b'), 'x')
    }
    expect(await cleanStorefronts(db.sql, { sites, assets, drafts }, new Date())).toMatchObject({ stores: 1 })
    expect([sites.keys(`stores/${store?.id}/`), assets.keys(`stores/${store?.id}/`), drafts.keys(`drafts/${store?.id}`), drafts.keys(`sources/${store?.id}/`), drafts.keys(`snapshots/${store?.id}/`)]).toEqual([[], [], [], [], []])
    expect(sites.keys(`stores/${recent?.id}/`).length).toBe(1)
    expect(drafts.keys(`sources/${recent?.id}/`).length).toBe(1)
    expect(await cleanStorefronts(db.sql, { sites, assets, drafts }, new Date())).toMatchObject({ stores: 0 })
  })
})
