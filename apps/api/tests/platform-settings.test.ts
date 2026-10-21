import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { activityLog } from '#saas/activity/index'
import { createPartnerTeamService } from '#saas/partnerTeam/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #199: Settings on the Platform API: company, team, ownership and the 2-factor policy.

let db: TestDatabase
const now = new Date('2026-10-03T09:00:00Z')
const ids = { ns: '', bz: '', owner: '', admin: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }

const callerOf = (partnerId: string, role: PartnerRole, userId: string = crypto.randomUUID()): PartnerCaller => ({
  role,
  user: { id: userId, name: 'Maya Chen', email: 'maya@northstar.example' },
  staff: null,
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const team = createPartnerTeamService({ sql: db.sql, caller, facts, activity: activityLog, now: () => now })
  const contextValue = { caller, console: null, plans: null, branding: null, stores: null, storeActions: null, dashboard: null, domains: null, activity: null, team }
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined, raw: JSON.stringify(result) }
}

const invite = `mutation($name: String!, $email: String!, $role: String!) { inviteTeamMember(name: $name, email: $email, role: $role) { ok reason } }`
const role = `mutation($id: ID!, $role: String!) { changeTeamRole(id: $id, role: $role) { ok reason } }`
const remove = `mutation($id: ID!) { removeTeamMember(id: $id) { ok reason } }`
const teamQuery = `{ team(first: 25) { items { id name email role you status invitation { sentAt expired } secondFactor } pageInfo { hasNextPage } } }`
type Team = { team: { items: { id: string; email: string; role: string; status: string; invitation: { sentAt: string } | null; you: boolean }[] } }
type Res<K extends string> = Record<K, { ok: boolean; reason: string | null }>

