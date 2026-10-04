import { graphql, isObjectType, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { handlePlatformAuth, type PlatformAuthDeps } from '#apis/platform/auth'
import { platformContextFor } from '#apis/platform/context'
import { platformSchema } from '#apis/platform/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import { resolvePartner, type PartnerCaller } from '#auth/partnerCaller'
import { partnerCookieName } from '#auth/partnerSession'
import type { StaffMember, StaffRole } from '#auth/staff'
import { staffPortalCookieName } from '#auth/staffPortal'
import { activityLog } from '#saas/activity/index'
import { createPartnersService } from '#saas/partners/index'
import { createStaffSessionsService } from '#saas/staffSessions/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #243: staff sessions in the partner console. Most of these prove a refusal or an end.

let db: TestDatabase
const start = new Date('2026-10-02T12:00:00Z')
let clock = start
const host = 'platform.dripfunnel.com'
const staffByRole = new Map<StaffRole, StaffMember>()
const adminRequest = new Request('https://admin.dripfunnel.com/api', { headers: { 'cf-ray': 'ray-test', 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'test' } })
const ids = { northstar: '', maya: '', diego: '', jess: '' }

const as = (role: StaffRole): StaffMember => {
  const s = staffByRole.get(role)
  if (!s) throw new Error(`no seeded staff with role ${role}`)
  return s
}

const adminRun = async <T>(source: string, staff: StaffMember, variables: Record<string, unknown> = {}) => {
  const assigned = (staffId: string, target: Parameters<typeof isAssigned>[2]) => isAssigned(db.sql, staffId, target)
  const deps = { sql: db.sql, staff, reauthFresh: true, facts: factsOf(adminRequest), activity: activityLog, platformHost: host, now: () => clock }
  const contextValue: AdminContext = {
    staff,
    isAssigned: assigned,
    staffActivity: null,
    partners: createPartnersService({ ...deps, isAssigned: assigned }),
    stores: null,
    staffMembers: null,
    provisioning: null,
    customers: null,
    staffSessions: createStaffSessionsService(deps),
    dashboard: null,
  }
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  if (result.errors?.[0]) throw result.errors[0]
  return result.data as T
}

const impersonate = async (target: string): Promise<{ id: string; token: string }> => {
  const { startImpersonation: s } = await adminRun<{ startImpersonation: { ok: boolean; handoff: string | null; session: { id: string } | null } }>(
    `mutation($t: ID!) { startImpersonation(targetId: $t, membershipId: $t, reason: "Checking a refund", ticket: null) { ok handoff session { id } } }`,
    as('staff-support'),
    { t: target },
  )
  if (!s.handoff || !s.session) throw new Error('impersonation did not start')
  return { id: s.session.id, token: new URL(s.handoff).searchParams.get('token') ?? '' }
}

const setUp = async (partnerId: string): Promise<{ id: string; token: string }> => {
  const { startPartnerSetupSession: s } = await adminRun<{ startPartnerSetupSession: { ok: boolean; sessionId: string | null; handoff: string | null } }>(
    `mutation($id: ID!) { startPartnerSetupSession(id: $id, reason: "Onboarding call", ticket: null) { ok sessionId handoff } }`,
    as('staff-super-admin'),
    { id: partnerId },
  )
  if (!s.sessionId || !s.handoff) throw new Error('setup session did not start')
  return { id: s.sessionId, token: new URL(s.handoff).searchParams.get('token') ?? '' }
}

const endFromAdmin = (id: string) => adminRun(`mutation($id: ID!) { endStaffSession(id: $id) { ok code } }`, as('staff-super-admin'), { id })

let allow = true
const authDeps = (): PlatformAuthDeps => ({ sql: db.sql, activity: activityLog, platformHost: host, secrets: null, now: () => clock, allowAttempt: async () => true, allowStaffRead: async () => allow })

const post = (path: string, body: unknown, cookie?: string) =>
  handlePlatformAuth(
    new Request(`https://${host}/api/auth/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { origin: `https://${host}`, 'cf-connecting-ip': '203.0.113.9', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    }),
    authDeps(),
  )

type PortalSession = { id: string; kind: string; state: string; endedBy: string | null; staffName: string; actingAs: { name: string; role: string } | null; expiresAt: string }

/** Spends the link and returns the cookie header it set, as a browser would send it back. */
const enter = async (token: string): Promise<{ status: number; cookie: string; setCookie: string; body: { ok: boolean; code?: string; session?: PortalSession } }> => {
  const response = await post('handoff', { token })
  const setCookie = response.headers.get('set-cookie') ?? ''
  const value = setCookie.match(new RegExp(`${staffPortalCookieName}=([^;]+)`))?.[1] ?? ''
  return { status: response.status, cookie: `${staffPortalCookieName}=${value}`, setCookie, body: (await response.json()) as { ok: boolean; code?: string; session?: PortalSession } }
}

const current = async (cookie: string) => ((await (await post('staff-session', {}, cookie)).json()) as { session: PortalSession | null }).session

const callerFor = (cookie: string) => resolvePartner(db.sql, new Request(`https://${host}/api`, { headers: { cookie } }), clock, activityLog)

const platformRun = async <T>(source: string, caller: PartnerCaller | null, variables: Record<string, unknown> = {}) => {
  const contextValue = platformContextFor(caller, { sql: db.sql, facts: factsOf(new Request(`https://${host}/api`)), activity: activityLog, secrets: null, stripe: null, now: () => clock })
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  return { data: result.data as T | null, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const signedIn = (cookie: string) =>
  callerFor(cookie).then((caller) => {
    if (!caller) throw new Error('expected an open staff session')
    return caller
  })

const invite = `mutation($email: String!) { inviteTeamMember(name: "New Person", email: $email, role: "partner-support") { ok reason } }`

const lastEntry = async (action: string) =>
  (
    await db.sql<{ actor_kind: string; actor_id: string; on_behalf_of_kind: string | null; on_behalf_of_id: string | null; access_kind: string | null; access_ref: string | null; api: string }[]>`
      select actor_kind, actor_id, on_behalf_of_kind, on_behalf_of_id, access_kind, access_ref, api from activity_log where action = ${action} order by occurred_at desc, id desc limit 1
    `
  )[0]

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, start)
  const rows = await db.sql<{ id: string; email: string; name: string; role_key: StaffRole }[]>`select id, email, name, role_key from staff_user where status = 'active' order by created_at`
  for (const r of rows) if (!staffByRole.has(r.role_key)) staffByRole.set(r.role_key, { id: r.id, email: r.email, name: r.name, role: r.role_key })
  const users = await db.sql<{ id: string; email: string; partner_id: string }[]>`select id, email, partner_id from partner_user where email in ('maya@northstar.example', 'diego@northstar.example', 'jess@northstar.example')`
  const byEmail = (email: string) => users.find((u) => u.email === email)
  ids.maya = byEmail('maya@northstar.example')?.id ?? ''
  ids.diego = byEmail('diego@northstar.example')?.id ?? ''
  ids.jess = byEmail('jess@northstar.example')?.id ?? ''
  ids.northstar = byEmail('maya@northstar.example')?.partner_id ?? ''
}, 120_000)

afterAll(async () => {
  await db.drop()
})

describe('the handoff', () => {
  it('opens its session once, before the link expires, into a cookie of its own', async () => {
    clock = start
    const s = await impersonate(ids.diego)
    expect((await post('handoff', { token: 'not-a-token' })).status).toBe(400)
    clock = new Date(start.getTime() + 6 * 60_000)
    expect((await enter(s.token)).body).toEqual({ ok: false, code: 'HANDOFF_INVALID' })
    clock = start
    const entered = await enter(s.token)
    expect(entered.status).toBe(200)
    expect(entered.setCookie).toContain('HttpOnly')
    expect(entered.setCookie).not.toContain(partnerCookieName)
    expect(entered.body.session).toMatchObject({ id: s.id, kind: 'impersonation', state: 'open', endedBy: null, actingAs: { name: 'Diego Alvarez', role: 'partner-admin' } })
    expect(JSON.stringify(entered.body)).not.toContain(s.token)
    expect((await enter(s.token)).body.code).toBe('HANDOFF_INVALID')
    const caller = await signedIn(entered.cookie)
    expect(caller).toMatchObject({ role: 'partner-admin', user: { id: ids.diego }, staff: { id: as('staff-support').id, session: { kind: 'impersonation', id: s.id } }, partner: { id: ids.northstar } })
    await endFromAdmin(s.id)
  })

  it('never opens a session that has ended, and a return makes the old link stop working', async () => {
    clock = start
    const s = await impersonate(ids.diego)
    await endFromAdmin(s.id)
    expect((await enter(s.token)).body.code).toBe('HANDOFF_INVALID')
    const again = await impersonate(ids.diego)
    const { returnToSession } = await adminRun<{ returnToSession: { handoff: string } }>(`mutation($id: ID!) { returnToSession(id: $id) { handoff } }`, as('staff-support'), { id: again.id })
    expect((await enter(again.token)).body.code).toBe('HANDOFF_INVALID')
    expect((await enter(new URL(returnToSession.handoff).searchParams.get('token') ?? '')).status).toBe(200)
    await endFromAdmin(again.id)
  })
})

describe('the two caller kinds', () => {
  it('runs an impersonation as the user acted as, attributed to them on behalf of the staff member', async () => {
    clock = start
    const s = await impersonate(ids.diego)
    const caller = await signedIn((await enter(s.token)).cookie)
    expect((await platformRun<{ me: { id: string; role: string } }>(`{ me { id role } }`, caller)).data?.me).toEqual({ id: ids.diego, role: 'partner-admin' })
    expect((await platformRun<{ inviteTeamMember: { ok: boolean } }>(invite, caller, { email: 'imp.invitee@northstar.example' })).data?.inviteTeamMember.ok).toBe(true)
    expect(await lastEntry('partner_user.invited')).toEqual({
      actor_kind: 'partner_user',
      actor_id: ids.diego,
      on_behalf_of_kind: 'staff',
      on_behalf_of_id: as('staff-support').id,
      access_kind: 'impersonation',
      access_ref: s.id,
      api: 'platform',
    })
    await endFromAdmin(s.id)
  })

  it('runs a setup session as the staff member with the Owner’s powers, attributed to them', async () => {
    clock = start
    const s = await setUp(ids.northstar)
    const caller = await signedIn((await enter(s.token)).cookie)
    expect(caller.user).toBeNull()
    expect((await platformRun<{ me: { id: string; name: string; role: string } }>(`{ me { id name role } }`, caller)).data?.me).toEqual({ id: as('staff-super-admin').id, name: as('staff-super-admin').name, role: 'partner-owner' })
    // ACCESS.md §8.2: a setup session may invite partner users.
    expect((await platformRun<{ inviteTeamMember: { ok: boolean } }>(invite, caller, { email: 'setup.invitee@northstar.example' })).data?.inviteTeamMember.ok).toBe(true)
    expect(await lastEntry('partner_user.invited')).toEqual({
      actor_kind: 'staff',
      actor_id: as('staff-super-admin').id,
      on_behalf_of_kind: null,
      on_behalf_of_id: null,
      access_kind: 'setup_session',
      access_ref: s.id,
      api: 'platform',
    })
    await endFromAdmin(s.id)
  })
})

describe('the blocked lists', () => {
  const blockedFields = (kind: 'impersonation' | 'setup') => {
    const schema = platformSchema as GraphQLSchema
    return [schema.getQueryType(), schema.getMutationType()]
      .flatMap((type) => (type && isObjectType(type) ? Object.values(type.getFields()) : []))
      .filter((field) => field.extensions.access?.blockedFor?.includes(kind))
      .map((field) => field.name)
      .sort()
  }
  const support = ['endSupportSession', 'mySupportSession', 'reauthenticate', 'returnToSupportSession', 'startSupportSession', 'supportSessions', 'supportTargets']
  // Payment and payout details stay with the partner (ACCESS §8.1, §8.2; #201).
  const moneyDetails = ['setPaymentMethod', 'setPayoutAccount']

  it('refuses an impersonation ownership, the team’s sign-in rule, and the user’s own second factor and support access', () => {
    expect(blockedFields('impersonation')).toEqual([...support, ...moneyDetails, 'setSecondFactorPolicy', 'transferOwnership'].sort())
  })

  it('refuses a setup session ownership and support access, which need a partner user', () => {
    expect(blockedFields('setup')).toEqual([...support, ...moneyDetails, 'transferOwnership'].sort())
  })

  it('keeps who is Owner the partner’s own decision: no staff session makes, demotes or removes one', async () => {
    clock = start
    const role = `mutation($id: ID!, $role: String!) { changeTeamRole(id: $id, role: $role) { ok reason } }`
    const remove = `mutation($id: ID!) { removeTeamMember(id: $id) { ok reason } }`
    const imp = await impersonate(ids.maya)
    const owner = await signedIn((await enter(imp.token)).cookie)
    expect((await platformRun<{ changeTeamRole: unknown }>(role, owner, { id: ids.diego, role: 'partner-owner' })).data?.changeTeamRole).toEqual({ ok: false, reason: 'BLOCKED_WHILE_IMPERSONATING' })
    const inviteOwner = `mutation { inviteTeamMember(name: "Next Owner", email: "owner.by.imp@northstar.example", role: "partner-owner") { ok reason } }`
    expect((await platformRun<{ inviteTeamMember: unknown }>(inviteOwner, owner)).data?.inviteTeamMember).toEqual({ ok: false, reason: 'BLOCKED_WHILE_IMPERSONATING' })
    await endFromAdmin(imp.id)
    const setup = await setUp(ids.northstar)
    const staff = await signedIn((await enter(setup.token)).cookie)
    expect((await platformRun<{ changeTeamRole: unknown }>(role, staff, { id: ids.maya, role: 'partner-admin' })).data?.changeTeamRole).toEqual({ ok: false, reason: 'PARTNER_ENTERS_THIS_ITSELF' })
    expect((await platformRun<{ removeTeamMember: unknown }>(remove, staff, { id: ids.maya })).data?.removeTeamMember).toEqual({ ok: false, reason: 'PARTNER_ENTERS_THIS_ITSELF' })
    const invite = `mutation($email: String!, $role: String!) { inviteTeamMember(name: "Next Owner", email: $email, role: $role) { ok reason } }`
    expect((await platformRun<{ inviteTeamMember: unknown }>(invite, staff, { email: 'owner.by.setup@northstar.example', role: 'partner-owner' })).data?.inviteTeamMember).toEqual({ ok: false, reason: 'PARTNER_ENTERS_THIS_ITSELF' })
    // Roles that aren't Owner stay the setup session's to change.
    expect((await platformRun<{ changeTeamRole: unknown }>(role, staff, { id: ids.jess, role: 'partner-finance' })).data?.changeTeamRole).toEqual({ ok: true, reason: null })
    expect((await db.sql<{ role_key: string }[]>`select role_key from partner_user where id = ${ids.maya}`)[0]?.role_key).toBe('partner-owner')
    await endFromAdmin(setup.id)
  })

  it('answers each kind with its own code, on the server', async () => {
    clock = start
    const transfer = `mutation($id: ID!) { transferOwnership(toUserId: $id) { ok reason } }`
    const imp = await impersonate(ids.maya)
    expect((await platformRun(transfer, await signedIn((await enter(imp.token)).cookie), { id: ids.diego })).code).toBe('BLOCKED_WHILE_IMPERSONATING')
    await endFromAdmin(imp.id)
    const setup = await setUp(ids.northstar)
    const caller = await signedIn((await enter(setup.token)).cookie)
    expect((await platformRun(transfer, caller, { id: ids.diego })).code).toBe('PARTNER_ENTERS_THIS_ITSELF')
    expect((await platformRun(`{ supportTargets(first: 5) { items { name } } }`, caller)).code).toBe('PARTNER_ENTERS_THIS_ITSELF')
    await endFromAdmin(setup.id)
  })
})

describe('ending', () => {
  it('ends at its time', async () => {
    clock = start
    const s = await impersonate(ids.diego)
    const { cookie } = await enter(s.token)
    clock = new Date(start.getTime() + 31 * 60_000)
    expect(await callerFor(cookie)).toBeNull()
    expect(await current(cookie)).toMatchObject({ state: 'expired', endedBy: 'expiry' })
    clock = start
    await endFromAdmin(s.id)
  })

  it('ends from the admin console, and from the partner console, which logs it', async () => {
    clock = start
    const first = await impersonate(ids.diego)
    const one = await enter(first.token)
    await endFromAdmin(first.id)
    expect(await callerFor(one.cookie)).toBeNull()
    expect(await current(one.cookie)).toMatchObject({ state: 'ended', endedBy: 'staff' })

    const second = await impersonate(ids.diego)
    const two = await enter(second.token)
    const ended = await post('end-staff-session', { id: second.id }, two.cookie)
    expect(ended.status).toBe(200)
    expect(await callerFor(two.cookie)).toBeNull()
    expect(await current(two.cookie)).toMatchObject({ state: 'ended', endedBy: 'portal' })
    expect(await lastEntry('impersonation.ended')).toMatchObject({ actor_kind: 'staff', actor_id: as('staff-support').id, access_kind: 'impersonation', access_ref: second.id, api: 'platform' })
    const { staffSession } = await adminRun<{ staffSession: { session: { outcome: string } } }>(`query($id: ID!) { staffSession(id: $id) { session { outcome } } }`, as('staff-super-admin'), { id: second.id })
    expect(staffSession.session.outcome).toBe('endedFromPortal')
  })

  it('ends when its staff member signs out, which logs it and drops both cookies', async () => {
    clock = start
    const s = await impersonate(ids.diego)
    const { cookie } = await enter(s.token)
    const out = await post('sign-out', {}, cookie)
    expect(out.status).toBe(302)
    expect(out.headers.getSetCookie()).toEqual(expect.arrayContaining([expect.stringContaining(`${staffPortalCookieName}=;`), expect.stringContaining(`${partnerCookieName}=;`)]))
    expect(await current(cookie)).toMatchObject({ state: 'ended', endedBy: 'portal' })
    expect(await lastEntry('impersonation.ended')).toMatchObject({ actor_kind: 'staff', access_ref: s.id })
  })

  it('ends when the user acted as is suspended, and when the partner closes', async () => {
    clock = start
    const imp = await impersonate(ids.jess)
    const { cookie } = await enter(imp.token)
    await db.sql`update partner_user set status = 'suspended' where id = ${ids.jess}`
    expect(await callerFor(cookie)).toBeNull()
    expect(await current(cookie)).toMatchObject({ state: 'ended', endedBy: 'targetGone' })
    expect(await lastEntry('impersonation.ended')).toMatchObject({ actor_kind: 'job', access_ref: imp.id })
    expect((await db.sql<{ reason: string }[]>`select reason from activity_log where action = 'impersonation.ended' and access_ref = ${imp.id}`).map((r) => r.reason)).toEqual(['target_gone'])
    await db.sql`update partner_user set status = 'active' where id = ${ids.jess}`

    const [closing] = await db.sql<{ id: string }[]>`insert into partner (name, state) values ('Closing Soon', 'draft') returning id`
    const setup = await setUp(closing?.id ?? '')
    const entered = await enter(setup.token)
    expect(await callerFor(entered.cookie)).not.toBeNull()
    await db.sql`update partner set state = 'closed' where id = ${closing?.id ?? ''}`
    expect(await callerFor(entered.cookie)).toBeNull()
    expect(await current(entered.cookie)).toMatchObject({ state: 'ended', endedBy: 'partnerClosed' })
    expect(await lastEntry('setup_session.ended')).toMatchObject({ actor_kind: 'job', access_ref: setup.id })
  })
})

describe('the cookie', () => {
  it('reads its own session only, never another open at the same time', async () => {
    clock = start
    const imp = await impersonate(ids.diego)
    const setup = await setUp(ids.northstar)
    const [one, two] = [await enter(imp.token), await enter(setup.token)]
    expect(await current(one.cookie)).toMatchObject({ id: imp.id, kind: 'impersonation' })
    expect(await current(two.cookie)).toMatchObject({ id: setup.id, kind: 'setup' })
    expect(await current(`${staffPortalCookieName}=not-a-session`)).toBeNull()
    // Ending another session's id through one cookie ends nothing, and says so.
    const mismatched = await post('end-staff-session', { id: setup.id }, one.cookie)
    expect([mismatched.status, await mismatched.json()]).toEqual([400, { ok: false, code: 'SESSION_NOT_ENDED' }])
    expect(await current(two.cookie)).toMatchObject({ state: 'open' })
    await endFromAdmin(imp.id)
    await endFromAdmin(setup.id)
  })
})

describe('the polled routes', () => {
  it('cost a partner user nothing, and hold a staff cookie to a bucket of its own', async () => {
    clock = start
    const s = await impersonate(ids.diego)
    const { cookie } = await enter(s.token)
    allow = false
    try {
      expect((await post('staff-session', {})).status).toBe(200)
      expect((await post('staff-session', {}, cookie)).status).toBe(429)
      expect((await post('end-staff-session', { id: s.id }, cookie)).status).toBe(429)
    } finally {
      allow = true
    }
    expect(await current(cookie)).toMatchObject({ state: 'open' })
    await endFromAdmin(s.id)
  })
})

describe('the notice', () => {
  it('tells the partner’s own users who is in their console, and not the staff member', async () => {
    clock = start
    const s = await impersonate(ids.diego)
    const staff = await signedIn((await enter(s.token)).cookie)
    const user: PartnerCaller = { role: 'partner-owner', user: { id: ids.maya, name: 'Maya Chen', email: 'maya@northstar.example' }, staff: null, partner: staff.partner }
    const notice = `{ staffSessionNotice { kind staffName actingAs endsAt } }`
    expect((await platformRun<{ staffSessionNotice: unknown }>(notice, user)).data?.staffSessionNotice).toEqual({
      kind: 'impersonation',
      staffName: as('staff-support').name.split(' ')[0],
      actingAs: 'Diego Alvarez',
      endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
    })
    expect((await platformRun<{ staffSessionNotice: unknown }>(notice, staff)).data?.staffSessionNotice).toBeNull()
    // A setup session started after it doesn't hide that someone is acting as one of them.
    const setup = await setUp(ids.northstar)
    expect((await platformRun<{ staffSessionNotice: { kind: string } }>(notice, user)).data?.staffSessionNotice.kind).toBe('impersonation')
    const inSetup = await signedIn((await enter(setup.token)).cookie)
    expect((await platformRun<{ partnerState: { setupSession: unknown } }>(`{ partnerState { setupSession { staffName } } }`, inSetup)).data?.partnerState.setupSession).toBeNull()
    expect((await platformRun<{ partnerState: { setupSession: unknown } }>(`{ partnerState { setupSession { staffName } } }`, user)).data?.partnerState.setupSession).not.toBeNull()
    // Another partner's users hear of nothing on Northstar.
    const [other] = await db.sql<{ id: string; partner_id: string }[]>`select id, partner_id from partner_user where partner_id <> ${ids.northstar} and status = 'active' limit 1`
    const stranger: PartnerCaller = { role: 'partner-owner', user: { id: other?.id ?? '', name: 'Someone Else', email: 'else@example.com' }, staff: null, partner: { ...staff.partner, id: other?.partner_id ?? '' } }
    expect((await platformRun<{ staffSessionNotice: unknown }>(notice, stranger)).data?.staffSessionNotice).toBeNull()
    await endFromAdmin(setup.id)
    await endFromAdmin(s.id)
    expect((await platformRun<{ staffSessionNotice: unknown }>(notice, user)).data?.staffSessionNotice).toBeNull()
  })
})
