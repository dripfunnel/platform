import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { confirmLive, selectRun, startRun } from '#db/scoped/publishing'
import { autoPublishIntervalMs, pruneHistory, startAutomaticPublishes } from '#saas/storefronts/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'

// Card #318 (SAPI 17), part 4: catalogue changes waiting for a publish, "Publish now" with its monthly allowance, the
// automatic publish, the Storefront's meters and the history the plan keeps (SAAS §9.1–§9.2; FIRST-RELEASE §14).

let db: TestDatabase
let t: Tenants
let w: StoreWorld
let clock = Date.parse('2026-10-12T09:00:00.000Z')
const now = () => new Date((clock += 1000))
const liveRun: Record<string, string> = {}

const live = async (storeId: string) => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into publish_run (store_id, kind, state, commit, template, core_version, uses_allowance, started_by_kind, created_at, finished_at)
    values (${storeId}, 'design', 'live', ${'c'.repeat(40)}, 'linen', '1.0.0', false, 'system', now(), now()) returning id`
  await db.sql`update storefront set live_build_id = ${run?.id ?? null}, changes_since = null, changed_kinds = '{}', changed_count = 0 where store_id = ${storeId}`
  await db.sql`insert into design_version (store_id, number, commit, template, core_version, build_id, published_at, state) values (${storeId}, 1, ${'c'.repeat(40)}, 'linen', '1.0.0', ${run?.id ?? ''}, now(), 'live')`
  liveRun[storeId] = run?.id ?? ''
}
const product = (storeId: string, name: string) => db.sql`insert into product (store_id, name, slug, visibility) values (${storeId}, ${name}, ${`p-${crypto.randomUUID().slice(0, 8)}`}, 'visible')`
const catalogue = async (who: Who) => (await w.gql(who, '{ storefront { catalogue { waiting since changedKinds changedProducts pressesAllowed pressesLeft nextAutomaticPublishAt } } }')).data?.['storefront'] as { catalogue: Record<string, unknown> } | undefined
const press = (who: Who = 'owner') => w.gql(who, 'mutation { publishNow }')
const usage = async (storeId: string, key: string) => (await db.sql<{ used: number }[]>`select used from store_usage where store_id = ${storeId} and key = ${key}`)[0]?.used ?? 0
/** The publish-storefront Workflow's claim and its end live, as the pipeline would (publish.ts). */
const goLive = async (runId: string) =>
  withSystemScope(db.sql, async (tx) => {
    const run = await selectRun(tx, runId)
    if (!run) throw new Error('no run')
    await startRun(tx, run, new Date())
    await tx`update publish_run set state = 'deploying', switched_at = now() where id = ${runId}`
    await confirmLive(tx, run, new Date())
  })
const claim = async (runId: string) =>
  withSystemScope(db.sql, async (tx) => {
    const run = await selectRun(tx, runId)
    if (run) await startRun(tx, run, new Date())
  })

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, { now, secrets: null, lookup: null })
  await db.sql`update store set status = 'active' where id in (${t.storeA1}, ${t.storeA2}, ${t.storeB1})`
  for (const [key, amount] of [['publish_now', 2], ['history_days', 30], ['ai_mode', 1], ['ai_prompts', 10]] as const) {
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, ${key}, ${amount} from store where plan_id is not null`
  }
  await live(t.storeA1)
  await live(t.storeB1)
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('catalogue changes waiting', () => {
  it('are marked by what changed, for that store only', async () => {
    expect((await catalogue('owner'))?.catalogue).toMatchObject({ waiting: false, changedKinds: [], pressesAllowed: 2, pressesLeft: 2, nextAutomaticPublishAt: null })
    await product(t.storeA1, 'Kurta')
    await product(t.storeA1, 'Dupatta')
    await db.sql`insert into collection (store_id, name, slug, kind) values (${t.storeA1}, 'Linen', 'linen', 'manual')`
    await db.sql`insert into menu (store_id, key, name) values (${t.storeA1}, 'main', 'Main') on conflict (store_id, key) do update set name = 'Main menu'`
    await db.sql`insert into storefront_content (store_id, kind, slug, title, status) values (${t.storeA1}, 'page', 'faq', 'FAQ', 'published')`
    await db.sql`update store set description = 'Handwoven linen' where id = ${t.storeA1}`
    const read = (await catalogue('manager'))?.catalogue
    expect(read).toMatchObject({ waiting: true, changedProducts: 2 })
    expect([...((read?.['changedKinds'] as string[] | undefined) ?? [])].sort()).toEqual(['collections', 'content', 'menus', 'products', 'settings'])
    expect(read?.['nextAutomaticPublishAt']).toBe(new Date(Date.parse(String(read?.['since'])) + autoPublishIntervalMs).toISOString())
    expect((await catalogue('bOwner'))?.catalogue).toMatchObject({ waiting: false })
    for (const who of ['staff', 'supplier'] as const) expect((await w.gql(who, '{ storefront { catalogue { waiting } } }')).code).toBe('FORBIDDEN')
  })
})

