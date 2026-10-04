import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import { hashSessionId } from '#auth/session'
import type { StaffMember, StaffRole } from '#auth/staff'
import { withSystemScope } from '#db/scoped/index'
import { spendImpersonationHandoff } from '#db/scoped/staffSessions'
import { activityLog } from '#saas/activity/index'
import { createPartnersService } from '#saas/partners/index'
import { createStaffSessionsService } from '#saas/staffSessions/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #40: staff sessions on the Admin API. The most powerful thing the platform does, so most
// of these prove a refusal.

let db: TestDatabase
const now = new Date('2026-10-02T12:00:00Z')
const platformHost = 'platform.dripfunnel.com'
const staffByRole = new Map<StaffRole, StaffMember>()
const request = new Request('https://admin.dripfunnel.com/api', { headers: { 'cf-ray': 'ray-test', 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'test' } })
const ids = { partnerUser: '', partnerId: '', storeMembership: '', storeUser: '', supplierMembership: '', supplierUser: '', otherPartnerUser: '' }

const contextFor = (staff: StaffMember | null, reauthFresh = true): AdminContext => {
  const assigned = (staffId: string, target: Parameters<typeof isAssigned>[2]) => isAssigned(db.sql, staffId, target)
  return {
    staff,
    isAssigned: assigned,
    staffActivity: null,
    partners: staff ? createPartnersService({ sql: db.sql, staff, reauthFresh, facts: factsOf(request), activity: activityLog, isAssigned: assigned, platformHost, now: () => now }) : null,
    stores: null,
    staffMembers: null,
    provisioning: null,
    customers: null,
    staffSessions: staff ? createStaffSessionsService({ sql: db.sql, staff, facts: factsOf(request), activity: activityLog, reauthFresh, platformHost, now: () => now }) : null,
    dashboard: null,
  }
}

const run = async <T = Record<string, unknown>>(source: string, staff: StaffMember | null, variables: Record<string, unknown> = {}, reauthFresh = true) => {
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, variableValues: variables, contextValue: contextFor(staff, reauthFresh) })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined, raw: JSON.stringify(result) }
}

const as = (role: StaffRole): StaffMember => {
  const s = staffByRole.get(role)
  if (!s) throw new Error(`no seeded staff with role ${role}`)
  return s
}

const targets = `query($f: ImpersonationTargetFilter, $s: String) { impersonationTargets(filter: $f, search: $s, first: 25) {
  items { id email kind status impersonate { allowed reason } openSession memberships { id level role } } } }`
type Target = { id: string; email: string; kind: string; impersonate: { allowed: boolean; reason: string | null }; openSession: string | null; memberships: { id: string; level: string }[] }
const start = `mutation($t: ID!, $m: ID!, $r: String!) { startImpersonation(targetId: $t, membershipId: $m, reason: $r, ticket: "ZD-1") {
  ok reason handoff openSessionId session { id kind expiresAt host outcome actions { extend { allowed reason } end { allowed reason } } } } }`
type Started = { startImpersonation: { ok: boolean; reason: string | null; handoff: string | null; openSessionId: string | null; session: { id: string; expiresAt: string; host: string } | null } }
const extend = `mutation($id: ID!) { extendImpersonation(id: $id) { ok reason expiresAt } }`
const back = `mutation($id: ID!) { returnToSession(id: $id) { ok reason handoff } }`
const end = `mutation($id: ID!) { endStaffSession(id: $id) { ok code } }`
const sessions = `query { staffSessions(first: 25) { open { id kind outcome mine } history { items { id kind outcome } } } }`

