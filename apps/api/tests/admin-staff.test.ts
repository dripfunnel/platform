import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleAuth } from '#apis/admin/auth'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import { createSession } from '#auth/session'
import type { StaffMember, StaffRole } from '#auth/staff'
import { mintStaffInvitationToken } from '#auth/staffTokens'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createStaffMembersService } from '#saas/staffMembers/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #39: Staff on the Admin API, invitations bound by SSO, and the last Super admin.

let db: TestDatabase
let now = new Date('2026-10-02T12:00:00Z')
const staffByRole = new Map<StaffRole, StaffMember>()
const request = new Request('https://admin.dripfunnel.com/api', { headers: { 'cf-ray': 'ray-test', 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'test' } })

const contextFor = (staff: StaffMember | null): AdminContext => ({
  staff,
  isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target),
  activity: async () => ({ ok: false, code: 'INVALID_FILTER' }),
  staffMembers: staff ? createStaffMembersService({ sql: db.sql, staff, facts: factsOf(request), activity: activityLog, now: () => now }) : null,
  partners: null,
  stores: null,
  provisioning: null,
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

const list = `query($after: String, $before: String, $first: Int) { staff(after: $after, before: $before, first: $first) {
  items { id name email role lastSignInAt twoFactor invitation { sentAt expiresAt expired } actions { changeRole { allowed reason } remove { allowed reason } resend { allowed reason } revoke { allowed reason } } }
  pageInfo { startCursor endCursor hasNextPage hasPreviousPage } soleSuperAdmin } }`
type Member = { id: string; name: string | null; email: string; role: string; twoFactor: string; invitation: { expired: boolean } | null; actions: Record<string, { allowed: boolean; reason: string | null } | null> }
type Page = { staff: { items: Member[]; pageInfo: { startCursor: string; endCursor: string; hasPreviousPage: boolean }; soleSuperAdmin: boolean } }
const invite = `mutation($e: String!, $r: String!) { inviteStaff(email: $e, role: $r) { ok reason } }`
const role = `mutation($id: ID!, $r: String!) { changeStaffRole(id: $id, role: $r) { ok reason } }`
const remove = `mutation($id: ID!) { removeStaff(id: $id) { ok reason } }`
const resend = `mutation($id: ID!) { resendStaffInvite(id: $id) { ok reason } }`
const revoke = `mutation($id: ID!) { revokeStaffInvite(id: $id) { ok reason } }`
type R<K extends string> = Record<K, { ok: boolean; reason: string | null }>

const memberByEmail = async (email: string) => (await db.sql<{ id: string; status: string; role_key: string; sso_subject: string | null }[]>`select id, status, role_key, sso_subject from staff_user where lower(email) = lower(${email}) order by created_at desc`)[0]
const openInvitationOf = async (staffId: string) => (await db.sql<{ id: string }[]>`select id from staff_invitation where staff_user_id = ${staffId} and accepted_at is null and revoked_at is null`)[0]?.id ?? ''
const activeSuper = async (email: string, subject: string): Promise<StaffMember> => {
  const [row] = await db.sql<{ id: string }[]>`insert into staff_user (sso_subject, email, name, role_key, status) values (${subject}, ${email}, ${email}, 'staff-super-admin', 'active') returning id`
  return { id: row?.id ?? '', email, name: email, role: 'staff-super-admin' }
}

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  const rows = await db.sql<{ id: string; email: string; name: string; role_key: StaffRole }[]>`select id, email, name, role_key from staff_user where status = 'active' order by created_at`
  for (const r of rows) if (!staffByRole.has(r.role_key)) staffByRole.set(r.role_key, { id: r.id, email: r.email, name: r.name, role: r.role_key })
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the list', () => {
  it('is Super admin only, pages both ways onto the same rows, and says when there is one Super admin', async () => {
    expect((await run(list, as('staff-support'))).code).toBe('FORBIDDEN')
    const sa = as('staff-super-admin')
    const first = (await run<Page>(list, sa, { first: 2 })).data?.staff
    const second = (await run<Page>(list, sa, { first: 2, after: first?.pageInfo.endCursor })).data?.staff
    expect(second?.pageInfo.hasPreviousPage).toBe(true)
    const back = (await run<Page>(list, sa, { first: 2, before: second?.pageInfo.startCursor })).data?.staff
    expect(back?.items.map((m) => m.id)).toEqual(first?.items.map((m) => m.id))
    expect(first?.soleSuperAdmin).toBe(true)
    const me = (await run<Page>(list, sa, { first: 25 })).data?.staff.items.find((m) => m.id === sa.id)
    expect(me?.actions['changeRole']).toEqual({ allowed: false, reason: 'LAST_SUPER_ADMIN' })
  })
})

