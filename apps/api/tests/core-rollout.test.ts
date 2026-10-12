import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { activityLog } from '#saas/activity/index'
import { isAssigned } from '#auth/assignment'
import type { StaffMember, StaffRole } from '#auth/staff'
import { withSystemScope } from '#db/scoped/index'
import { recordCoreRelease } from '#db/scoped/coreReleases'
import { advanceRollouts, createFleetService, rolloutCapacity } from '#saas/fleet/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #485 part 3: a core rollout across the fleet (SAAS §10): canaries first, then waves sized to the org's Actions
// jobs, paused, resumed and rolled back from the Admin API by Engineer on call and Super admin, each audited.

let db: TestDatabase
let t: Tenants
const staff = new Map<StaffRole, StaffMember>()
const commit = (n: number) => n.toString(16).padStart(40, '0')
const image = (c: string) => `registry.cloudflare.com/acct123/storefront-build@sha256:${c.repeat(64)}`
const facts = { requestId: 'req-1', ip: '198.51.100.7', userAgent: 'test' }

const contextFor = (member: StaffMember | null): AdminContext => ({
  staff: member,
  isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target),
  staffActivity: null,
  partners: null,
  stores: null,
  provisioning: null,
  staffSessions: null,
  customers: null,
  staffMembers: null,
  dashboard: null,
  fleet: member ? createFleetService({ sql: db.sql, staff: member, activity: activityLog, facts, now: () => new Date() }) : null,
})

const run = async <T = Record<string, unknown>>(source: string, role: StaffRole | null, variables: Record<string, unknown> = {}) => {
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, variableValues: variables, contextValue: contextFor(role ? (staff.get(role) ?? null) : null) })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

type Rollout = { id: string; version: string; security: boolean; state: string; percent: number; stores: { state: string; count: number }[] }
const fields = 'id version security state percent stores { state count }'
const start = (version: string, security = false) => `mutation { startCoreRollout(version: "${version}", security: ${security}, reason: "Ship the checkout fix") { ${fields} } }`
const steer = (op: string) => `mutation($id: ID!, $r: String!) { ${op}(id: $id, reason: $r) { ${fields} } }`