const tokenOf = (link: string | null | undefined) => new URL(link ?? 'https://x/').searchParams.get('token') ?? ''
const spend = async (token: string, at = now) => withSystemScope(db.sql, async (tx) => spendImpersonationHandoff(tx, await hashSessionId(token), at))

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  const rows = await db.sql<{ id: string; email: string; name: string; role_key: StaffRole }[]>`select id, email, name, role_key from staff_user where status = 'active' order by created_at`
  for (const r of rows) if (!staffByRole.has(r.role_key)) staffByRole.set(r.role_key, { id: r.id, email: r.email, name: r.name, role: r.role_key })
  const [pu] = await db.sql<{ id: string; partner_id: string }[]>`select u.id, u.partner_id from partner_user u join partner p on p.id = u.partner_id where p.name = 'Northstar Commerce' and u.status = 'active' limit 1`
  ids.partnerUser = pu?.id ?? ''
  ids.partnerId = pu?.partner_id ?? ''
  const [store] = await db.sql<{ id: string; user_id: string }[]>`select m.id, m.user_id from membership m join "user" u on u.id = m.user_id where u.email = 'rohan@mehtatextiles.example'`
  ids.storeMembership = store?.id ?? ''
  ids.storeUser = store?.user_id ?? ''
  const [supplier] = await db.sql<{ id: string; user_id: string }[]>`select m.id, m.user_id from membership m where m.seller_id is not null limit 1`
  ids.supplierMembership = supplier?.id ?? ''
  ids.supplierUser = supplier?.user_id ?? ''
  const [other] = await db.sql<{ id: string }[]>`select u.id from partner_user u join partner p on p.id = u.partner_id where p.name = 'Bazaar Cloud' and u.status = 'active' limit 1`
  ids.otherPartnerUser = other?.id ?? ''
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('targets', () => {
  it('lists partner and store users, never staff or shoppers, and says who may not be acted as', async () => {
    const su = as('staff-support')
    await db.sql`insert into customer (store_id, email, name, status) select store_id, 'shopper@example.com', 'A Shopper', 'active' from membership where id = ${ids.storeMembership}`
    const all: Target[] = []
    for (const kind of ['partnerUser', 'storeUser', 'supplierUser']) all.push(...((await run<{ impersonationTargets: { items: Target[] } }>(targets, su, { f: { type: kind } })).data?.impersonationTargets.items ?? []))
    const staffEmails = new Set((await db.sql<{ email: string }[]>`select lower(email) as email from staff_user`).map((r) => r.email))
    expect(all.some((t) => staffEmails.has(t.email.toLowerCase()))).toBe(false)
    expect((await run<{ impersonationTargets: { items: Target[] } }>(targets, su, { s: 'shopper@example.com' })).data?.impersonationTargets.items).toEqual([])
    const supplier = (await run<{ impersonationTargets: { items: Target[] } }>(targets, su, { f: { type: 'supplierUser' } })).data?.impersonationTargets.items.find((t) => t.id === ids.supplierUser)
    expect(supplier?.impersonate).toEqual({ allowed: false, reason: 'SUPPLIER_NOT_SUPPORTED' })
    expect((await run(targets, as('staff-partner-manager'))).code).toBe('FORBIDDEN')
  })
})

