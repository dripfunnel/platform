import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { isAssigned } from '#auth/assignment'
import type { StaffMember, StaffRole } from '#auth/staff'
import { factsOf } from '#auth/activity'
import type { ProvisioningStep } from '#db/schema/saas'
import { pgArray, withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createProvisioningService } from '#saas/provisioning/index'
import { createStorefrontParams, runCreateStorefront, runUndoStorefront, startStorefront, storefrontCreateKind, storefrontUndoKind, type StepRunner } from '#saas/storefronts/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'
import { createDepsFor } from './support/storefrontCreate'

// Card #37: Provisioning on the Admin API. Retry and Undo run a failed create-storefront job (#730); a
// provision-store job has no executor, so they answer NO_EXECUTOR once every other check passes.

let db: TestDatabase
const now = new Date('2026-10-02T12:00:00Z')
const staffByRole = new Map<StaffRole, StaffMember>()
const jobs = { failed: '', stuck: '', running: '', own: '', done: '' }
const secret = 'ghs_abcdefghijklmnopqrstuvwxyz0123456789'

const request = new Request('https://admin.dripfunnel.com/api', { headers: { 'cf-ray': 'ray-test', 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'test' } })
const provisioningFor = (staff: StaffMember) =>
  createProvisioningService({ sql: db.sql, staff, facts: factsOf(request), activity: activityLog, now: () => now })

const contextFor = (staff: StaffMember | null): AdminContext => ({
  staff,
  isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target),
  staffActivity: null,
  partners: null,
  stores: null,
  provisioning: staff ? provisioningFor(staff) : null,
  staffSessions: null,
  customers: null,
  staffMembers: null,
  dashboard: null,
})

const run = async <T = Record<string, unknown>>(source: string, staff: StaffMember | null, variables: Record<string, unknown> = {}) => {
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, variableValues: variables, contextValue: contextFor(staff) })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined, raw: JSON.stringify(result) }
}

const as = (role: StaffRole): StaffMember => {
  const s = staffByRole.get(role)
  if (!s) throw new Error(`no seeded staff with role ${role}`)
  return s
}

const list = `query($f: ProvisioningFilter, $after: String, $before: String, $first: Int) { provisioningJobs(filter: $f, after: $after, before: $before, first: $first) {
  items { id state steps step attempts error details store { code } actions { retry { allowed reason } undo { allowed reason } } }
  pageInfo { startCursor endCursor hasNextPage hasPreviousPage } partners { id } } }`
type Job = { id: string; state: string; steps: string[]; step: string; error: string | null; details: string | null; actions: { retry: { allowed: boolean; reason: string | null } | null; undo: { allowed: boolean; reason: string | null } | null } }
type Page = { provisioningJobs: { items: Job[]; pageInfo: { startCursor: string; endCursor: string; hasNextPage: boolean; hasPreviousPage: boolean } } }
const retry = `mutation($id: ID!) { retryJob(id: $id) { ok code } }`
const undo = `mutation($id: ID!, $r: String!) { undoJob(id: $id, reason: $r) { ok code } }`

