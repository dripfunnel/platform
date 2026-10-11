import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { digestOf, lookupLiveHost, lookupRedirect, runPublish, startPublish, type PublishDeps, type PublishSteps } from '#saas/storefronts/index'
import { buildFolder, stagingFolder } from '#saas/storefronts/layout'
import { createTestDatabase, type TestDatabase } from './support/database'
import { testProbe, type TestProbe } from './support/edgeProbe'
import { seedTenants, type Tenants } from './support/fixtures'
import { fakeSites, putText, type FakeSites } from './support/sites'

// Card #484 (INF 5): the post-deploy checks from the edge and the automatic rollback by moving the live pointer back
// (storefront LIVE-SHOP.md §4 step 10, ARCHITECTURE §4.2 steps 5–6).

let db: TestDatabase
let t: Tenants
let sites: FakeSites
let assets: FakeSites
let probe: TestProbe
let clock: number
const hostA1 = 'store-a1.shops.acme.example'
const commit = (n: number) => n.toString(16).padStart(40, '0')
const steps: PublishSteps = { do: (_, work) => work(), waitForUpload: async () => undefined }
// The checks' waits move this clock instead of sleeping.
const deps = (): PublishDeps => ({ sql: db.sql, sites, assets, now: () => new Date(clock), probe, wait: async (ms) => void (clock += ms) })

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set status = 'active' where id in (${t.storeA1}, ${t.storeA2})`
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  sites = fakeSites()
  assets = fakeSites()
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(() => {
  probe = testProbe(db.sql, { sites, assets })
  clock = Date.now()
})

const page = (runId: string, extra = '') => `<!doctype html><title>${runId}</title>${extra}`
const fullSite = (runId: string): Record<string, string> => ({
  'index.html': page(runId, `<script src="https://sf-assets.dripfunnel.com/stores/x/builds/${runId}/assets/app.js"></script>`),
  'products/blue-mug/index.html': page(runId),
  'checkout/index.html': page(runId),
})

/** A run that passed its gate and whose upload is staged, as #517's build calls leave it. */
const staged = async (storeId: string, n: number, files: Record<string, string> = {}) => {
  const started = await withSystemScope(db.sql, (tx) =>
    startPublish(tx, { storeId, kind: 'design', commit: commit(n), template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() }),
  )
  const runId = started.ok ? started.runId : ''
  const all = { ...fullSite(runId), ...files }
  const manifest = await Promise.all(Object.entries(all).map(async ([path, text]) => ({ path, sha256: await putText(sites, `${stagingFolder(storeId, runId)}${path}`, text), size: new TextEncoder().encode(text).length })))
  await putText(assets, `stores/x/builds/${runId}/assets/app.js`, 'console.log(1)')
  await db.sql`
    update publish_run set gate = ${db.sql.json({ passed: true, checks: [] })}, gate_digest = ${await digestOf(manifest)}, uploaded_at = now(),
      upload_manifest = ${db.sql.json({ files: manifest })} where id = ${runId}`
  return runId
}
const live = async (storeId: string) => (await db.sql<{ live_build_id: string | null }[]>`select live_build_id from storefront where store_id = ${storeId}`)[0]?.live_build_id ?? null
const runOf = async (id: string) =>
  (await db.sql<{ state: string; error: string | null; checks: { name: string; result: string }[] | null; rolled_back_at: Date | null }[]>`select state, error, checks, rolled_back_at from publish_run where id = ${id}`)[0]
const versions = (storeId: string) => db.sql<{ number: number; state: string; build_id: string }[]>`select number, state, build_id from design_version where store_id = ${storeId} order by number`
const publishLive = async (storeId: string, n: number) => {
  const runId = await staged(storeId, n)
  expect(await runPublish(deps(), { runId, storeId }, steps)).toBe('live')
  return runId
}

describe('the post-deploy checks', () => {
  it('pass on the edge’s answers from the new build and leave the run live with what they checked', async () => {
    const runId = await publishLive(t.storeA1, 1)
    const run = await runOf(runId)
    expect(run?.state).toBe('live')
    expect(run?.checks?.map((c) => [c.name, c.result])).toEqual([
      ['home', 'passed'],
      ['product', 'passed'],
      // The local stand-in doesn't reach the Shop API (docs/setup/local.md §6.1).
      ['cart', 'skipped'],
      ['checkout', 'passed'],
      ['payment', 'skipped'],
    ])
    expect(probe.gets).toContain(`https://sf-assets.dripfunnel.com/stores/x/builds/${runId}/assets/app.js`)
    const [entry] = await db.sql<{ changes: unknown }[]>`select changes from activity_log where store_id = ${t.storeA1} and action = 'storefront.published'`
    expect(entry?.changes).toEqual([{ field: 'version', before: null, after: '1', redacted: false }])
  })

  it('roll a switch whose checkout fails on the edge back to the previous build, which then serves', async () => {
    const previous = await live(t.storeA1)
    const runId = await staged(t.storeA1, 2)
    probe.breakPath(/^\/checkout$/, { status: 500 })
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, steps)).toBe('rolled_back')
    expect(await live(t.storeA1)).toBe(previous)
    expect(await lookupLiveHost(db.sql, hostA1, { localhost: false })).toMatchObject({ buildId: previous })
    expect(await runOf(runId)).toMatchObject({ state: 'rolled_back', error: 'check_checkout' })
    expect((await runOf(runId))?.checks?.find((c) => c.name === 'checkout')?.result).toBe('failed')
    expect((await versions(t.storeA1)).map((v) => [v.number, v.state, v.build_id])).toEqual([[1, 'live', previous]])
    const [store] = await db.sql<{ build_state: string }[]>`select build_state from store where id = ${t.storeA1}`
    expect(store?.build_state).toBe('live')
    const [entry] = await db.sql<{ changes: unknown; reason: string; result: string }[]>`select changes, reason, result from activity_log where store_id = ${t.storeA1} and action = 'storefront.rolled_back'`
    expect(entry).toEqual({ changes: [{ field: 'version', before: '2', after: '1', redacted: false }], reason: 'check_checkout', result: 'failed' })
    const purges = await db.sql`select 1 from outbox where kind = 'cache.purge' and idempotency_key like ${`%:rollback:${runId}`}`
    expect(purges).toHaveLength(1)
    // Its files stay for the repair loop; the build folder is never changed in place.
    expect(sites.keys(buildFolder(t.storeA1, runId)).length).toBeGreaterThan(0)
  })

  it('roll back once however often the step runs again', async () => {
    const previous = await live(t.storeA1)
    const rollbacks = async () => (await db.sql`select 1 from activity_log where store_id = ${t.storeA1} and action = 'storefront.rolled_back'`).length
    const before = await rollbacks()
    const runId = await staged(t.storeA1, 3)
    probe.breakPath(/^\/products\/blue-mug$/, { status: 404 })
    const replaying: PublishSteps = {
      ...steps,
      do: async (name, work) => {
        const first = await work()
        if (name === 'rollback') expect(await work()).toBe('rolled_back')
        return first
      },
    }
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, replaying)).toBe('rolled_back')
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, steps)).toBe('stopped')
    expect(await live(t.storeA1)).toBe(previous)
    expect(await rollbacks()).toBe(before + 1)
    expect(await db.sql`select 1 from outbox where kind = 'cache.purge' and idempotency_key like ${`%:rollback:${runId}`}`).toHaveLength(1)
  })

  it('fail a page whose script didn’t load', async () => {
    const runId = await staged(t.storeA1, 4)
    await assets.delete([`stores/x/builds/${runId}/assets/app.js`])
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, steps)).toBe('rolled_back')
    expect(await runOf(runId)).toMatchObject({ error: 'check_home' })
  })

  it('try a failure once more before it counts', async () => {
    const runId = await staged(t.storeA1, 5)
    let failures = 1
    const get = probe.get
    probe.get = async (url) => {
      const answer = await get(url)
      if (answer && new URL(url).pathname === '/checkout' && failures-- > 0) return { ...answer, status: 502 }
      return answer
    }
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, steps)).toBe('live')
    expect(await live(t.storeA1)).toBe(runId)
  })

  it('wait while the edge still serves the build before, and roll back once the two minutes pass', async () => {
    const previous = await live(t.storeA1)
    const runId = await staged(t.storeA1, 6)
    const started = clock
    probe.breakPath(/^\/$/, { build: previous })
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, steps)).toBe('rolled_back')
    expect(await runOf(runId)).toMatchObject({ state: 'rolled_back', error: 'check_home' })
    expect(clock - started).toBeGreaterThanOrEqual(110_000)
    expect(clock - started).toBeLessThanOrEqual(120_000)
    expect(await live(t.storeA1)).toBe(previous)
  })

  it('roll a run back, rather than fail it, when something breaks after its switch', async () => {
    const previous = await live(t.storeA1)
    const runId = await staged(t.storeA1, 7)
    const failing: PublishSteps = {
      ...steps,
      do: async (name, work) => {
        if (name === 'checks') await sites.delete([`${buildFolder(t.storeA1, runId)}_manifest.json`])
        return work()
      },
    }
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, failing)).toBe('rolled_back')
    expect(await runOf(runId)).toMatchObject({ state: 'rolled_back', error: 'build_missing' })
    expect(await live(t.storeA1)).toBe(previous)
  })

  it('roll a store’s first publish back to no build at all', async () => {
    await db.sql`insert into custom_domain (store_id, host, status, expected_cname, ownership_token) values (${t.storeA2}, 'shop.a2.example', 'live', 'x', 'y')`
    const runId = await staged(t.storeA2, 8)
    probe.breakPath(/^\/checkout$/, { status: 500 })
    expect(await runPublish(deps(), { runId, storeId: t.storeA2 }, steps)).toBe('rolled_back')
    expect(probe.gets[0]).toBe('https://shop.a2.example/')
    expect(await live(t.storeA2)).toBeNull()
    expect(await versions(t.storeA2)).toEqual([])
    const [store] = await db.sql<{ build_state: string }[]>`select build_state from store where id = ${t.storeA2}`
    expect(store?.build_state).toBe('failed')
  })

  it('skip a store with no address yet, which goes live', async () => {
    const runId = await staged(t.storeB1, 9)
    expect(await runPublish(deps(), { runId, storeId: t.storeB1 }, steps)).toBe('live')
    expect((await runOf(runId))?.checks).toEqual([{ name: 'home', result: 'skipped', detail: 'The store has no address yet.' }])
  })

  it('keep the next publish waiting until the checks end, and the switched run counts as running', async () => {
    const runId = await staged(t.storeA1, 10)
    const next: string[] = []
    const watching: PublishSteps = {
      ...steps,
      do: async (name, work) => {
        if (name === 'confirm') {
          const waiting = await withSystemScope(db.sql, (tx) =>
            startPublish(tx, { storeId: t.storeA1, kind: 'manual', commit: commit(11), template: 'linen', coreVersion: '1.0.0', usesAllowance: true, startedBy: { kind: 'system', id: null }, at: new Date() }),
          )
          next.push(waiting.ok ? waiting.runId : '')
          expect(await db.sql`select 1 from outbox where kind = 'storefront.publish' and payload->>'runId' = ${next[0] ?? ''}`).toHaveLength(0)
        }
        return work()
      },
    }
    expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, watching)).toBe('live')
    expect(await db.sql`select 1 from outbox where kind = 'storefront.publish' and payload->>'runId' = ${next[0] ?? ''}`).toHaveLength(1)
  })
})