describe('Publish now', () => {
  it('rebuilds the live code with one of the month’s presses, counted only once live; a failed one never counts', async () => {
    expect((await press('manager')).code).toBe('FORBIDDEN')
    expect((await press('a2Owner')).code).toBe('NOTHING_LIVE')
    const first = await press()
    const runId = first.data?.['publishNow'] as string
    expect(await db.sql`select kind, uses_allowance, commit from publish_run where id = ${runId}`).toEqual([{ kind: 'manual', uses_allowance: true, commit: 'c'.repeat(40) }])
    // Queued, it holds a press.
    expect((await catalogue('owner'))?.catalogue).toMatchObject({ pressesLeft: 1 })
    await db.sql`update publish_run set state = 'failed' where id = ${runId}`
    expect((await catalogue('owner'))?.catalogue).toMatchObject({ pressesLeft: 2, waiting: true })
    expect(await usage(t.storeA1, 'publish_now')).toBe(0)
    const second = (await press()).data?.['publishNow'] as string
    await goLive(second)
    expect(await usage(t.storeA1, 'publish_now')).toBe(1)
    expect((await catalogue('owner'))?.catalogue).toMatchObject({ waiting: false, changedKinds: [], changedProducts: 0, pressesLeft: 1 })
    expect((await press()).code).toBe('NOTHING_WAITING')
    const [entry] = await db.sql<{ changes: unknown }[]>`select changes from activity_log where store_id = ${t.storeA1} and action = 'storefront.publish_started' order by occurred_at desc limit 1`
    expect(entry?.changes).toEqual([expect.objectContaining({ field: 'publish', after: 'manual' })])
  })

  it('keeps the marks when a change comes while the publish builds, and refuses past the allowance', async () => {
    await product(t.storeA1, 'Shawl')
    const runId = (await press()).data?.['publishNow'] as string
    await claim(runId)
    await product(t.storeA1, 'Stole')
    await withSystemScope(db.sql, async (tx) => {
      await tx`update publish_run set state = 'deploying', switched_at = now() where id = ${runId}`
      const run = await selectRun(tx, runId)
      if (run) await confirmLive(tx, run, new Date())
    })
    expect((await catalogue('owner'))?.catalogue).toMatchObject({ waiting: true, pressesLeft: 0 })
    expect((await press()).code).toBe('NO_PRESSES_LEFT')
  })
})

describe('the automatic publish', () => {
  it('runs only for stores with changes waiting past the interval, using no press, once', async () => {
    await product(t.storeB1, 'B product')
    await db.sql`update storefront set changes_since = now() - interval '2 days', next_auto_publish_at = null where store_id = ${t.storeA1}`
    const runs = async (storeId: string) => db.sql<{ kind: string; uses_allowance: boolean; state: string }[]>`select kind, uses_allowance, state from publish_run where store_id = ${storeId} and kind = 'automatic'`
    expect(await startAutomaticPublishes(db.sql, new Date())).toBe(1)
    expect(await runs(t.storeA1)).toEqual([{ kind: 'automatic', uses_allowance: false, state: 'queued' }])
    // B1's change is newer than the interval; A2 has no live build and no changes.
    expect(await runs(t.storeB1)).toEqual([])
    expect(await runs(t.storeA2)).toEqual([])
    expect(await startAutomaticPublishes(db.sql, new Date())).toBe(0)
    expect(await startAutomaticPublishes(db.sql, new Date(Date.now() + 2 * autoPublishIntervalMs))).toBe(1)
    expect(await runs(t.storeB1)).toHaveLength(1)
  })

})