/** A newer job for a seeded store, so it is that store's latest. */
const job = async (code: string, fields: { state: string; steps: string[]; step: string; minutesAgo: number; error?: string; details?: string }) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into job (store_id, kind, state, steps, step, step_started_at, started_at, attempts, last_error)
    select id, 'provision-store', ${fields.state}, ${`{${fields.steps.join(',')}}`}::text[], ${fields.step}, ${new Date(now.getTime() - fields.minutesAgo * 60_000)}, ${new Date(now.getTime() - fields.minutesAgo * 60_000 + 1)}, 2, ${fields.error ?? null}
    from store where code = ${code} returning id`
  if (!row) throw new Error(`no store ${code}`)
  if (fields.details) await db.sql`insert into job_detail (job_id, details) values (${row.id}, ${fields.details})`
  return row.id
}

const eight = ['accountAndStore', 'defaults', 'hostnames', 'repo', 'storeConfig', 'hostingTarget', 'firstBuild', 'done']

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  const rows = await db.sql<{ id: string; email: string; name: string; role_key: StaffRole }[]>`select id, email, name, role_key from staff_user order by created_at`
  for (const r of rows) if (!staffByRole.has(r.role_key)) staffByRole.set(r.role_key, { id: r.id, email: r.email, name: r.name, role: r.role_key })
  const codes = (await db.sql<{ code: string }[]>`select code from store order by created_at limit 5`).map((r) => r.code)
  jobs.failed = await job(codes[0] ?? '', { state: 'failed', steps: eight, step: 'repo', minutesAgo: 30, error: `git push https://x-access-token:${secret}@github.com/o/r.git failed`, details: `HTTP 401 Authorization: Bearer ${secret}` })
  jobs.stuck = await job(codes[1] ?? '', { state: 'running', steps: eight, step: 'defaults', minutesAgo: 10 })
  jobs.running = await job(codes[2] ?? '', { state: 'running', steps: eight, step: 'firstBuild', minutesAgo: 10 })
  jobs.own = await job(codes[3] ?? '', { state: 'failed', steps: ['accountAndStore', 'defaults', 'hostnames'], step: 'hostnames', minutesAgo: 5 })
  jobs.done = await job(codes[4] ?? '', { state: 'done', steps: eight, step: 'done', minutesAgo: 1 })
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the list', () => {
  it('lists each store’s latest unfinished job with its own steps, stuck by a limit per step, never a finished one', async () => {
    const items = (await run<Page>(list, as('staff-support'), { first: 100 })).data?.provisioningJobs.items ?? []
    const byId = new Map(items.map((j) => [j.id, j]))
    expect(byId.get(jobs.failed)?.state).toBe('failed')
    expect(byId.get(jobs.stuck)?.state).toBe('stuck')
    expect(byId.get(jobs.running)?.state).toBe('running')
    expect(byId.get(jobs.own)?.steps).toEqual(['accountAndStore', 'defaults', 'hostnames'])
    expect(byId.has(jobs.done)).toBe(false)
    expect(items.every((j) => j.state !== 'done')).toBe(true)
  })

  it('never returns a secret a provider echoed into an error or its details', async () => {
    const response = await run<Page>(list, as('staff-engineer'), { first: 100 })
    expect(response.raw).not.toContain(secret)
    const failed = response.data?.provisioningJobs.items.find((j) => j.id === jobs.failed)
    expect(failed?.error).toContain('[redacted]')
    expect(failed?.details).toMatch(/^HTTP 401 Authorization: .*\[redacted\]/)
  })

  it('filters by status, step and search, and pages forward then back onto the same rows', async () => {
    const support = as('staff-support')
    const ids = async (f: Record<string, unknown>) => ((await run<Page>(list, support, { f, first: 100 })).data?.provisioningJobs.items ?? []).map((j) => j.id)
    expect(await ids({ status: 'stuck' })).toContain(jobs.stuck)
    expect(await ids({ status: 'stuck' })).not.toContain(jobs.running)
    expect(await ids({ status: 'running' })).toContain(jobs.running)
    expect(await ids({ step: 'firstBuild' })).toEqual(expect.arrayContaining([jobs.running]))
    expect((await run(list, support, { f: { status: 'done' } })).code).toBe('INVALID_INPUT')
    const first = (await run<Page>(list, support, { first: 2 })).data?.provisioningJobs
    const second = (await run<Page>(list, support, { first: 2, after: first?.pageInfo.endCursor })).data?.provisioningJobs
    expect(second?.pageInfo.hasPreviousPage).toBe(true)
    const back = (await run<Page>(list, support, { first: 2, before: second?.pageInfo.startCursor })).data?.provisioningJobs
    expect(back?.items.map((j) => j.id)).toEqual(first?.items.map((j) => j.id))
  })

  it('is closed to the roles that cannot open Provisioning', async () => {
    for (const role of ['staff-finance', 'staff-read-only', 'staff-partner-manager'] as StaffRole[]) {
      if (staffByRole.has(role)) expect((await run(list, as(role))).code, role).toBe('FORBIDDEN')
    }
  })
})

