import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { isAssigned } from '#auth/assignment'
import type { StaffMember, StaffRole } from '#auth/staff'
import { listActivity } from '#saas/activity/index'
import { createProvisioningService } from '#saas/provisioning/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #37: Provisioning on the Admin API. The signup Workflow is the Store strand's, so Retry
// and Undo answer NO_EXECUTOR once every other check passes.

let db: TestDatabase
const now = new Date('2026-10-02T12:00:00Z')
const staffByRole = new Map<StaffRole, StaffMember>()
const jobs = { failed: '', stuck: '', running: '', own: '', done: '' }
const secret = 'ghs_abcdefghijklmnopqrstuvwxyz0123456789'

const contextFor = (staff: StaffMember | null): AdminContext => ({
  staff,
  isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target),
  activity: async (filter, page) => listActivity(db.sql, { caller: { kind: 'staff', staffId: staff?.id ?? '' } }, filter, page),
  partners: null,
  stores: null,
  provisioning: staff ? createProvisioningService({ sql: db.sql, staff, now: () => now }) : null,
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