describe('the meters and the history', () => {
  it('count the month’s requests and tokens, never a repair, the store’s build minutes and publishes, and the last five requests', async () => {
    const run = async (kind: string, billed: string, prompt: string, parent: string | null = null) =>
      (await db.sql<{ id: string }[]>`
        insert into ai_run (store_id, kind, requested_by, prompt, model, tokens_in, tokens_out, cost_amount, cost_currency, billed_to, repair_attempts, parent_run_id, outcome)
        values (${t.storeA1}, ${kind}, ${kind === 'repair' ? null : w.people.owner}, ${prompt}, 'm', 100, 50, 1, 'USD', ${billed}, 0, ${parent}, 'changed') returning id`)[0]?.id ?? null
    const first = await run('design', 'plan', 'Warmer colours')
    await run('repair', 'platform', 'repair', first)
    for (const n of [1, 2, 3, 4, 5]) await run('design', 'plan', `Request ${n}`)
    await db.sql`update publish_run set build_minutes = 3 where id = ${liveRun[t.storeA1] ?? ''}`
    const read = await w.gql('manager', '{ storefront { usage { ownKey aiRequests aiTokens aiPromptsAllowed buildMinutes publishesLast30Days recent { text outcome tokens } } } }')
    const u = (read.data?.['storefront'] as { usage: { aiRequests: number; aiTokens: number; recent: { text: string }[] } & Record<string, unknown> }).usage
    expect(u).toMatchObject({ ownKey: false, aiRequests: 6, aiTokens: 900, aiPromptsAllowed: 10, buildMinutes: 3 })
    expect(u['publishesLast30Days']).toBeGreaterThanOrEqual(2)
    expect(u.recent.map((r) => r.text)).toEqual(['Request 5', 'Request 4', 'Request 3', 'Request 2', 'Request 1'])
    const other = await w.gql('bOwner', '{ storefront { usage { aiRequests recent { text } } } }')
    expect((other.data?.['storefront'] as { usage: unknown }).usage).toEqual({ aiRequests: 0, recent: [] })
  })

  it('keeps the plan’s days of versions, and the live one always', async () => {
    const add = async (number: number, ageDays: number, state: string) => {
      const [run] = await db.sql<{ id: string }[]>`
        insert into publish_run (store_id, kind, state, commit, template, core_version, uses_allowance, started_by_kind, created_at)
        values (${t.storeA2}, 'design', 'live', ${'d'.repeat(40)}, 'linen', '1.0.0', false, 'system', now()) returning id`
      await db.sql`insert into design_version (store_id, number, commit, template, core_version, build_id, published_at, state)
        values (${t.storeA2}, ${number}, ${'d'.repeat(40)}, 'linen', '1.0.0', ${run?.id ?? ''}, now() - make_interval(days => ${ageDays}), ${state})`
    }
    await add(1, 90, 'live')
    await add(2, 60, 'kept')
    await add(3, 10, 'kept')
    await pruneHistory(db.sql, new Date())
    expect((await db.sql<{ number: number }[]>`select number from design_version where store_id = ${t.storeA2} order by number`).map((v) => v.number)).toEqual([1, 3])
    // Other stores' recent versions stay.
    expect(await db.sql`select 1 from design_version where store_id = ${t.storeA1}`).toHaveLength(1)
    // A partner's override raising the days keeps what the plan's 30 alone would prune (SAAS §6.4).
    await add(4, 45, 'kept')
    await db.sql`insert into store_limit_override (store_id, key, amount, duration, reason, created_by_kind, created_by_label, created_at)
      values (${t.storeA2}, 'history_days', 365, 'always', 'Keeps a year', 'partner_user', 'Partner', now())`
    await pruneHistory(db.sql, new Date())
    expect((await db.sql<{ number: number }[]>`select number from design_version where store_id = ${t.storeA2} order by number`).map((v) => v.number)).toEqual([1, 3, 4])
  })
})