describe('retry and undo', () => {
  it('says what each role may do on each job, as the store’s tab does', async () => {
    const items = (await run<Page>(list, as('staff-support'), { first: 100 })).data?.provisioningJobs.items ?? []
    const of = (id: string) => items.find((j) => j.id === id)?.actions
    expect(of(jobs.failed)).toEqual({ retry: { allowed: true, reason: null }, undo: { allowed: false, reason: 'CLEANERS_ONLY' } })
    expect(of(jobs.stuck)).toEqual({ retry: { allowed: true, reason: null }, undo: null })
    expect(of(jobs.running)).toEqual({ retry: { allowed: false, reason: 'JOB_RUNNING' }, undo: { allowed: false, reason: 'JOB_RUNNING' } })
  })

  it('refuses with NO_EXECUTOR once every check passes, changes nothing however often it is asked, and refuses the role, a running job and an undo without a reason', async () => {
    const engineer = as('staff-engineer')
    const [before] = await db.sql<{ state: string; attempts: number }[]>`select state, attempts from job where id = ${jobs.failed}`
    for (let i = 0; i < 2; i += 1) {
      expect((await run<{ retryJob: unknown }>(retry, engineer, { id: jobs.failed })).data?.retryJob).toEqual({ ok: false, code: 'NO_EXECUTOR' })
      expect((await run<{ undoJob: unknown }>(undo, engineer, { id: jobs.failed, r: 'Owner asked to start again' })).data?.undoJob).toEqual({ ok: false, code: 'NO_EXECUTOR' })
    }
    const [after] = await db.sql<{ state: string; attempts: number }[]>`select state, attempts from job where id = ${jobs.failed}`
    expect(after).toEqual(before)
    expect((await run<{ retryJob: unknown }>(retry, engineer, { id: jobs.running })).data?.retryJob).toEqual({ ok: false, code: 'JOB_RUNNING' })
    expect((await run<{ undoJob: unknown }>(undo, engineer, { id: jobs.stuck, r: 'x' })).data?.undoJob).toEqual({ ok: false, code: 'NOT_FAILED' })
    expect((await run<{ undoJob: unknown }>(undo, engineer, { id: jobs.failed, r: '  ' })).data?.undoJob).toEqual({ ok: false, code: 'REASON_REQUIRED' })
    expect((await run(undo, as('staff-support'), { id: jobs.failed, r: 'x' })).code).toBe('FORBIDDEN')
    expect((await run<{ retryJob: unknown }>(retry, engineer, { id: jobs.done })).data?.retryJob).toEqual({ ok: false, code: 'NOT_FOUND' })
  })

  it('reports a started job’s progress, and nothing once it has finished', async () => {
    const progress = `query($id: ID!) { provisioningJob(id: $id) { id state step } }`
    expect((await run<{ provisioningJob: unknown }>(progress, as('staff-support'), { id: jobs.stuck })).data?.provisioningJob).toEqual({ id: jobs.stuck, state: 'stuck', step: 'defaults' })
    expect((await run<{ provisioningJob: unknown }>(progress, as('staff-support'), { id: jobs.done })).data?.provisioningJob).toBeNull()
  })
})