describe('storefront_redirect', () => {
  const redirects = (storeId: string) =>
    db.sql<{ from_path: string; to_path: string; language: string | null }[]>`select from_path, to_path, language from storefront_redirect where store_id = ${storeId} order by from_path`
  const product = async (storeId: string, slug: string) =>
    (await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, ${slug}, ${slug}, 'visible') returning id`)[0]?.id ?? ''

  it('follows a product through renames with no chains, and drops the one away from an address that is live again', async () => {
    const id = await product(t.storeB1, 'mug')
    await db.sql`update product set slug = 'blue-mug' where id = ${id}`
    await db.sql`update product set slug = 'big-blue-mug' where id = ${id}`
    expect((await redirects(t.storeB1)).map((r) => [r.from_path, r.to_path])).toEqual([
      [`/products/blue-mug`, `/products/big-blue-mug`],
      [`/products/mug`, `/products/big-blue-mug`],
    ])
    await db.sql`update product set slug = 'mug' where id = ${id}`
    expect((await redirects(t.storeB1)).map((r) => [r.from_path, r.to_path])).toEqual([
      [`/products/big-blue-mug`, `/products/mug`],
      [`/products/blue-mug`, `/products/mug`],
    ])
    await db.sql`delete from storefront_redirect where store_id = ${t.storeB1}`
  })

  it('moves only the language whose translated address changed, and brings the main one back when it goes', async () => {
    await db.sql`insert into store_language (store_id, language, status, position) values (${t.storeB1}, 'hi-IN', 'active', 1)`
    const id = await product(t.storeB1, 'lamp')
    const translate = (text: string) => db.sql`
      insert into translation (store_id, entity, entity_id, field, language, text, source_hash) values (${t.storeB1}, 'product', ${id}, 'slug', 'hi-IN', ${text}, md5('lamp'))
      on conflict (store_id, entity, entity_id, field, language) do update set text = excluded.text`
    await translate('deepak')
    await translate('bada-deepak')
    await db.sql`update product set slug = 'desk-lamp' where id = ${id}`
    expect((await redirects(t.storeB1)).map((r) => [r.from_path, r.to_path])).toEqual(
      [
        ['/hi-in/products/deepak', '/hi-in/products/bada-deepak'],
        ['/hi-in/products/lamp', '/hi-in/products/bada-deepak'],
        [`/products/lamp`, `/products/desk-lamp`],
      ].sort((a, b) => ((a[0] ?? '') < (b[0] ?? '') ? -1 : 1)),
    )
    await db.sql`delete from translation where store_id = ${t.storeB1} and entity_id = ${id}`
    expect((await redirects(t.storeB1)).filter((r) => r.language === 'hi-IN').map((r) => [r.from_path, r.to_path])).toEqual([
      ['/hi-in/products/bada-deepak', '/hi-in/products/desk-lamp'],
      ['/hi-in/products/deepak', '/hi-in/products/desk-lamp'],
      ['/hi-in/products/lamp', '/hi-in/products/desk-lamp'],
    ])
  })

  it('answers the edge only for the store its host named, and only for a plain path', async () => {
    const [row] = await redirects(t.storeB1)
    expect(await lookupRedirect(db.sql, t.storeB1, row?.from_path ?? '')).toEqual({ to: row?.to_path })
    expect(await lookupRedirect(db.sql, t.storeA1, row?.from_path ?? '')).toEqual({ to: null })
    expect(await lookupRedirect(db.sql, t.storeB1, `${row?.from_path ?? ''}/../x`)).toEqual({ to: null })
    expect(await lookupRedirect(db.sql, 'not-a-store', '/x')).toEqual({ to: null })
  })

  it('is read by the store’s own merchant side only: never another store, a supplier, a partner or staff, and written by nobody', async () => {
    const as = (role: string, scope: string, storeId: string, sellerId: string, work: (tx: postgres.TransactionSql) => Promise<unknown>) =>
      db.sql.begin(async (tx: postgres.TransactionSql) => {
        await tx.unsafe(`set local role ${role}`)
        await tx`select set_config('app.scope', ${scope}, true)`
        await tx`select set_config('app.partner_id', ${t.partnerB}, true)`
        await tx`select set_config('app.store_id', ${storeId}, true)`
        await tx`select set_config('app.seller_id', ${sellerId}, true)`
        return work(tx)
      })
    const count = (role: string, scope: string, storeId: string, sellerId = '') =>
      as(role, scope, storeId, sellerId, async (tx) => (await tx`select 1 from storefront_redirect`).length)
    const total = (await redirects(t.storeB1)).length
    expect(total).toBeGreaterThan(0)
    expect(await count('app_request', 'store', t.storeB1)).toBe(total)
    expect(await count('app_request', 'store', t.storeA1)).toBe(0)
    expect(await count('app_request', 'store', t.storeB1, t.sellerB1)).toBe(0)
    await expect(count('app_partner', 'partner', t.storeB1)).rejects.toThrow(/permission denied/)
    await expect(count('app_platform', 'platform', t.storeB1)).rejects.toThrow(/permission denied/)
    await expect(as('app_request', 'store', t.storeB1, '', (tx) => tx`insert into storefront_redirect (store_id, from_path, to_path, reason) values (${t.storeB1}, '/a', '/b', 'renamed')`)).rejects.toThrow(/permission denied/)
    await expect(as('app_system', 'system', t.storeB1, '', (tx) => tx`delete from storefront_redirect`)).rejects.toThrow(/permission denied/)
  })
})