const member = async (email: string) => (await db.sql<{ id: string; role_key: string; status: string }[]>`select id, role_key, status from partner_user where partner_id = ${ids.ns} and lower(email) = lower(${email})`)[0]
const addMember = async (email: string, roleKey: string, status = 'active') =>
  (await db.sql<{ id: string }[]>`insert into partner_user (partner_id, email, name, role_key, status) values (${ids.ns}, ${email}, ${email.split('@')[0] ?? 'x'}, ${roleKey}, ${status}) returning id`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  ids.ns = (await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`)[0]?.id ?? ''
  ids.bz = (await db.sql<{ id: string }[]>`select id from partner where name = 'Bazaar Cloud'`)[0]?.id ?? ''
  ids.owner = (await db.sql<{ id: string }[]>`select id from partner_user where partner_id = ${ids.ns} and role_key = 'partner-owner' and status = 'active' limit 1`)[0]?.id ?? ''
  ids.admin = await addMember('the.admin@northstar.example', 'partner-admin')
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('company and team', () => {
  it('reads the company with its contract and contacts, and only its own team', async () => {
    const company = (await run<{ partnerCompany: { name: string; contract: { feeCurrency: string; fees: { plan: string }[] }; mainContact: { email: string } } }>(
      `{ partnerCompany { name country contract { feeCurrency poweredByRemovable moreFees fees { plan fee { amount currency } } } mainContact { name email } billingContact { email } secondFactorRequired } }`,
      callerOf(ids.ns, 'partner-read-only'),
    )).data?.partnerCompany
    expect(company?.name).toBe('Northstar Commerce')
    expect(company?.contract.feeCurrency).toBe('USD')
    expect(company?.contract.fees.length).toBeGreaterThan(0)
    expect(company?.contract.fees.length).toBeLessThanOrEqual(50)
    const items = (await run<Team>(teamQuery, callerOf(ids.ns, 'partner-read-only', ids.owner))).data?.team.items ?? []
    expect(items.some((m) => m.you && m.id === ids.owner)).toBe(true)
    const bz = await db.sql<{ email: string }[]>`select email from partner_user where partner_id = ${ids.bz}`
    expect(items.some((m) => bz.some((b) => b.email === m.email))).toBe(false)
  })
})

describe('invitations', () => {
  it('answers a new address and one with an account under another partner byte for byte the same', async () => {
    const owner = callerOf(ids.ns, 'partner-owner', ids.owner)
    const [elsewhere] = await db.sql<{ email: string }[]>`select email from partner_user where partner_id = ${ids.bz} limit 1`
    const fresh = await run(invite, owner, { name: 'New Person', email: 'new.person@northstar.example', role: 'partner-support' })
    const other = await run(invite, owner, { name: 'Elsewhere', email: elsewhere?.email ?? '', role: 'partner-support' })
    expect(other.raw).toBe(fresh.raw)
    expect(JSON.parse(fresh.raw)).toEqual({ data: { inviteTeamMember: { ok: true, reason: null } } })
    for (const email of ['new.person@northstar.example', elsewhere?.email ?? '']) expect((await member(email))?.status).toBe('invited')
    expect((await db.sql`select 1 from outbox where payload->>'template' = 'partner-team-invitation' and partner_id = ${ids.ns}`).length).toBe(2)
    expect((await run<Res<'inviteTeamMember'>>(invite, owner, { name: 'Again', email: 'NEW.person@northstar.example', role: 'partner-admin' })).data?.inviteTeamMember).toEqual({ ok: false, reason: 'ALREADY_ON_TEAM' })
  })

  it('lets an Admin invite but never an Owner, and refuses Support at the policy', async () => {
    expect((await run<Res<'inviteTeamMember'>>(invite, callerOf(ids.ns, 'partner-admin', ids.admin), { name: 'O', email: 'o@northstar.example', role: 'partner-owner' })).data?.inviteTeamMember).toEqual({ ok: false, reason: 'OWNERS_ONLY' })
    expect((await run<Res<'inviteTeamMember'>>(invite, callerOf(ids.ns, 'partner-admin', ids.admin), { name: 'F', email: 'f@northstar.example', role: 'partner-finance' })).data?.inviteTeamMember).toEqual({ ok: true, reason: null })
    expect((await run(invite, callerOf(ids.ns, 'partner-support'), { name: 'S', email: 's@northstar.example', role: 'partner-support' })).code).toBe('FORBIDDEN')
  })

  it('resends with a new link and revokes, and never reaches another partner’s member', async () => {
    const owner = callerOf(ids.ns, 'partner-owner', ids.owner)
    const pending = await member('f@northstar.example')
    const resend = `mutation($id: ID!) { resendTeamInvite(id: $id) { ok reason } }`
    expect((await run<Res<'resendTeamInvite'>>(resend, owner, { id: pending?.id })).data?.resendTeamInvite).toEqual({ ok: true, reason: null })
    expect(await db.sql`select count(*)::int as n, count(*) filter (where revoked_at is null)::int as open from partner_invitation where partner_user_id = ${pending?.id ?? ''}`).toEqual([{ n: 2, open: 1 }])
    expect((await run<Res<'revokeTeamInvite'>>(`mutation($id: ID!) { revokeTeamInvite(id: $id) { ok reason } }`, owner, { id: pending?.id })).data?.revokeTeamInvite).toEqual({ ok: true, reason: null })
    expect((await member('f@northstar.example'))?.status).toBe('removed')
    const [theirs] = await db.sql<{ id: string }[]>`select id from partner_user where partner_id = ${ids.bz} limit 1`
    expect((await run<Res<'removeTeamMember'>>(remove, owner, { id: theirs?.id })).data?.removeTeamMember).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })
})

describe('roles, removal and ownership', () => {
  it('keeps an Owner, under two concurrent removals', async () => {
    const second = await addMember('second.owner@northstar.example', 'partner-owner')
    const [a, b] = await Promise.all([
      run<Res<'removeTeamMember'>>(remove, callerOf(ids.ns, 'partner-owner', ids.owner), { id: second }),
      run<Res<'removeTeamMember'>>(remove, callerOf(ids.ns, 'partner-owner', second), { id: ids.owner }),
    ])
    const outcomes = [a.data?.removeTeamMember, b.data?.removeTeamMember]
    expect(outcomes.filter((o) => o?.ok)).toHaveLength(1)
    // The other is refused: as the last Owner, or because its caller was just removed.
    expect(outcomes.filter((o) => o?.reason === 'LAST_OWNER' || o?.reason === 'NOT_ACTIVE')).toHaveLength(1)
    expect((await db.sql<{ n: number }[]>`select count(*)::int as n from partner_user where partner_id = ${ids.ns} and role_key = 'partner-owner' and status = 'active'`)[0]?.n).toBe(1)
    // Put the seeded Owner back if they were the one removed.
    await db.sql`update partner_user set status = 'active', role_key = 'partner-owner' where id = ${ids.owner}`
    await db.sql`update partner_user set status = 'removed' where id = ${second}`
  })

  it('refuses demoting the last Owner, an Admin touching an Owner, and removing oneself', async () => {
    const owner = callerOf(ids.ns, 'partner-owner', ids.owner)
    expect((await run<Res<'changeTeamRole'>>(role, owner, { id: ids.owner, role: 'partner-admin' })).data?.changeTeamRole).toEqual({ ok: false, reason: 'LAST_OWNER' })
    expect((await run<Res<'changeTeamRole'>>(role, callerOf(ids.ns, 'partner-admin', ids.admin), { id: ids.owner, role: 'partner-support' })).data?.changeTeamRole).toEqual({ ok: false, reason: 'OWNERS_ONLY' })
    expect((await run<Res<'removeTeamMember'>>(remove, callerOf(ids.ns, 'partner-admin', ids.admin), { id: ids.owner })).data?.removeTeamMember).toEqual({ ok: false, reason: 'OWNERS_ONLY' })
    expect((await run<Res<'removeTeamMember'>>(remove, owner, { id: ids.owner })).data?.removeTeamMember).toEqual({ ok: false, reason: 'CANNOT_REMOVE_SELF' })
    expect((await run<Res<'removeTeamMember'>>(remove, owner, { id: ids.owner.toUpperCase() })).data?.removeTeamMember).toEqual({ ok: false, reason: 'CANNOT_REMOVE_SELF' })
  })

  it('signs a removed person out at once, and logs it', async () => {
    const gone = await addMember('leaving@northstar.example', 'partner-admin')
    await db.sql`insert into partner_session (id_hash, partner_user_id, absolute_expires_at) values (${`h-${gone}`}, ${gone}, ${new Date(Date.now() + 3_600_000)})`
    expect((await run<Res<'removeTeamMember'>>(remove, callerOf(ids.ns, 'partner-admin', ids.admin), { id: gone })).data?.removeTeamMember).toEqual({ ok: true, reason: null })
    expect(await db.sql`select 1 from partner_session where partner_user_id = ${gone}`).toEqual([])
    expect((await member('leaving@northstar.example'))?.status).toBe('removed')
    expect((await db.sql`select 1 from activity_log where action = 'partner_user.removed' and target_id = ${gone}`).length).toBe(1)
  })

  it('transfers ownership to an active non-Owner, and the Owner becomes an Admin', async () => {
    const heir = await addMember('heir@northstar.example', 'partner-admin')
    const transfer = `mutation($to: ID!) { transferOwnership(toUserId: $to) { ok reason } }`
    expect((await run(transfer, callerOf(ids.ns, 'partner-admin', heir), { to: heir })).code).toBe('FORBIDDEN')
    expect((await run<Res<'transferOwnership'>>(transfer, callerOf(ids.ns, 'partner-owner', ids.owner), { to: heir })).data?.transferOwnership).toEqual({ ok: true, reason: null })
    expect(await db.sql`select id, role_key from partner_user where id in (${heir}, ${ids.owner}) order by role_key`).toEqual([
      { id: ids.owner, role_key: 'partner-admin' },
      { id: heir, role_key: 'partner-owner' },
    ])
    await db.sql`update partner_user set role_key = case when id = ${ids.owner} then 'partner-owner' else 'partner-admin' end where id in (${heir}, ${ids.owner})`
  })

  it('judges the caller by their role as it is now, not as the session began', async () => {
    const heir = await addMember('heir2@northstar.example', 'partner-admin')
    const stale = callerOf(ids.ns, 'partner-owner', ids.admin)
    // The session still says Owner; the team says Admin: the transfer is refused.
    expect((await run<Res<'transferOwnership'>>(`mutation($to: ID!) { transferOwnership(toUserId: $to) { ok reason } }`, stale, { to: heir })).data?.transferOwnership).toEqual({ ok: false, reason: 'OWNERS_ONLY' })
    expect((await run<Res<'changeTeamRole'>>(role, stale, { id: heir, role: 'partner-owner' })).data?.changeTeamRole).toEqual({ ok: false, reason: 'OWNERS_ONLY' })
  })
})

describe('2-factor policy', () => {
  it('judges a stale Owner session by the role as it is now', async () => {
    const policy = `mutation($r: Boolean!) { setSecondFactorPolicy(required: $r) { ok reason } }`
    expect((await run<Res<'setSecondFactorPolicy'>>(policy, callerOf(ids.ns, 'partner-owner', ids.admin), { r: false })).data?.setSecondFactorPolicy).toEqual({ ok: false, reason: 'OWNERS_ONLY' })
  })

  it('is the Owner’s to set, and logged', async () => {
    const policy = `mutation($r: Boolean!) { setSecondFactorPolicy(required: $r) { ok reason } }`
    expect((await run(policy, callerOf(ids.ns, 'partner-admin', ids.admin), { r: true })).code).toBe('FORBIDDEN')
    expect((await run<Res<'setSecondFactorPolicy'>>(policy, callerOf(ids.ns, 'partner-owner', ids.owner), { r: true })).data?.setSecondFactorPolicy).toEqual({ ok: true, reason: null })
    expect(await db.sql`select second_factor_required from partner where id = ${ids.ns}`).toEqual([{ second_factor_required: true }])
    expect((await db.sql`select 1 from activity_log where action = 'partner.second_factor_policy_set' and partner_id = ${ids.ns}`).length).toBe(1)
  })
})

describe('the rest of the rules', () => {
  it('pages the team both ways, 25 at most', async () => {
    for (let i = 0; i < 30; i += 1) await addMember(`member${i}@northstar.example`, 'partner-support')
    const q = `query($after: String, $before: String, $first: Int) { team(after: $after, before: $before, first: $first) { items { id } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }`
    type P = { team: { items: { id: string }[]; pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; startCursor: string; endCursor: string } } }
    const reader = callerOf(ids.ns, 'partner-read-only')
    const first = (await run<P>(q, reader, { first: 1000 })).data?.team
    expect(first?.items).toHaveLength(25)
    expect(first?.pageInfo.hasNextPage).toBe(true)
    const second = (await run<P>(q, reader, { after: first?.pageInfo.endCursor, first: 25 })).data?.team
    expect(second?.items.some((m) => first?.items.some((f) => f.id === m.id))).toBe(false)
    expect(second?.pageInfo.hasPreviousPage).toBe(true)
    const back = (await run<P>(q, reader, { before: second?.pageInfo.startCursor, first: 25 })).data?.team
    expect(back?.items.map((m) => m.id)).toEqual(first?.items.map((m) => m.id))
    const [active] = await db.sql<{ n: number }[]>`select count(*)::int as n from partner_user where partner_id = ${ids.ns} and status <> 'removed'`
    expect((first?.items.length ?? 0) + (second?.items.length ?? 0)).toBe(Math.min(active?.n ?? 0, 50))
  })

  it('answers an address already at three partners the same, and creates nothing', async () => {
    const email = 'busy.person@elsewhere.example'
    const others = await db.sql<{ id: string }[]>`select id from partner where id <> ${ids.ns} order by name limit 3`
    expect(others).toHaveLength(3)
    for (const p of others) await db.sql`insert into partner_user (partner_id, email, name, role_key, status) values (${p.id}, ${email}, 'Busy', 'partner-support', 'active')`
    const owner = callerOf(ids.ns, 'partner-owner', ids.owner)
    const fresh = await run(invite, owner, { name: 'Brand New', email: 'brand.new@northstar.example', role: 'partner-support' })
    const busy = await run(invite, owner, { name: 'Busy', email, role: 'partner-support' })
    expect(busy.raw).toBe(fresh.raw)
    expect(await member(email)).toBeUndefined()
  })

  it('refuses a caller who is no longer active, and an Admin making an Owner', async () => {
    const suspended = await addMember('suspended.admin@northstar.example', 'partner-admin', 'suspended')
    const target = await addMember('target@northstar.example', 'partner-support')
    expect((await run<Res<'changeTeamRole'>>(role, callerOf(ids.ns, 'partner-admin', suspended), { id: target, role: 'partner-finance' })).data?.changeTeamRole).toEqual({ ok: false, reason: 'NOT_ACTIVE' })
    expect((await run<Res<'changeTeamRole'>>(role, callerOf(ids.ns, 'partner-admin', ids.admin), { id: target, role: 'partner-owner' })).data?.changeTeamRole).toEqual({ ok: false, reason: 'OWNERS_ONLY' })
  })

  it('throttles invitations to one address', async () => {
    const owner = callerOf(ids.ns, 'partner-owner', ids.owner)
    expect((await run<Res<'inviteTeamMember'>>(invite, owner, { name: 'Flood', email: 'flood@northstar.example', role: 'partner-support' })).data?.inviteTeamMember.ok).toBe(true)
    const pending = await member('flood@northstar.example')
    const resend = `mutation($id: ID!) { resendTeamInvite(id: $id) { ok reason } }`
    const answers: (string | null | undefined)[] = []
    for (let i = 0; i < 4; i += 1) answers.push((await run<Res<'resendTeamInvite'>>(resend, owner, { id: pending?.id })).data?.resendTeamInvite.reason)
    expect(answers).toEqual([null, null, 'RATE_LIMITED', 'RATE_LIMITED'])
  })
})

describe('inviter throttle and isolation', () => {
  it('throttles one inviter past twenty an hour', async () => {
    const inviter = await addMember('busy.inviter@northstar.example', 'partner-admin')
    for (let i = 0; i < 20; i += 1) {
      await db.sql`insert into activity_log (category, action, result, actor_kind, actor_id, actor_label, partner_id, target_type, target_id, target_label, changes, api, visibility)
        values ('write', 'partner_user.invited', 'success', 'partner_user', ${inviter}, 'Busy', ${ids.ns}, 'partner_user', ${crypto.randomUUID()}, 'x', '[]'::jsonb, 'platform', 'partner')`
    }
    expect((await run<Res<'inviteTeamMember'>>(invite, callerOf(ids.ns, 'partner-admin', inviter), { name: 'One More', email: 'one.more@northstar.example', role: 'partner-support' })).data?.inviteTeamMember).toEqual({ ok: false, reason: 'RATE_LIMITED' })
  })

  it('never changes another partner’s member, whatever the mutation', async () => {
    const owner = callerOf(ids.ns, 'partner-owner', ids.owner)
    const [theirs] = await db.sql<{ id: string; role_key: string; status: string }[]>`select id, role_key, status from partner_user where partner_id = ${ids.bz} and status = 'active' limit 1`
    const mutations: [string, Record<string, unknown>][] = [
      [`mutation($id: ID!) { r: resendTeamInvite(id: $id) { ok reason } }`, { id: theirs?.id }],
      [`mutation($id: ID!) { r: revokeTeamInvite(id: $id) { ok reason } }`, { id: theirs?.id }],
      [`mutation($id: ID!) { r: changeTeamRole(id: $id, role: "partner-read-only") { ok reason } }`, { id: theirs?.id }],
      [`mutation($id: ID!) { r: removeTeamMember(id: $id) { ok reason } }`, { id: theirs?.id }],
      [`mutation($id: ID!) { r: transferOwnership(toUserId: $id) { ok reason } }`, { id: theirs?.id }],
    ]
    for (const [source, variables] of mutations) expect((await run<{ r: unknown }>(source, owner, variables)).data?.r, source).toEqual({ ok: false, reason: 'NOT_FOUND' })
    expect(await db.sql`select id, role_key, status from partner_user where id = ${theirs?.id ?? ''}`).toEqual([theirs])
  })

  it('keeps addresses out of a transfer’s changes; the label names the new Owner, as LOGGING §4 says', async () => {
    const [entry] = await db.sql<{ changes: { before: unknown; after: unknown }[]; target_label: string }[]>`select changes, target_label from activity_log where action = 'partner.ownership_transferred' and partner_id = ${ids.ns} limit 1`
    expect(JSON.stringify(entry?.changes)).not.toContain('@')
    // Labels are the fields erasure clears (LOGGING §8); `changes` is not, so it holds ids.
    expect(entry?.target_label).toBe('heir@northstar.example')
  })
})

describe('the contract block', () => {
  it('lists at most fifty fees and says when there are more', async () => {
    const plans = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) select ${ids.ns}, 'Fee plan ' || g, 'draft' from generate_series(1, 51) g returning id`
    for (const p of plans) await db.sql`insert into plan_fee (plan_id, partner_id, amount, currency) values (${p.id}, ${ids.ns}, 100, 'USD')`
    const contract = (await run<{ partnerCompany: { contract: { fees: unknown[]; moreFees: boolean } } }>(`{ partnerCompany { contract { moreFees fees { plan } } } }`, callerOf(ids.ns, 'partner-read-only'))).data?.partnerCompany.contract
    expect(contract?.fees).toHaveLength(50)
    expect(contract?.moreFees).toBe(true)
  })
})