// #730: a failed create-storefront job is retried or undone through the outbox, never inside the request.
describe('retry and undo of a failed create-storefront job', () => {
  const once: StepRunner = { do: (_, work) => work() }
  const stores = { a: { id: '', partner: '' }, b: { id: '', partner: '' } }
  const engineer = () => as('staff-engineer')
  const outboxOf = async (kind: string, storeId: string) =>
    db.sql<{ payload: { storeId: string; jobId: string; template: string }; idempotency_key: string }[]>`select payload, idempotency_key from outbox where kind = ${kind} and store_id = ${storeId} order by created_at`
  const jobsOf = async (storeId: string) =>
    db.sql<{ id: string; state: string }[]>`select id, state from job where store_id = ${storeId} and kind = 'create-storefront' order by started_at, id`
  const activityOf = async (storeId: string, action: string) =>
    db.sql<{ actor_kind: string; actor_label: string; reason: string | null; partner_id: string }[]>`select actor_kind, actor_label, reason, partner_id from activity_log where store_id = ${storeId} and action = ${action} order by occurred_at`

  const reset = async (storeId: string) => {
    await db.sql`delete from job_detail where job_id in (select id from job where store_id = ${storeId} and kind = 'create-storefront')`
    await db.sql`delete from job where store_id = ${storeId} and kind = 'create-storefront'`
    await db.sql`delete from outbox where store_id = ${storeId} and kind in (${storefrontCreateKind}, ${storefrontUndoKind})`
    await db.sql`delete from activity_log where store_id = ${storeId} and action in ('job.retried', 'job.undone')`
    await db.sql`delete from design_draft where store_id = ${storeId}`
    await db.sql`delete from storefront_push where store_id = ${storeId}`
    await db.sql`update storefront set repo = null, repo_id = null, repo_state = 'none', repo_head = null, template = null where store_id = ${storeId}`
    await db.sql`update store set storefront_kind = 'ai', core_version = null where id = ${storeId}`
  }

  /** The store's template pick, run until `failAt` stops it: the job ends failed with everything undone. */
  const failedAt = async (storeId: string, step: ProvisioningStep | null, world: Awaited<ReturnType<typeof createDepsFor>>) => {
    const started = await withSystemScope(db.sql, (tx) => startStorefront(tx, storeId, 'bloom', now))
    if (!started.ok) throw new Error(`start refused: ${started.code}`)
    const params = { storeId, jobId: started.jobId, template: 'bloom' }
    const result = await runCreateStorefront({ ...world.deps, failAt: (at) => { if (at === step) throw new Error('boom') } }, params, once)
    // The test clock is fixed, so a later job would tie with this one on its start time.
    await db.sql`update job set started_at = started_at - interval '1 hour' where id = ${params.jobId}`
    return { params, result }
  }

  /** What the Retry's new job asked the Workflow for, run to the end. */
  const runQueued = async (storeId: string, world: Awaited<ReturnType<typeof createDepsFor>>) => {
    const queued = await outboxOf(storefrontCreateKind, storeId)
    const last = queued.at(-1)
    if (!last) throw new Error('nothing queued')
    return runCreateStorefront(world.deps, createStorefrontParams.parse(last.payload), once)
  }

  beforeAll(async () => {
    const rows = await db.sql<{ id: string; partner_id: string }[]>`
      select distinct on (s.partner_id) s.id, s.partner_id from store s join storefront f on f.store_id = s.id
      where s.id not in (select store_id from job where id = any(${pgArray([jobs.failed, jobs.stuck, jobs.running, jobs.own, jobs.done])}::uuid[])) order by s.partner_id, s.id`
    const [a, b] = rows
    if (!a || !b) throw new Error('the seed needs two partners with a store each')
    stores.a = { id: a.id, partner: a.partner_id }
    stores.b = { id: b.id, partner: b.partner_id }
  })

  it('retries a failed job: one new job under the same template, however often it is asked, and a store with exactly one repo', async () => {
    await reset(stores.a.id)
    const world = await createDepsFor(db.sql, () => now)
    const { params, result } = await failedAt(stores.a.id, 'storeConfig', world)
    expect(result).toBe('undone')
    expect(world.github.repos.size).toBe(0)

    for (let i = 0; i < 2; i += 1) expect((await run<{ retryJob: unknown }>(retry, engineer(), { id: params.jobId })).data?.retryJob).toEqual({ ok: true, code: null })

    const jobs = await jobsOf(stores.a.id)
    expect(jobs.map((j) => j.state)).toEqual(['failed', 'running'])
    const queued = await outboxOf(storefrontCreateKind, stores.a.id)
    expect(queued.map((q) => q.payload.template)).toEqual(['bloom', 'bloom'])
    expect(queued.at(-1)?.payload.jobId).toBe(jobs[1]?.id)

    expect(await runQueued(stores.a.id, world)).toBe('created')
    expect(world.github.repos.size).toBe(1)
    expect(await activityOf(stores.a.id, 'job.retried')).toEqual([expect.objectContaining({ actor_kind: 'staff', reason: null, partner_id: stores.a.partner, actor_label: expect.stringContaining(engineer().email) })])
  })

  it.each(['repo', 'storeConfig', 'hostingTarget', 'firstBuild', 'done'] as const)('leaves exactly one repo when it fails at %s and is retried', async (step) => {
    await reset(stores.a.id)
    const world = await createDepsFor(db.sql, () => now)
    const { params, result } = await failedAt(stores.a.id, step, world)
    expect(result).toBe('undone')
    expect(world.github.repos.size).toBe(0)
    expect((await run<{ retryJob: unknown }>(retry, engineer(), { id: params.jobId })).data?.retryJob).toEqual({ ok: true, code: null })
    expect(await runQueued(stores.a.id, world)).toBe('created')
    expect(world.github.repos.size).toBe(1)
  })

  it('undoes a failed job: the repo, the store’s folders and its preview go, the job is undone, and the store can try again', async () => {
    await reset(stores.a.id)
    const world = await createDepsFor(db.sql, () => now)
    const { params } = await failedAt(stores.a.id, null, world)
    // Cleanup that did not finish: the repo and folders are still there when the job is marked failed.
    await db.sql`update job set state = 'failed' where id = ${params.jobId}`
    await db.sql`update storefront set repo_state = 'failed' where store_id = ${stores.a.id}`
    expect(world.github.repos.size).toBe(1)

    expect((await run<{ undoJob: unknown }>(undo, engineer(), { id: params.jobId, r: 'Owner asked to start again' })).data?.undoJob).toEqual({ ok: true, code: null })
    expect((await jobsOf(stores.a.id)).map((j) => j.state)).toEqual(['cleaning'])
    expect((await run<{ undoJob: unknown }>(undo, engineer(), { id: params.jobId, r: 'Asked twice' })).data?.undoJob).toEqual({ ok: false, code: 'JOB_RUNNING' })
    const queued = await outboxOf(storefrontUndoKind, stores.a.id)
    expect(queued.map((q) => q.payload)).toEqual([{ storeId: stores.a.id, jobId: params.jobId }])

    expect(await runUndoStorefront(world.deps, { storeId: stores.a.id, jobId: params.jobId }, once)).toBe('undone')
    expect(world.github.repos.size).toBe(0)
    expect(world.sites.keys(`stores/${stores.a.id}`)).toEqual([])
    expect(world.sites.keys('previews/')).toEqual([])
    expect((await db.sql`select 1 from design_draft where store_id = ${stores.a.id}`).length).toBe(0)
    expect((await jobsOf(stores.a.id)).map((j) => j.state)).toEqual(['undone'])
    expect(await activityOf(stores.a.id, 'job.undone')).toEqual([expect.objectContaining({ actor_kind: 'staff', reason: 'Owner asked to start again', partner_id: stores.a.partner })])
    expect(await withSystemScope(db.sql, (tx) => startStorefront(tx, stores.a.id, 'bloom', now))).toEqual({ ok: true, jobId: expect.any(String) })
  })

  it('refuses what it should: a stuck job, an old job, a finished store, a store with its own frontend, an unknown job', async () => {
    await reset(stores.a.id)
    const world = await createDepsFor(db.sql, () => now)
    const { params } = await failedAt(stores.a.id, 'storeConfig', world)
    expect((await run<{ undoJob: unknown }>(undo, engineer(), { id: params.jobId, r: '   ' })).data?.undoJob).toEqual({ ok: false, code: 'REASON_REQUIRED' })
    expect((await run<{ retryJob: unknown }>(retry, engineer(), { id: '00000000-0000-4000-8000-000000000000' })).data?.retryJob).toEqual({ ok: false, code: 'NOT_FOUND' })

    // A newer job exists, so the old failed one is no longer what an Undo may clean (its folders are the live job's).
    expect((await run<{ retryJob: unknown }>(retry, engineer(), { id: params.jobId })).data?.retryJob).toEqual({ ok: true, code: null })
    const newest = (await jobsOf(stores.a.id)).at(-1)?.id ?? ''
    await db.sql`update job set state = 'failed' where id = ${newest}`
    expect((await run<{ undoJob: unknown }>(undo, engineer(), { id: params.jobId, r: 'Old one' })).data?.undoJob).toEqual({ ok: false, code: 'NOT_FOUND' })

    // The newest job is stuck: its Workflow is alive, so Retry keeps its refusal.
    const stuck = newest
    await db.sql`update job set state = 'running', step_started_at = ${new Date(now.getTime() - 3 * 3_600_000)} where id = ${stuck}`
    expect((await run<{ retryJob: unknown }>(retry, engineer(), { id: stuck })).data?.retryJob).toEqual({ ok: false, code: 'NO_EXECUTOR' })
    expect((await run<{ undoJob: unknown }>(undo, engineer(), { id: stuck, r: 'x' })).data?.undoJob).toEqual({ ok: false, code: 'NOT_FAILED' })

    // Once the store has its site, or its own frontend, a retry has nothing to make.
    await db.sql`update job set state = 'failed' where id = ${stuck}`
    await db.sql`update storefront set repo_state = 'ready' where store_id = ${stores.a.id}`
    expect((await run<{ retryJob: unknown }>(retry, engineer(), { id: stuck })).data?.retryJob).toEqual({ ok: false, code: 'NOT_FOUND' })
    await db.sql`update storefront set repo_state = 'failed' where store_id = ${stores.a.id}`
    await db.sql`update store set storefront_kind = 'own', build_state = null where id = ${stores.a.id}`
    expect((await run<{ retryJob: unknown }>(retry, engineer(), { id: stuck })).data?.retryJob).toEqual({ ok: false, code: 'NOT_FOUND' })
  })

  it('changes only the job it is asked for, and a partner manager reaches only an assigned partner’s jobs', async () => {
    await reset(stores.a.id)
    await reset(stores.b.id)
    const world = await createDepsFor(db.sql, () => now)
    const a = await failedAt(stores.a.id, 'storeConfig', world)
    const b = await failedAt(stores.b.id, 'storeConfig', world)
    const before = await db.sql`select id, state, repo_state from job j join storefront f on f.store_id = j.store_id where j.id = ${b.params.jobId}`

    expect((await run<{ retryJob: unknown }>(retry, engineer(), { id: a.params.jobId })).data?.retryJob).toEqual({ ok: true, code: null })
    expect(await db.sql`select id, state, repo_state from job j join storefront f on f.store_id = j.store_id where j.id = ${b.params.jobId}`).toEqual(before)
    expect(await outboxOf(storefrontCreateKind, stores.b.id)).toHaveLength(1)

    const manager = as('staff-partner-manager')
    const assigned = await db.sql<{ partner_id: string }[]>`select partner_id from staff_partner_assignment where staff_user_id = ${manager.id} and removed_at is null`
    const mine = assigned.some((r) => r.partner_id === stores.a.partner) ? stores.a : stores.b
    const theirs = mine === stores.a ? b : a
    // The role check is the resolver's (a partner manager holds neither permission); the assignment is the service's.
    expect((await run(retry, manager, { id: theirs.params.jobId })).code).toBe('FORBIDDEN')
    if (assigned.length > 0 && !assigned.some((r) => r.partner_id === (mine === stores.a ? stores.b : stores.a).partner)) {
      expect(await provisioningFor(manager).retryJob(theirs.params.jobId)).toEqual({ ok: false, code: 'NOT_FOUND' })
      expect(await provisioningFor(manager).undoJob(theirs.params.jobId, 'not mine')).toEqual({ ok: false, code: 'NOT_FOUND' })
    }
  })

  it('opens the store’s repo state only to the job it is asked about: the staff functions refuse another job kind and another scope', async () => {
    const provisionJob = jobs.failed
    const context = { caller: { kind: 'staff' as const, staffId: engineer().id } }
    const rows = await withScope(db.sql, context, (tx) => tx`select * from staff_start_row(${provisionJob})`)
    expect(rows).toHaveLength(0)
    await expect(withScope(db.sql, { caller: { kind: 'platform' } } as never, (tx) => tx`select * from staff_start_row(${provisionJob})`)).rejects.toThrow()
  })
})