describe('impersonation', () => {
  it('needs a reason and a fresh re-authentication, and refuses a supplier user, a suspended user and a closed partner', async () => {
    const su = as('staff-support')
    const go = (target: string, membership: string, reason = 'Investigating a refund', fresh = true) => run<Started>(start, su, { t: target, m: membership, r: reason }, fresh)
    expect((await go(ids.partnerUser, ids.partnerUser, ' ')).data?.startImpersonation.reason).toBe('REASON_REQUIRED')
    expect((await go(ids.partnerUser, ids.partnerUser, 'x', false)).data?.startImpersonation.reason).toBe('REAUTH_REQUIRED')
    expect((await run<Started>(`mutation($t: ID!, $m: ID!) { startImpersonation(targetId: $t, membershipId: $m, reason: "x", ticket: "${'t'.repeat(501)}") { ok reason } }`, su, { t: ids.partnerUser, m: ids.partnerUser })).data?.startImpersonation.reason).toBe('INVALID_INPUT')
    expect((await go(ids.supplierUser, ids.supplierMembership)).data?.startImpersonation.reason).toBe('SUPPLIER_NOT_SUPPORTED')
    expect((await go(ids.storeUser, ids.partnerUser)).data?.startImpersonation.reason).toBe('NOT_FOUND')
    await db.sql`update partner_user set status = 'suspended' where id = ${ids.otherPartnerUser}`
    expect((await go(ids.otherPartnerUser, ids.otherPartnerUser)).data?.startImpersonation.reason).toBe('TARGET_NOT_ACTIVE')
    await db.sql`update partner_user set status = 'active' where id = ${ids.otherPartnerUser}`
    await db.sql`update partner set state = 'closed' where id = (select partner_id from partner_user where id = ${ids.otherPartnerUser})`
    expect((await go(ids.otherPartnerUser, ids.otherPartnerUser)).data?.startImpersonation.reason).toBe('PARTNER_CLOSED')
    await db.sql`update partner set state = 'live' where id = (select partner_id from partner_user where id = ${ids.otherPartnerUser})`
    expect((await run(start, as('staff-partner-manager'), { t: ids.partnerUser, m: ids.partnerUser, r: 'x' })).code).toBe('FORBIDDEN')
  })

  it('runs 30 minutes, one at a time, opens on its host through a single-use link, and is logged', async () => {
    const su = as('staff-support')
    const started = (await run<Started>(start, su, { t: ids.partnerUser, m: ids.partnerUser, r: 'Investigating a refund' })).data?.startImpersonation
    expect(started?.ok).toBe(true)
    expect(new Date(started?.session?.expiresAt ?? '').getTime() - now.getTime()).toBe(30 * 60_000)
    expect(new URL(started?.handoff ?? '').host).toBe(platformHost)
    expect(new URL(started?.handoff ?? '').pathname).toBe('/impersonate/enter')
    const token = tokenOf(started?.handoff)
    expect(await spend(token, new Date(now.getTime() + 6 * 60_000))).toBeNull()
    expect((await spend(token))?.target_id).toBe(ids.partnerUser)
    expect(await spend(token)).toBeNull()
    // One at a time, whoever the second target is.
    const second = (await run<Started>(start, su, { t: ids.storeUser, m: ids.storeMembership, r: 'Another' })).data?.startImpersonation
    expect(second).toMatchObject({ ok: false, reason: 'IMPERSONATION_ALREADY_OPEN', openSessionId: started?.session?.id })
    const [logged] = await db.sql<{ actor_id: string; access_kind: string; target_id: string; visibility: string; reason: string }[]>`
      select actor_id, access_kind, target_id, visibility, reason from activity_log where action = 'impersonation.started'`
    expect(logged).toMatchObject({ actor_id: su.id, access_kind: 'impersonation', target_id: ids.partnerUser, visibility: 'partner', reason: 'Investigating a refund' })
    expect(JSON.stringify(await db.sql`select * from activity_log`)).not.toContain(token)
    expect((await run(sessions, su)).raw).not.toContain(token)
  })

  it('extends exactly once, by its owner, and the row is what refuses the second', async () => {
    const su = as('staff-support')
    const sa = as('staff-super-admin')
    const [open] = await db.sql<{ id: string; expires_at: Date }[]>`select id, expires_at from impersonation where staff_user_id = ${su.id} and ended_at is null`
    expect((await run<{ extendImpersonation: { reason: string } }>(extend, sa, { id: open?.id })).data?.extendImpersonation.reason).toBe('NOT_SESSION_OWNER')
    const once = (await run<{ extendImpersonation: { ok: boolean; expiresAt: string } }>(extend, su, { id: open?.id })).data?.extendImpersonation
    expect(new Date(once?.expiresAt ?? '').getTime() - (open?.expires_at.getTime() ?? 0)).toBe(30 * 60_000)
    expect((await run<{ extendImpersonation: { reason: string } }>(extend, su, { id: open?.id })).data?.extendImpersonation.reason).toBe('IMPERSONATION_ALREADY_EXTENDED')
    const [row] = await db.sql<{ extended_at: Date | null }[]>`select extended_at from impersonation where id = ${open?.id ?? ''}`
    expect(row?.extended_at).not.toBeNull()
    expect(await db.sql`select 1 from activity_log where action = 'impersonation.extended'`).toHaveLength(1)
  })

  it('returns with a fresh link that kills the old one, and ends by its owner or a Super admin', async () => {
    const su = as('staff-support')
    const [open] = await db.sql<{ id: string }[]>`select id from impersonation where staff_user_id = ${su.id} and ended_at is null`
    const first = tokenOf((await run<{ returnToSession: { handoff: string } }>(back, su, { id: open?.id })).data?.returnToSession.handoff)
    const second = tokenOf((await run<{ returnToSession: { handoff: string } }>(back, su, { id: open?.id })).data?.returnToSession.handoff)
    expect(await spend(first)).toBeNull()
    expect((await spend(second))?.id).toBe(open?.id)
    expect((await run<{ endStaffSession: { ok: boolean } }>(end, as('staff-super-admin'), { id: open?.id })).data?.endStaffSession.ok).toBe(true)
    const listed = (await run<{ staffSessions: { history: { items: { id: string; outcome: string }[] } } }>(sessions, su)).data?.staffSessions.history.items ?? []
    expect(listed.find((s) => s.id === open?.id)?.outcome).toBe('endedByStaff')
    // One that simply ran out reads as expired, even once a later start has closed its row.
    const [ranOut] = await db.sql<{ id: string }[]>`
      insert into impersonation (staff_user_id, target_kind, target_id, partner_id, reason, started_at, expires_at)
      values (${su.id}, 'partner_user', ${ids.partnerUser}, ${ids.partnerId}, 'Old', ${new Date(now.getTime() - 3_600_000)}, ${new Date(now.getTime() - 1_800_000)}) returning id`
    const fresh = (await run<Started>(start, su, { t: ids.partnerUser, m: ids.partnerUser, r: 'After it ran out' })).data?.startImpersonation
    expect(fresh?.ok).toBe(true)
    const later = (await run<{ staffSessions: { history: { items: { id: string; outcome: string }[] } } }>(sessions, su)).data?.staffSessions.history.items ?? []
    expect(later.find((s) => s.id === ranOut?.id)?.outcome).toBe('expired')
    await run(end, su, { id: fresh?.session?.id })
    expect((await run<{ endStaffSession: { ok: boolean; code: string } }>(end, su, { id: open?.id })).data?.endStaffSession).toMatchObject({ ok: false, code: 'SESSION_ENDED' })
    expect((await run<{ returnToSession: { reason: string } }>(back, su, { id: open?.id })).data?.returnToSession.reason).toBe('SESSION_ENDED')
    // Ended, a new one may start; a store user opens on the partner's portal host.
    const store = (await run<Started>(start, su, { t: ids.storeUser, m: ids.storeMembership, r: 'Order stuck' })).data?.startImpersonation
    const [portal] = await db.sql<{ host: string }[]>`select d.host from partner_domain d join store s on s.partner_id = d.partner_id join membership m on m.store_id = s.id where m.id = ${ids.storeMembership} and d.kind = 'portal'`
    expect(store?.ok).toBe(true)
    expect(new URL(store?.handoff ?? '').host).toBe(portal?.host)
    await run(end, su, { id: store?.session?.id })
  })

  it('lets two starts at once by one staff member open only one, at the index', async () => {
    const sa = as('staff-super-admin')
    const [a, b] = await Promise.all([
      run<Started>(start, sa, { t: ids.partnerUser, m: ids.partnerUser, r: 'One' }),
      run<Started>(start, sa, { t: ids.storeUser, m: ids.storeMembership, r: 'Two' }),
    ])
    const outcomes = [a.data?.startImpersonation, b.data?.startImpersonation]
    expect(outcomes.filter((o) => o?.ok)).toHaveLength(1)
    expect(outcomes.filter((o) => o?.reason === 'IMPERSONATION_ALREADY_OPEN')).toHaveLength(1)
    const opened = outcomes.find((o) => o?.ok)?.session?.id
    await run(end, sa, { id: opened })
  })
})