describe('invitations', () => {
  it('invites by email with a role, refuses an address already on staff, and logs what changed', async () => {
    const sa = as('staff-super-admin')
    expect((await run<R<'inviteStaff'>>(invite, sa, { e: 'new.hire@dripfunnel.example', r: 'staff-support' })).data?.inviteStaff).toEqual({ ok: true, reason: null })
    expect((await run<R<'inviteStaff'>>(invite, sa, { e: 'NEW.HIRE@dripfunnel.example', r: 'staff-finance' })).data?.inviteStaff).toEqual({ ok: false, reason: 'ALREADY_STAFF' })
    expect((await run(invite, as('staff-support'), { e: 'x@dripfunnel.example', r: 'staff-support' })).code).toBe('FORBIDDEN')
    const hire = await memberByEmail('new.hire@dripfunnel.example')
    expect(hire).toMatchObject({ status: 'invited', role_key: 'staff-support', sso_subject: null })
    const row = (await run<Page>(list, sa, { first: 25 })).data?.staff.items.find((m) => m.id === hire?.id)
    expect(row).toMatchObject({ name: null, twoFactor: 'notSignedIn', invitation: { expired: false } })
    expect(row?.actions).toMatchObject({ remove: { allowed: false, reason: 'PENDING_INVITATION' }, resend: { allowed: true }, revoke: { allowed: true } })
    expect(await db.sql`select 1 from outbox where kind = 'email' and payload->>'template' = 'staff-invitation'`).toHaveLength(1)
    const [logged] = await db.sql<{ changes: { field: string; after: string }[]; target_id: string }[]>`select changes, target_id from activity_log where action = 'staff.invited'`
    expect(logged).toMatchObject({ target_id: hire?.id, changes: [{ field: 'role', after: 'staff-support' }] })
    expect(JSON.stringify(await run<Page>(list, sa, { first: 25 }))).not.toMatch(/token/i)
  })

  describe('accepting through SSO', () => {
    const claimsFor: Record<string, { subject: string; email: string; name: string; twoFactor?: boolean }> = {
      hire: { subject: 'sso-new-hire', email: 'New.Hire@dripfunnel.example', name: 'New Hire', twoFactor: true },
      stranger: { subject: 'sso-stranger', email: 'someone.else@dripfunnel.example', name: 'Someone Else' },
    }
    const provider = { authorizeUrl: () => 'https://login.microsoftonline.com/authorize', exchange: async ({ code }: { code: string }) => claimsFor[code] ?? claimsFor['stranger'] ?? { subject: '', email: '', name: '' } }
    const deps = () => ({ sql: db.sql, provider, activity: activityLog, adminHost: 'admin.dripfunnel.com', now: () => now, allowAttempt: async () => true })
    const start = (token: string) => handleAuth(new Request(`https://admin.dripfunnel.com/api/auth/accept-invitation?token=${token}`), deps())
    const back = async (started: Response, code: string) => {
      const cookie = started.headers.get('set-cookie')?.split(';')[0] ?? ''
      const state = cookie.split('=')[1]?.split('.')[0] ?? ''
      return handleAuth(new Request(`https://admin.dripfunnel.com/api/auth/callback?code=${code}&state=${state}`, { headers: { cookie } }), deps())
    }
    const mint = async (email: string) => {
      const invitationId = await openInvitationOf((await memberByEmail(email))?.id ?? '')
      return (await withSystemScope(db.sql, (tx) => mintStaffInvitationToken(tx, invitationId, now))) ?? ''
    }

    it('binds the invited address’s SSO account once, records the second factor, and refuses another address or a second use', async () => {
      const token = await mint('new.hire@dripfunnel.example')
      expect(token).not.toBe('')
      const started = await start(token)
      expect(started.headers.get('location')).toContain('login.microsoftonline.com')
      expect(started.headers.get('set-cookie')).not.toContain(token)
      // The wrong person: the link was forwarded, or opened while signed in as someone else.
      expect((await back(started, 'stranger')).headers.get('location')).toContain('outcome=refused')
      expect((await memberByEmail('new.hire@dripfunnel.example'))?.status).toBe('invited')
      const signedIn = await back(await start(token), 'hire')
      expect(signedIn.headers.get('set-cookie')).toContain('__Host-df_admin_session')
      expect(await memberByEmail('new.hire@dripfunnel.example')).toMatchObject({ status: 'active', sso_subject: 'sso-new-hire' })
      const row = (await run<Page>(list, as('staff-super-admin'), { first: 25 })).data?.staff.items.find((m) => m.email === 'new.hire@dripfunnel.example')
      expect(row).toMatchObject({ name: 'New Hire', twoFactor: 'on', invitation: null })
      expect((await start(token)).headers.get('location')).toContain('outcome=refused')
      const entries = await db.sql<{ action: string }[]>`select action from activity_log where action in ('staff.invitation_accepted', 'staff.sign_in_refused') order by occurred_at`
      expect(entries.map((e) => e.action)).toEqual(expect.arrayContaining(['staff.invitation_accepted', 'staff.sign_in_refused']))
      expect(JSON.stringify(await db.sql`select * from activity_log`)).not.toContain(token)
    })

    it('kills the old link on resend, refuses an expired one, and revokes', async () => {
      const sa = as('staff-super-admin')
      await run(invite, sa, { e: 'later@dripfunnel.example', r: 'staff-finance' })
      const member = await memberByEmail('later@dripfunnel.example')
      const old = await mint('later@dripfunnel.example')
      expect((await run<R<'resendStaffInvite'>>(resend, sa, { id: member?.id })).data?.resendStaffInvite.ok).toBe(true)
      expect((await start(old)).headers.get('location')).toContain('outcome=refused')
      const fresh = await mint('later@dripfunnel.example')
      now = new Date(now.getTime() + 8 * 86_400_000)
      expect((await start(fresh)).headers.get('location')).toContain('outcome=refused')
      now = new Date('2026-10-02T12:00:00Z')
      expect((await run<R<'revokeStaffInvite'>>(revoke, sa, { id: member?.id })).data?.revokeStaffInvite.ok).toBe(true)
      expect((await memberByEmail('later@dripfunnel.example'))?.status).toBe('removed')
      expect((await run<R<'revokeStaffInvite'>>(revoke, sa, { id: as('staff-support').id })).data?.revokeStaffInvite.reason).toBe('NOT_PENDING')
      // An address whose invitation was revoked may be invited again.
      expect((await run<R<'inviteStaff'>>(invite, sa, { e: 'later@dripfunnel.example', r: 'staff-finance' })).data?.inviteStaff.ok).toBe(true)
    })

    it('lets a removed member, invited again, bind the same SSO account', async () => {
      const sa = as('staff-super-admin')
      const hire = await memberByEmail('new.hire@dripfunnel.example')
      expect((await run<R<'removeStaff'>>(remove, sa, { id: hire?.id })).data?.removeStaff.ok).toBe(true)
      expect((await run<R<'inviteStaff'>>(invite, sa, { e: 'new.hire@dripfunnel.example', r: 'staff-read-only' })).data?.inviteStaff.ok).toBe(true)
      const signedIn = await back(await start(await mint('new.hire@dripfunnel.example')), 'hire')
      expect(signedIn.headers.get('set-cookie')).toContain('__Host-df_admin_session')
      expect(await memberByEmail('new.hire@dripfunnel.example')).toMatchObject({ status: 'active', role_key: 'staff-read-only', sso_subject: 'sso-new-hire' })
    })

    it('rate-limits the invitation link', async () => {
      const limited = await handleAuth(new Request('https://admin.dripfunnel.com/api/auth/accept-invitation?token=x'), { ...deps(), allowAttempt: async () => false })
      expect(limited.status).toBe(429)
    })
  })
})