/** A store live on 1.0.0 through a build of its own, so the rollout enrols it. */
const liveOn = async (storeId: string, version = '1.0.0') => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into publish_run (store_id, kind, state, commit, template, core_version, started_by_kind, switched_at, finished_at)
    values (${storeId}, 'design', 'live', ${commit(1)}, 'linen', ${version}, 'system', now(), now()) returning id`
  await db.sql`update design_version set state = 'kept' where store_id = ${storeId} and state = 'live'`
  await db.sql`insert into design_version (store_id, number, commit, template, core_version, build_id, published_at, state)
    select ${storeId}, coalesce(max(number), 0) + 1, ${commit(1)}, 'linen', ${version}, ${run?.id ?? ''}, now(), 'live' from design_version where store_id = ${storeId}`
  await db.sql`update storefront set live_build_id = ${run?.id ?? ''} where store_id = ${storeId}`
  return run?.id ?? ''
}

const tick = (actionsJobs = 2) => advanceRollouts(db.sql, { actionsJobs, now: new Date() })
const rolloutRow = async (id: string) => (await db.sql<{ state: string; percent: number; paused_state: string | null }[]>`select state, percent, paused_state from core_rollout where id = ${id}`)[0]
const storesOf = async (id: string) => db.sql<{ store_id: string; state: string; position: number; error: string | null }[]>`select store_id, state, position, error from core_rollout_store where rollout_id = ${id} order by position, store_id`
const queued = async (id: string) => (await db.sql<{ payload: { storeId: string } }[]>`select payload from outbox where kind = 'storefront.upgrade' and payload->>'rolloutId' = ${id} order by created_at`).map((o) => o.payload.storeId)
const end = (rolloutId: string, storeId: string, state: string) => db.sql`update core_rollout_store set state = ${state}, finished_at = now() where rollout_id = ${rolloutId} and store_id = ${storeId}`
const finishActive = () => db.sql`update core_rollout set state = 'done', paused_state = null, finished_at = now() where state in ('canary', 'waves', 'paused')`

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  for (const role of ['staff-super-admin', 'staff-engineer', 'staff-support', 'staff-read-only'] as const) {
    const [row] = await db.sql<{ id: string }[]>`insert into staff_user (sso_subject, email, name, role_key, status) values (${role}, ${`${role}@dripfunnel.example`}, ${role}, ${role}, 'active') returning id`
    staff.set(role, { id: row?.id ?? '', email: `${role}@dripfunnel.example`, name: role, role })
  }
  await withSystemScope(db.sql, async (tx) => {
    for (const [v, c] of [['1.0.0', 'a'], ['1.1.0', 'b'], ['1.2.0', 'c']] as const) await recordCoreRelease(tx, v, image(c))
  })
  for (const s of [t.storeA1, t.storeA2, t.storeB1]) await liveOn(s)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(async () => {
  await finishActive()
  await db.sql`update core_rollout_store set state = 'pinned' where state in ('pending', 'running')`
})

describe('the Admin API', () => {
  it('lets Engineer on call start, pause, resume and roll back a rollout, each audited with its reason', async () => {
    const started = await run<{ startCoreRollout: Rollout }>(start('1.1.0'), 'staff-engineer')
    const rollout = started.data?.startCoreRollout
    expect(rollout).toMatchObject({ version: '1.1.0', security: false, state: 'canary', percent: 0, stores: [] })
    const id = rollout?.id ?? ''
    expect((await run(start('1.2.0'), 'staff-super-admin')).code).toBe('ROLLOUT_ACTIVE')
    expect((await run<{ pauseCoreRollout: Rollout }>(steer('pauseCoreRollout'), 'staff-engineer', { id, r: 'Canary looks slow' })).data?.pauseCoreRollout.state).toBe('paused')
    expect((await run(steer('pauseCoreRollout'), 'staff-engineer', { id, r: 'Again' })).code).toBe('WRONG_STATE')
    expect((await run<{ resumeCoreRollout: Rollout }>(steer('resumeCoreRollout'), 'staff-engineer', { id, r: 'Fixed the runner' })).data?.resumeCoreRollout.state).toBe('canary')
    expect((await run<{ rollBackCoreRollout: Rollout }>(steer('rollBackCoreRollout'), 'staff-super-admin', { id, r: 'Checkout broke on canaries' })).data?.rollBackCoreRollout.state).toBe('rolled_back')
    expect((await run(steer('resumeCoreRollout'), 'staff-engineer', { id, r: 'No' })).code).toBe('WRONG_STATE')
    const entries = await db.sql<{ action: string; reason: string; actor_id: string; visibility: string }[]>`select action, reason, actor_id, visibility from activity_log where target_id = ${id} order by occurred_at, action`
    expect(entries.map((e) => [e.action, e.reason])).toEqual([
      ['core_rollout.started', 'Ship the checkout fix'],
      ['core_rollout.paused', 'Canary looks slow'],
      ['core_rollout.resumed', 'Fixed the runner'],
      ['core_rollout.rolled_back', 'Checkout broke on canaries'],
    ])
    expect(new Set(entries.map((e) => e.visibility))).toEqual(new Set(['staff']))
    const listed = await run<{ coreRollouts: { items: Rollout[] } }>('{ coreRollouts(first: 5) { items { id state } pageInfo { hasNextPage } } }', 'staff-engineer')
    expect(listed.data?.coreRollouts.items[0]).toMatchObject({ id, state: 'rolled_back' })
  })

  it('refuses everyone else, a missing reason, and a version never released', async () => {
    expect((await run(start('1.1.0'), 'staff-support')).code).toBe('FORBIDDEN')
    expect((await run('{ coreRollouts { items { id } } }', 'staff-read-only')).code).toBe('FORBIDDEN')
    expect((await run(start('1.1.0'), null)).code).toBe('UNAUTHENTICATED')
    expect((await run(start('9.9.9'), 'staff-engineer')).code).toBe('NOT_FOUND')
    expect((await run('mutation { startCoreRollout(version: "1.1.0", security: false, reason: " ") { id } }', 'staff-engineer')).code).toBe('INVALID_INPUT')
    expect(await db.sql`select 1 from core_rollout where state in ('canary', 'waves', 'paused')`).toHaveLength(0)
    expect((await run('{ coreRollout(id: "not-a-uuid") { id } }', 'staff-engineer')).data).toEqual({ coreRollout: null })
    expect((await run(steer('pauseCoreRollout'), 'staff-engineer', { id: 'not-a-uuid', r: 'Pause' })).code).toBe('NOT_FOUND')
  })
})

describe('the Admin API’s reads and a late roll back', () => {
  it('counts each listed rollout’s own stores, and keeps a finished rollout’s finish time when it is rolled back', async () => {
    const first = (await run<{ startCoreRollout: Rollout }>(start('1.1.0'), 'staff-engineer')).data?.startCoreRollout.id ?? ''
    await advanceRollouts(db.sql, { actionsJobs: 2, now: new Date() })
    const finished = new Date('2026-10-01T10:00:00Z')
    await db.sql`update core_rollout set state = 'done', finished_at = ${finished} where id = ${first}`
    const second = (await run<{ startCoreRollout: Rollout }>(start('1.2.0'), 'staff-engineer')).data?.startCoreRollout.id ?? ''
    const listed = await run<{ coreRollouts: { items: Rollout[] } }>(`{ coreRollouts(first: 25) { items { ${fields} } } }`, 'staff-engineer')
    const byId = new Map((listed.data?.coreRollouts.items ?? []).map((r) => [r.id, r.stores.reduce((n, s) => n + s.count, 0)]))
    expect(byId.get(first)).toBe(3)
    expect(byId.get(second)).toBe(0)
    await run(steer('rollBackCoreRollout'), 'staff-engineer', { id: first, r: 'Late regression' })
    expect(await db.sql`select state, finished_at from core_rollout where id = ${first}`).toEqual([{ state: 'rolled_back', finished_at: finished }])
  })
})

describe('the tick', () => {
  const begin = async (version: string, security = false) => {
    const started = await run<{ startCoreRollout: Rollout }>(start(version, security), 'staff-engineer')
    return started.data?.startCoreRollout.id ?? ''
  }

  it('sizes what runs at once to the Actions jobs: half for an upgrade, all of them for a security fix', () => {
    expect(rolloutCapacity(20, false)).toBe(10)
    expect(rolloutCapacity(20, true)).toBe(20)
    expect(rolloutCapacity(1, false)).toBe(1)
  })

  it('upgrades the canaries first, then each wave once the one before is done, then finishes', async () => {
    const id = await begin('1.1.0')
    await tick()
    // Every store live on an older core is enrolled; the three are all canaries in a fleet this small.
    expect((await storesOf(id)).map((s) => s.position)).toEqual([0, 0, 0])
    await db.sql`update core_rollout_store set position = case store_id when ${t.storeA2}::uuid then 5 when ${t.storeB1}::uuid then 60 else 0 end where rollout_id = ${id}`
    await db.sql`update core_rollout_store set state = 'pending', started_at = null where rollout_id = ${id}`
    await db.sql`delete from outbox where kind = 'storefront.upgrade'`
    await tick()
    // Two jobs: an upgrade takes one at a time.
    expect(await queued(id)).toEqual([t.storeA1])
    await tick()
    expect(await queued(id)).toEqual([t.storeA1])
    await end(id, t.storeA1, 'live')
    await tick()
    expect(await rolloutRow(id)).toMatchObject({ state: 'waves', percent: 10 })
    await tick()
    expect(await queued(id)).toEqual([t.storeA1, t.storeA2])
    await end(id, t.storeA2, 'pinned')
    await tick()
    await tick()
    await tick()
    expect(await rolloutRow(id)).toMatchObject({ state: 'waves', percent: 100 })
    await tick()
    expect(await queued(id)).toEqual([t.storeA1, t.storeA2, t.storeB1])
    await end(id, t.storeB1, 'live')
    await tick()
    expect(await rolloutRow(id)).toMatchObject({ state: 'done' })
    expect((await storesOf(id)).map((s) => s.state)).toEqual(['live', 'pinned', 'live'])
  })

  it('pauses itself when a canary is pinned, and starts nothing while paused', async () => {
    const id = await begin('1.1.0')
    await tick(10)
    expect((await storesOf(id)).filter((s) => s.state === 'running')).toHaveLength(3)
    await end(id, t.storeA1, 'pinned')
    await end(id, t.storeA2, 'live')
    await end(id, t.storeB1, 'live')
    await tick(10)
    expect(await rolloutRow(id)).toMatchObject({ state: 'paused', paused_state: 'canary' })
    const [alert] = await db.sql<{ reason: string; actor_kind: string }[]>`select reason, actor_kind from activity_log where target_id = ${id} and action = 'core_rollout.paused'`
    expect(alert).toMatchObject({ reason: 'canary_failed', actor_kind: 'job' })
    await tick(10)
    expect(await rolloutRow(id)).toMatchObject({ state: 'paused', paused_state: 'canary' })
    // Resumed, the engineer accepts the canaries as they ended: the waves begin, and it isn't paused again.
    expect((await run<{ resumeCoreRollout: Rollout }>(steer('resumeCoreRollout'), 'staff-engineer', { id, r: 'The pinned canary is a theme we know' })).data?.resumeCoreRollout).toMatchObject({ state: 'waves', percent: 10 })
    await tick(10)
    expect(await rolloutRow(id)).toMatchObject({ state: 'waves' })
    expect(await db.sql`select 1 from activity_log where target_id = ${id} and action = 'core_rollout.paused'`).toHaveLength(1)
  })

  it('lets a security fix take every job', async () => {
    const id = await begin('1.1.0', true)
    await tick(2)
    expect((await storesOf(id)).filter((s) => s.state === 'running')).toHaveLength(2)
  })

  it('puts back the stores a rolled-back rollout upgraded, leaves one that moved on, and drops a waiting major', async () => {
    const id = await begin('1.2.0')
    await tick(10)
    const before = new Map<string, string>()
    for (const s of [t.storeA1, t.storeA2]) {
      before.set(s, (await db.sql<{ live_build_id: string }[]>`select live_build_id from storefront where store_id = ${s}`)[0]?.live_build_id ?? '')
      const [upgrade] = await db.sql<{ id: string }[]>`
        insert into publish_run (store_id, kind, state, commit, template, core_version, started_by_kind, switched_at, finished_at, previous_build_id)
        values (${s}, 'upgrade', 'live', ${commit(2)}, 'linen', '1.2.0', 'system', now(), now(), ${before.get(s) ?? ''}) returning id`
      await db.sql`update design_version set state = 'kept' where store_id = ${s} and state = 'live'`
      await db.sql`insert into design_version (store_id, number, commit, template, core_version, build_id, published_at, state)
        select ${s}, max(number) + 1, ${commit(2)}, 'linen', '1.2.0', ${upgrade?.id ?? ''}, now(), 'live' from design_version where store_id = ${s}`
      await db.sql`update storefront set live_build_id = ${upgrade?.id ?? ''} where store_id = ${s}`
      await db.sql`update core_rollout_store set state = 'live', publish_run_id = ${upgrade?.id ?? ''} where rollout_id = ${id} and store_id = ${s}`
    }
    // Store A2 published again since: its own build stays.
    const moved = await liveOn(t.storeA2, '1.2.0')
    await db.sql`update core_rollout_store set state = 'passed' where rollout_id = ${id} and store_id = ${t.storeB1}`
    await db.sql`update storefront set core_upgrade_version = '1.2.0', core_upgrade_commit = ${commit(3)} where store_id = ${t.storeB1}`
    await run(steer('rollBackCoreRollout'), 'staff-engineer', { id, r: 'Bad release' })
    await tick()
    expect(await db.sql`select live_build_id from storefront where store_id = ${t.storeA1}`).toEqual([{ live_build_id: before.get(t.storeA1) }])
    expect(await db.sql`select live_build_id from storefront where store_id = ${t.storeA2}`).toEqual([{ live_build_id: moved }])
    expect(await db.sql`select core_upgrade_version from storefront where store_id = ${t.storeB1}`).toEqual([{ core_upgrade_version: null }])
    const rows = new Map((await storesOf(id)).map((s) => [s.store_id, [s.state, s.error]]))
    expect(rows.get(t.storeA1)).toEqual(['reverted', null])
    expect(rows.get(t.storeA2)).toEqual(['live', 'moved_on'])
    expect(rows.get(t.storeB1)).toEqual(['reverted', null])
    const [entry] = await db.sql<{ reason: string }[]>`select reason from activity_log where store_id = ${t.storeA1} and action = 'storefront.rolled_back'`
    expect(entry?.reason).toBe('core_rolled_back')
    // Nothing is left to put back, so the tick leaves the rollout alone.
    await tick()
    expect(await rolloutRow(id)).toMatchObject({ state: 'rolled_back' })
  })
})