describe('setup sessions beside them', () => {
  const setup = `mutation($id: ID!) { startPartnerSetupSession(id: $id, reason: "Onboarding call", ticket: null) { ok code sessionId } }`

  it('lets two starts at once by one staff member open only one, refuses an extension, and returns with a fresh link', async () => {
    const pm = as('staff-partner-manager')
    const [assigned] = await db.sql<{ partner_id: string }[]>`select partner_id from staff_partner_assignment where staff_user_id = ${pm.id} and removed_at is null limit 1`
    const [a, b] = await Promise.all([run<{ startPartnerSetupSession: { ok: boolean; code: string; sessionId: string } }>(setup, pm, { id: assigned?.partner_id }), run<{ startPartnerSetupSession: { ok: boolean; code: string; sessionId: string } }>(setup, pm, { id: assigned?.partner_id })])
    const outcomes = [a.data?.startPartnerSetupSession, b.data?.startPartnerSetupSession]
    expect(outcomes.filter((o) => o?.ok)).toHaveLength(1)
    expect(outcomes.filter((o) => o?.code === 'SETUP_SESSION_ALREADY_OPEN')).toHaveLength(1)
    const id = outcomes.find((o) => o?.ok)?.sessionId
    const mine = (await run<{ staffSessions: { open: { id: string; kind: string; mine: boolean }[] } }>(sessions, pm)).data?.staffSessions.open ?? []
    expect(mine.every((s) => s.kind === 'setup')).toBe(true)
    expect(mine.find((s) => s.id === id)?.mine).toBe(true)
    // The console reads the session it started back by id (admin api/impersonation.ts `startSetupSession`).
    expect((await run<{ staffSession: { kind: string; session: { kind: string } } }>(`query($id: ID!) { staffSession(id: $id) { kind session { kind } } }`, pm, { id })).data?.staffSession).toEqual({ kind: 'found', session: { kind: 'setup' } })
    expect((await run(extend, pm, { id })).code).toBe('FORBIDDEN')
    expect((await run<{ extendImpersonation: { reason: string } }>(extend, as('staff-super-admin'), { id })).data?.extendImpersonation.reason).toBe('SETUP_SESSION_NOT_EXTENDABLE')
    const again = (await run<{ returnToSession: { ok: boolean; handoff: string } }>(back, pm, { id })).data?.returnToSession
    expect(new URL(again?.handoff ?? '').host).toBe(platformHost)
    const strip = `{ myStaffSessions { id kind } }`
    expect((await run<{ myStaffSessions: { id: string }[] }>(strip, pm)).data?.myStaffSessions.map((s) => s.id)).toEqual([id])
  })

  it('shows a Partner manager no impersonation, even by id', async () => {
    const [imp] = await db.sql<{ id: string }[]>`select id from impersonation limit 1`
    const lookup = `query($id: ID!) { staffSession(id: $id) { kind } }`
    expect((await run<{ staffSession: { kind: string } }>(lookup, as('staff-partner-manager'), { id: imp?.id })).data?.staffSession.kind).toBe('denied')
  })
})

describe('the schema', () => {
  it('carries no handoff on a session record and has no staff route into a partner support session', () => {
    const schema = adminSchema as GraphQLSchema
    const sessionFields = Object.keys((schema.getType('StaffSession') as unknown as { getFields: () => Record<string, unknown> }).getFields())
    expect(sessionFields.filter((f) => /handoff|token|hash/i.test(f))).toEqual([])
    const roots = [...Object.keys(schema.getQueryType()?.getFields() ?? {}), ...Object.keys(schema.getMutationType()?.getFields() ?? {})]
    expect(roots.filter((f) => /support/i.test(f))).toEqual([])
  })
})