describe('roles and removal', () => {
  it('changes a role, refuses the same one, and removes a member, ending their sessions', async () => {
    const sa = as('staff-super-admin')
    const [row] = await db.sql<{ id: string }[]>`insert into staff_user (sso_subject, email, name, role_key, status) values ('sso-finance', 'fin@dripfunnel.example', 'Fin', 'staff-finance', 'active') returning id`
    const finance: StaffMember = { id: row?.id ?? '', email: 'fin@dripfunnel.example', name: 'Fin', role: 'staff-finance' }
    expect((await run<R<'changeStaffRole'>>(role, sa, { id: finance.id, r: 'staff-finance' })).data?.changeStaffRole.reason).toBe('SAME_ROLE')
    expect((await run<R<'changeStaffRole'>>(role, sa, { id: finance.id, r: 'staff-read-only' })).data?.changeStaffRole.ok).toBe(true)
    const [changed] = await db.sql<{ changes: { before: string; after: string }[] }[]>`select changes from activity_log where action = 'staff.role_changed' and target_id = ${finance.id}`
    expect(changed?.changes[0]).toMatchObject({ before: 'staff-finance', after: 'staff-read-only' })
    await withSystemScope(db.sql, (tx) => createSession(tx, finance.id, now))
    expect((await run<R<'removeStaff'>>(remove, sa, { id: finance.id })).data?.removeStaff.ok).toBe(true)
    expect(await db.sql`select 1 from staff_session where staff_user_id = ${finance.id}`).toHaveLength(0)
    expect((await run<R<'removeStaff'>>(remove, sa, { id: finance.id })).data?.removeStaff.reason).toBe('NOT_FOUND')
    expect((await run(remove, as('staff-support'), { id: sa.id })).code).toBe('FORBIDDEN')
  })

  it('never leaves the console without an accepted Super admin, even under two demotions at once', async () => {
    const supers = await db.sql<{ id: string }[]>`select id from staff_user where role_key = 'staff-super-admin' and status = 'active'`
    const original = as('staff-super-admin')
    // Down to one, then refused, including the Super admin changing themselves.
    expect(supers).toHaveLength(1)
    expect((await run<R<'changeStaffRole'>>(role, original, { id: original.id, r: 'staff-support' })).data?.changeStaffRole.reason).toBe('LAST_SUPER_ADMIN')
    expect((await run<R<'removeStaff'>>(remove, original, { id: original.id })).data?.removeStaff.reason).toBe('LAST_SUPER_ADMIN')
    const second = await activeSuper('second.super@dripfunnel.example', 'sso-second-super')
    // Two Super admins demote each other at the same moment: exactly one wins.
    const [a, b] = await Promise.all([run<R<'changeStaffRole'>>(role, original, { id: second.id, r: 'staff-support' }), run<R<'changeStaffRole'>>(role, second, { id: original.id, r: 'staff-support' })])
    const outcomes = [a.data?.changeStaffRole, b.data?.changeStaffRole]
    expect(outcomes.filter((o) => o?.ok)).toHaveLength(1)
    expect(outcomes.filter((o) => o?.reason === 'LAST_SUPER_ADMIN')).toHaveLength(1)
    expect((await db.sql<{ n: number }[]>`select count(*)::int as n from staff_user where role_key = 'staff-super-admin' and status = 'active'`)[0]?.n).toBe(1)
  })
})

describe('the schema', () => {
  it('carries no invitation link or token', () => {
    const fields = Object.values((adminSchema as GraphQLSchema).getTypeMap())
      .filter((t) => t.name.startsWith('Staff') && 'getFields' in t)
      .flatMap((t) => Object.keys((t as unknown as { getFields: () => Record<string, unknown> }).getFields()))
    expect(fields.filter((f) => /token|link|url|hash/i.test(f))).toEqual([])
  })
})
