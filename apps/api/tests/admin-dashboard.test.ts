import { graphql, type GraphQLSchema } from 'graphql'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { isAssigned } from '#auth/assignment'
import type { StaffMember, StaffRole } from '#auth/staff'
import { listActivity } from '#saas/activity/index'
import { createDashboardService } from '#saas/dashboard/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #35: the five cards of FIRST-RELEASE §3, the badges and the header search, counted in
// SQL against the seed, through the real schema.

let db: TestDatabase
const now = new Date('2026-10-02T12:00:00Z')
const staffByRole = new Map<StaffRole, StaffMember>()

const contextFor = (staff: StaffMember | null): AdminContext => ({
  staff,
  isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target),
  activity: async (filter, page) => listActivity(db.sql, { caller: { kind: 'staff', staffId: staff?.id ?? '' } }, filter, page),
  partners: null,
  stores: null,
  provisioning: null,
  customers: null,
  dashboard: staff ? createDashboardService({ sql: db.sql, staff, now: () => now }) : null,
})

const run = async <T = Record<string, unknown>>(source: string, staff: StaffMember | null, variables: Record<string, unknown> = {}): Promise<{ data: T | null; code: string | undefined }> => {
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, variableValues: variables, contextValue: contextFor(staff) })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const as = (role: StaffRole): StaffMember => {
  const s = staffByRole.get(role)
  if (!s) throw new Error(`no seeded staff with role ${role}`)
  return s
}

const dashboardQuery = `query($partnerId: ID) { dashboard(partnerId: $partnerId) {
  partnerId partnerOptions { name } asOf
  partners { live awaiting draft paused }
  awaiting { count oldest { name submittedAt waitingSeconds } }
  stores { total newThisWeek newThisWeekByPartner { name count } }
  attention { pastDue suspended setupFailed setupStuck total stores { name partnerName reason { kind daysPastDue reason state step attempt } } }
  signups { started completed failed medianSecondsToReady } } }`

interface Dash {
  dashboard: {
    partnerId: string | null
    partnerOptions: { name: string }[]
    partners: Record<string, number>
    awaiting: { count: number; oldest: { name: string; waitingSeconds: number } | null }
    stores: { total: number; newThisWeek: number; newThisWeekByPartner: { name: string; count: number }[] }
    attention: { pastDue: number; suspended: number; setupFailed: number; setupStuck: number; total: number; stores: { name: string; reason: Record<string, unknown> }[] }
    signups: { started: number; completed: number; failed: number; medianSecondsToReady: number | null }
  }
}

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  const rows = await db.sql<{ id: string; email: string; name: string; role_key: StaffRole }[]>`select id, email, name, role_key from staff_user order by created_at`
  for (const r of rows) if (!staffByRole.has(r.role_key)) staffByRole.set(r.role_key, { id: r.id, email: r.email, name: r.name, role: r.role_key })
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('dashboard(partnerId) (§3)', () => {
  it('counts every card over the seed, finished numbers only', async () => {
    const { data, code } = await run<Dash>(dashboardQuery, as('staff-super-admin'))
    expect(code).toBeUndefined()
    const d = data?.dashboard
    expect(d?.partnerId).toBeNull()
    expect(d?.partnerOptions.length).toBe(10)
    expect(d?.partners).toEqual({ live: 4, awaiting: 1, draft: 2, paused: 1 })
    expect(d?.awaiting.count).toBe(1)
    expect(d?.awaiting.oldest).toEqual({ name: 'Kaufladen Digital', submittedAt: new Date(now.getTime() - 6 * 24 * 3600_000).toISOString(), waitingSeconds: 6 * 24 * 3600 })
    expect(d?.stores.total).toBe(103)
    expect(d?.stores.newThisWeek).toBe(5)
    expect(d?.stores.newThisWeekByPartner).toEqual([
      { name: 'DripFunnel', count: 2 },
      { name: 'Bazaar Cloud', count: 1 },
      { name: 'Kaufladen Digital', count: 1 },
      { name: 'Northstar Commerce', count: 1 },
    ])
    // Past due: Kiko Kids (9 days) plus the generated spread (10 days); the longest past due first.
    expect(d?.attention).toMatchObject({ pastDue: 11, suspended: 1, setupFailed: 1, setupStuck: 1, total: 14 })
    expect(d?.attention.stores.map((s) => [s.name, s.reason['kind'], s.reason['state'] ?? s.reason['daysPastDue'] ?? s.reason['reason']])).toEqual([
      ['Peak Supply Co.', 'setup', 'failed'],
      ['Fjord Outdoor', 'setup', 'stuck'],
      ['Redline Moto Parts', 'suspended', 'Chargeback'],
      ['Birch Supply', 'pastDue', 10],
      ['Birch Supply', 'pastDue', 10],
    ])
    expect(d?.attention.stores).toHaveLength(5)
    // Signups this week: five jobs started, two finished well, one failed; the median over the finished ones.
    expect(d?.signups).toEqual({ started: 5, completed: 2, failed: 1, medianSecondsToReady: 102 })
  })

  it('partnerId filters every card; an unknown partner means all partners', async () => {
    const [df] = await db.sql<{ id: string }[]>`select id from partner where name = 'DripFunnel'`
    const { data } = await run<Dash>(dashboardQuery, as('staff-super-admin'), { partnerId: df?.id })
    const d = data?.dashboard
    expect(d?.partnerId).toBe(df?.id)
    expect(d?.partners).toEqual({ live: 1, awaiting: 0, draft: 0, paused: 0 })
    expect(d?.awaiting.oldest).toBeNull()
    expect(d?.stores.newThisWeek).toBe(2)
    expect(d?.stores.newThisWeekByPartner).toEqual([{ name: 'DripFunnel', count: 2 }])
    expect(d?.attention).toMatchObject({ pastDue: 2, suspended: 0, setupFailed: 1, setupStuck: 1, total: 4 })
    expect(d?.signups).toEqual({ started: 2, completed: 0, failed: 1, medianSecondsToReady: null })
    const unknown = await run<Dash>(dashboardQuery, as('staff-super-admin'), { partnerId: '00000000-0000-4000-8000-000000000000' })
    expect(unknown.data?.dashboard.partnerId).toBeNull()
    expect(unknown.data?.dashboard.stores.total).toBe(103)
    expect((await run<Dash>(dashboardQuery, as('staff-super-admin'), { partnerId: 'nonsense' })).data?.dashboard.partnerId).toBeNull()
  })

  it('a Partner manager counts only their assigned partners, and asking for another means their own set', async () => {
    const { data } = await run<Dash>(dashboardQuery, as('staff-partner-manager'))
    const d = data?.dashboard
    expect(d?.partnerOptions.map((p) => p.name).sort()).toEqual(['Kaufladen Digital', 'Nordlicht Media', 'Tallis Studio'])
    expect(d?.partners).toEqual({ live: 0, awaiting: 1, draft: 2, paused: 0 })
    expect(d?.stores.total).toBe(1)
    expect(d?.signups).toEqual({ started: 1, completed: 1, failed: 0, medianSecondsToReady: 102 })
    const [ns] = await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`
    const other = await run<Dash>(dashboardQuery, as('staff-partner-manager'), { partnerId: ns?.id })
    expect(other.data?.dashboard.partnerId).toBeNull()
    expect(other.data?.dashboard.stores.total).toBe(1)
    expect((await run(dashboardQuery, null)).code).toBe('UNAUTHENTICATED')
  })

  it('each card is one statement, plus the options and the filter lookup', async () => {
    const statements: string[] = []
    const sql = postgres(db.url, { max: 1, debug: (_, query) => statements.push(query.trim().toLowerCase()) })
    const service = createDashboardService({ sql, staff: as('staff-super-admin'), now: () => now })
    // postgres.js looks up pg_catalog types on first connect and withScope sets the scope with set_config.
    const selects = () => statements.filter((q) => q.startsWith('select') && !q.includes('set_config') && !q.includes('pg_catalog')).length
    try {
      await service.dashboard(null)
      expect(selects()).toBe(7)
      statements.length = 0
      const [df] = await db.sql<{ id: string }[]>`select id from partner where name = 'DripFunnel'`
      await service.dashboard(df?.id)
      expect(selects()).toBe(8)
      statements.length = 0
      await service.navBadges()
      expect(selects()).toBe(3)
      statements.length = 0
      await service.search('Goods')
      expect(selects()).toBe(2)
    } finally {
      await sql.end()
    }
  })
})

describe('navBadges (§2)', () => {
  it('counts awaiting partners, failed or stuck signups and open setup sessions', async () => {
    const q = `{ navBadges { partnersAwaitingApproval provisioningAttention openSessions } }`
    expect((await run<{ navBadges: Record<string, number> }>(q, as('staff-super-admin'))).data?.navBadges).toEqual({ partnersAwaitingApproval: 1, provisioningAttention: 2, openSessions: 0 })
    expect((await run<{ navBadges: Record<string, number | null> }>(q, as('staff-read-only'))).data?.navBadges).toEqual({ partnersAwaitingApproval: 1, provisioningAttention: 2, openSessions: null })
    const sa = as('staff-super-admin')
    const [kl] = await db.sql<{ id: string }[]>`select id from partner where name = 'Kaufladen Digital'`
    await db.sql`insert into partner_setup_session (staff_user_id, partner_id, reason, started_at, expires_at) values (${sa.id}, ${kl?.id ?? ''}, 'open now', ${now}, ${new Date(now.getTime() + 3600_000)})`
    expect((await run<{ navBadges: Record<string, number> }>(q, as('staff-partner-manager'))).data?.navBadges).toEqual({ partnersAwaitingApproval: 1, provisioningAttention: 0, openSessions: 1 })
    expect((await run<{ navBadges: Record<string, number> }>(q, as('staff-support'))).data?.navBadges).toEqual({ partnersAwaitingApproval: 1, provisioningAttention: 2, openSessions: 1 })
  })
})

describe('search(query) (§2)', () => {
  const q = `query($query: String!) { search(query: $query) { partners { name host ownerEmail } stores { name code partnerName ownerEmail host } } }`
  interface Found {
    search: { partners: { name: string }[]; stores: { name: string }[] }
  }

  it('finds partners and stores by name, domain, code and owner email, capped at ten of each', async () => {
    const sa = as('staff-super-admin')
    expect((await run<Found>(q, sa, { query: 'kaufladen' })).data?.search.partners.map((p) => p.name)).toEqual(['Kaufladen Digital'])
    expect((await run<Found>(q, sa, { query: 'portal.bazaarcloud' })).data?.search.partners.map((p) => p.name)).toEqual(['Bazaar Cloud'])
    expect((await run<Found>(q, sa, { query: 'vikram@' })).data?.search.partners.map((p) => p.name)).toEqual(['Bazaar Cloud'])
    expect((await run<Found>(q, sa, { query: 'kikokids.example' })).data?.search.stores.map((s) => s.name)).toEqual(['Kiko Kids'])
    expect((await run<Found>(q, sa, { query: 'harbor-coffee' })).data?.search.stores.map((s) => s.name)).toEqual(['Harbor Coffee Co.'])
    expect((await run<Found>(q, sa, { query: 'jenna@' })).data?.search.stores.map((s) => s.name)).toEqual(['Harbor Coffee Co.'])
    expect((await run<Found>(q, sa, { query: 'Goods' })).data?.search.stores).toHaveLength(10)
    expect((await run(q, sa, { query: 'k' })).code).toBe('INVALID_INPUT')
    expect((await run<Found>(q, sa, { query: '%_' })).data?.search).toEqual({ partners: [], stores: [] })
  })

  it('a store that is past due with a failed setup counts once in the total', async () => {
    const [kiko] = await db.sql<{ id: string }[]>`select id from store where code = 'kiko-kids'`
    await db.sql`update job set state = 'failed', finished_at = ${now} where store_id = ${kiko?.id ?? ''}`
    try {
      const { data } = await run<Dash>(dashboardQuery, as('staff-super-admin'))
      expect(data?.dashboard.attention).toMatchObject({ pastDue: 11, setupFailed: 2, total: 14 })
      expect(data?.dashboard.attention.stores[0]).toMatchObject({ name: 'Kiko Kids', reason: { kind: 'setup', state: 'failed' } })
      expect(data?.dashboard.signups).toMatchObject({ started: 5, failed: 2 })
    } finally {
      await db.sql`update job set state = 'done', finished_at = started_at + interval '102 seconds' where store_id = ${kiko?.id ?? ''}`
    }
  })

  it('returns nothing outside a Partner manager assignment, and nothing to a signed-out caller', async () => {
    const pm = as('staff-partner-manager')
    expect((await run<Found>(q, pm, { query: 'Northstar' })).data?.search.partners).toEqual([])
    expect((await run<Found>(q, pm, { query: 'Kiko' })).data?.search.stores).toEqual([])
    expect((await run<Found>(q, pm, { query: 'Grünwerk' })).data?.search.stores.map((s) => s.name)).toEqual(['Grünwerk'])
    expect((await run(q, null, { query: 'anything' })).code).toBe('UNAUTHENTICATED')
  })
})
