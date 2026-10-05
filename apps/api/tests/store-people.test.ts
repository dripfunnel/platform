import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #290 (SAPI 2, part 5): Settings › People — the store's merchant side, Owner only, every read
// and write held to the acting store (ACCESS.md §6, §11).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
const people = { owner: '', manager: '', staff: '', supplier: '', bOwner: '' }
const cookies = { owner: '', manager: '', staff: '', supplier: '', bOwner: '' }

const subscribe = async (storeId: string, partnerId: string, planId: string) => {
  await db.sql`update store set plan_id = ${planId} where id = ${storeId}`
  await db.sql`
    insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${planId}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})
  `
}

const user = async (partnerId: string, email: string, name: string) => {
  const [row] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`
  return row?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'portal', 'store.partner-a.example', 'live', 'CNAME', 'x')`
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia Owner')
  people.manager = await user(t.partnerA, 'manager@a.example', 'Mo Manager')
  people.staff = await user(t.partnerA, 'staff@a.example', 'Sam Staff')
  people.supplier = await user(t.partnerA, 'nadia@northwind.example', 'Nadia Tran')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea Owner')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.manager}, ${t.storeA1}, 'manager', 'active'), (${people.staff}, ${t.storeA1}, 'staff', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active')`
  // Room for the team: the plan's staff seats are tested on a store of their own below.
  for (const [partnerId, storeId] of [[t.partnerA, t.storeA1], [t.partnerB, t.storeB1]] as const) {
    const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, 'Team', 'live') returning id`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, 'staff', 50)`
    await subscribe(storeId, partnerId, plan?.id ?? '')
  }
  for (const name of Object.keys(cookies) as (keyof typeof cookies)[]) {
    cookies[name] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[name], partnerId: name === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string, who: keyof typeof cookies, storeId = who === 'bOwner' ? t.storeB1 : t.storeA1, extra: Record<string, string> = {}) => {
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const request = new Request('https://store.example/api/', { headers: { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeId, ...extra } })
  const standing = await resolveStoreStanding(db.sql, request, partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

type Person = { id: string; kind: string; email: string; role: string; you: boolean }
const list = async (filter = 'all') => ((await gql(`{ people(filter: "${filter}") { nodes { id kind email role you } } }`, 'owner')).data?.['people'] as { nodes: Person[] }).nodes

describe('who sees People', () => {
  it('lists the merchant side to the Owner, marks them, and leaves supplier users out', async () => {
    const nodes = await list()
    expect(nodes.map((n) => n.email).sort()).toEqual(['manager@a.example', 'owner@a.example', 'staff@a.example'])
    expect(nodes.find((n) => n.you)?.email).toBe('owner@a.example')
    expect((await gql('{ peopleCounts { staff waiting } }', 'owner')).data?.['peopleCounts']).toEqual({ staff: 3, waiting: 0 })
  })

  it('refuses a Manager, Staff and a supplier, and shows another store’s Owner only their own store', async () => {
    for (const who of ['manager', 'staff'] as const) expect((await gql('{ people { nodes { id } } }', who)).code).toBe('FORBIDDEN')
    expect((await gql('{ people { nodes { id } } }', 'supplier', t.storeA1, { [supplierHeader]: t.sellerA1First })).code).toBe('FORBIDDEN')
    const b = (await gql('{ people { nodes { email } } }', 'bOwner')).data?.['people'] as { nodes: { email: string }[] }
    expect(b.nodes.map((n) => n.email)).toEqual(['owner@b.example'])
    expect((await gql('{ people { nodes { email } } }', 'bOwner', t.storeA1)).code).toBe('FORBIDDEN')
  })
})

describe('inviting', () => {
  it('invites a new or existing person the same way, waiting until they accept, with one email each', async () => {
    const existing = await user(t.partnerA, 'elsewhere@a.example', 'Elsewhere')
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${existing}, ${t.storeA2}, 'staff', 'active')`
    for (const email of ['brand.new@a.example', 'elsewhere@a.example']) {
      expect((await gql(`mutation { inviteMember(email: "${email}", role: "staff") }`, 'owner')).data?.['inviteMember']).toBe(true)
    }
    const waiting = await list('waiting')
    expect(waiting.map((n) => n.email).sort()).toEqual(['brand.new@a.example', 'elsewhere@a.example'])
    const emails = await db.sql<{ to: string }[]>`select payload->>'to' as to from outbox where kind = 'email' and payload->>'template' = 'store-owner-invitation' order by created_at`
    expect(emails.map((e) => e.to).sort()).toEqual(['brand.new@a.example', 'elsewhere@a.example'])
    const [made] = await db.sql<{ status: string; partner_id: string }[]>`select status, partner_id from "user" where email = 'brand.new@a.example'`
    expect(made).toEqual({ status: 'invited', partner_id: t.partnerA })
  })

  it('refuses only someone already in this store, and a bad address or role', async () => {
    expect((await gql('mutation { inviteMember(email: "STAFF@a.example", role: "staff") }', 'owner')).code).toBe('ALREADY_MEMBER')
    expect((await gql('mutation { inviteMember(email: "nope", role: "staff") }', 'owner')).code).toBe('INVALID_EMAIL')
    expect((await gql('mutation { inviteMember(email: "x@a.example", role: "god") }', 'owner')).code).toBe('INVALID_INPUT')
    expect((await gql('mutation { inviteMember(email: "x@a.example", role: "staff") }', 'manager')).code).toBe('FORBIDDEN')
  })

  it('resends with a new link that replaces the old, and cancels', async () => {
    await gql('mutation { inviteMember(email: "resend.me@a.example", role: "manager") }', 'owner')
    const first = (await list('waiting')).find((n) => n.email === 'resend.me@a.example')
    expect((await gql(`mutation { resendInvitation(invitationId: "${first?.id}") }`, 'owner')).data?.['resendInvitation']).toBe(true)
    const [old] = await db.sql<{ revoked_at: Date | null }[]>`select revoked_at from invitation where id = ${first?.id ?? ''}`
    expect(old?.revoked_at).not.toBeNull()
    const second = (await list('waiting')).find((n) => n.email === 'resend.me@a.example')
    expect(second?.id).not.toBe(first?.id)
    expect(second?.role).toBe('manager')
    expect((await gql(`mutation { revokeInvitation(invitationId: "${second?.id}") }`, 'owner')).data?.['revokeInvitation']).toBe(true)
    expect((await list('waiting')).some((n) => n.email === 'resend.me@a.example')).toBe(false)
    expect((await gql(`mutation { revokeInvitation(invitationId: "${second?.id}") }`, 'owner')).code).toBe('NOT_FOUND')
  })

  it('never resends or cancels another store’s invitation', async () => {
    await gql('mutation { inviteMember(email: "b.invitee@b.example", role: "staff") }', 'bOwner')
    const [theirs] = await db.sql<{ id: string }[]>`select id from invitation where email = 'b.invitee@b.example'`
    expect((await gql(`mutation { revokeInvitation(invitationId: "${theirs?.id}") }`, 'owner')).code).toBe('NOT_FOUND')
    expect((await gql(`mutation { resendInvitation(invitationId: "${theirs?.id}") }`, 'owner')).code).toBe('NOT_FOUND')
  })

  it('holds a store to its plan’s staff seats, never counting an Owner', async () => {
    const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerA}, 'Tiny', 'live') returning id`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${t.partnerA}, 1, 'staff', 2)`
    await subscribe(t.storeA2, t.partnerA, plan?.id ?? '')
    const owner2 = await user(t.partnerA, 'owner2@a.example', 'Owner Two')
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${owner2}, ${t.storeA2}, 'owner', 'active')`
    const c = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: owner2, partnerId: t.partnerA }, now))
    const as = async (source: string) => {
      const facts = { requestId: 'r', ip: null, userAgent: null }
      const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers: { cookie: `${storeCookieName}=${c}`, [storeHeader]: t.storeA2 } }), t.partnerA, now, activityLog, facts)
      const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue: { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => now } satisfies StoreContext })
      return result.errors?.[0]?.extensions['code'] as string | undefined
    }
    // storeA2 already has `elsewhere@a.example` as staff: one more fills the two seats.
    expect(await as('mutation { inviteMember(email: "seat2@a.example", role: "staff") }')).toBeUndefined()
    expect(await as('mutation { inviteMember(email: "seat3@a.example", role: "staff") }')).toBe('PLAN_LIMIT')
    expect(await as('mutation { inviteMember(email: "another.owner@a.example", role: "owner") }')).toBeUndefined()
    // Re-inviting a pending address at the limit frees its own seat as it takes it.
    expect(await as('mutation { inviteMember(email: "seat2@a.example", role: "manager") }')).toBeUndefined()
    // Demoting an Owner takes a seat too: with both seats filled it is refused.
    const [secondOwner] = await db.sql<{ id: string }[]>`select m.id from membership m join "user" u on u.id = m.user_id where m.store_id = ${t.storeA2} and u.email = 'owner2@a.example'`
    const extraOwner = await user(t.partnerA, 'owner3@a.example', 'Owner Three')
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${extraOwner}, ${t.storeA2}, 'owner', 'active')`
    expect(await as(`mutation { changeRole(membershipId: "${secondOwner?.id}", role: "staff") }`)).toBe('PLAN_LIMIT')
  })
})

describe('limits on invitations', () => {
  it('caps an address at three invitations a day, resends included, and lets an expired one be resent', async () => {
    await gql('mutation { inviteMember(email: "often@a.example", role: "staff") }', 'owner')
    const first = (await list('waiting')).find((n) => n.email === 'often@a.example')
    await db.sql`update invitation set expires_at = ${new Date(now.getTime() - 1000)} where id = ${first?.id ?? ''}`
    expect((await gql(`mutation { resendInvitation(invitationId: "${first?.id}") }`, 'owner')).data?.['resendInvitation']).toBe(true)
    const second = (await list('waiting')).find((n) => n.email === 'often@a.example')
    expect((await gql(`mutation { resendInvitation(invitationId: "${second?.id}") }`, 'owner')).data?.['resendInvitation']).toBe(true)
    const third = (await list('waiting')).find((n) => n.email === 'often@a.example')
    expect((await gql(`mutation { resendInvitation(invitationId: "${third?.id}") }`, 'owner')).code).toBe('RATE_LIMITED')
  })

  it('caps an inviter at twenty invitations an hour', async () => {
    await db.sql`
      insert into invitation (store_id, email, role_key, expires_at, invited_by_user_id, invited_by_label, created_at, revoked_at)
      select ${t.storeA1}, 'bulk' || n || '@a.example', 'staff', ${new Date(now.getTime() + 86_400_000)}, ${people.owner}, 'Olivia', ${now}, ${now} from generate_series(1, 20) n
    `
    expect((await gql('mutation { inviteMember(email: "twenty.first@a.example", role: "staff") }', 'owner')).code).toBe('RATE_LIMITED')
    await db.sql`delete from invitation where email like 'bulk%@a.example'`
  })
})

describe('seats under concurrency', () => {
  it('lets only one of two invitations racing for the last seat through', async () => {
    // Store B already has one pending Staff invitation (above): two seats leave exactly one free.
    const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerB}, 'Two seats', 'live') returning id`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${t.partnerB}, 1, 'staff', 2)`
    await db.sql`update store_subscription set plan_id = ${plan?.id ?? ''} where store_id = ${t.storeB1}`
    await db.sql`update store set plan_id = ${plan?.id ?? ''} where id = ${t.storeB1}`
    const answers = await Promise.all(['race.one@b.example', 'race.two@b.example'].map(async (email) => (await gql(`mutation { inviteMember(email: "${email}", role: "staff") }`, 'bOwner')).code))
    expect(answers.filter((c) => c === undefined)).toHaveLength(1)
    expect(answers.filter((c) => c === 'PLAN_LIMIT')).toHaveLength(1)
  })
})

describe('accounts that can’t be invited', () => {
  it('answers a suspended account exactly as any other, with no membership and no email', async () => {
    const suspended = await user(t.partnerA, 'suspended.account@a.example', 'Suspended')
    await db.sql`update "user" set status = 'suspended' where id = ${suspended}`
    expect((await gql('mutation { inviteMember(email: "suspended.account@a.example", role: "staff") }', 'owner')).data?.['inviteMember']).toBe(true)
    expect(await db.sql`select 1 from membership where user_id = ${suspended}`).toHaveLength(0)
    expect(await db.sql`select 1 from outbox where kind = 'email' and payload->>'to' = 'suspended.account@a.example'`).toHaveLength(0)
    expect((await list('waiting')).some((n) => n.email === 'suspended.account@a.example')).toBe(true)
  })
})

describe('the last Owner under concurrency', () => {
  it('lets only one of two Owners demoting each other at once through', async () => {
    const [a, b] = [await user(t.partnerB, 'co.owner.a@b.example', 'Co A'), await user(t.partnerB, 'co.owner.b@b.example', 'Co B')]
    const store = (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code) values (${t.partnerB}, 'Two Owners', 'two-owners') returning id`)[0]?.id ?? ''
    const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerB}, 'Roomy', 'live') returning id`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${t.partnerB}, 1, 'staff', 10)`
    await subscribe(store, t.partnerB, plan?.id ?? '')
    const memberships = await db.sql<{ id: string; user_id: string }[]>`
      insert into membership (user_id, store_id, role_key, status) values (${a}, ${store}, 'owner', 'active'), (${b}, ${store}, 'owner', 'active') returning id, user_id`
    const asOwner = async (userId: string, membershipId: string) => {
      const cookie = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: userId, partnerId: t.partnerB }, now))
      const facts = { requestId: 'r', ip: null, userAgent: null }
      const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers: { cookie: `${storeCookieName}=${cookie}`, [storeHeader]: store } }), t.partnerB, now, activityLog, facts)
      const result = await graphql({ schema: storeSchema as GraphQLSchema, source: `mutation { changeRole(membershipId: "${membershipId}", role: "staff") }`, contextValue: { standing, partnerId: t.partnerB, sql: db.sql, activity: activityLog, facts, now: () => now } satisfies StoreContext })
      return result.errors?.[0]?.extensions['code'] as string | undefined
    }
    const idOf = (userId: string) => memberships.find((m) => m.user_id === userId)?.id ?? ''
    // Each demotes the other: without the lock both would see one other Owner and both would pass.
    const answers = await Promise.all([asOwner(a, idOf(b)), asOwner(b, idOf(a))])
    expect(answers.filter((c) => c === undefined)).toHaveLength(1)
    expect(answers.filter((c) => c === 'LAST_OWNER' || c === 'FORBIDDEN')).toHaveLength(1)
    const [owners] = await db.sql<{ n: number }[]>`select count(*)::int as n from membership where store_id = ${store} and role_key = 'owner' and status = 'active'`
    expect(owners?.n).toBe(1)
  })
})

describe('roles and removal', () => {
  it('changes a role, keeps the last Owner, and records both', async () => {
    const manager = (await list('staff')).find((n) => n.email === 'manager@a.example')
    const owner = (await list('staff')).find((n) => n.email === 'owner@a.example')
    expect((await gql(`mutation { changeRole(membershipId: "${owner?.id}", role: "manager") }`, 'owner')).code).toBe('LAST_OWNER')
    expect((await gql(`mutation { removeMember(membershipId: "${owner?.id}") }`, 'owner')).code).toBe('LAST_OWNER')
    expect((await gql(`mutation { changeRole(membershipId: "${manager?.id}", role: "owner") }`, 'owner')).data?.['changeRole']).toBe(true)
    expect((await gql(`mutation { changeRole(membershipId: "${manager?.id}", role: "staff") }`, 'owner')).data?.['changeRole']).toBe(true)
    const [entry] = await db.sql<{ visibility: string; store_id: string }[]>`select visibility, store_id from activity_log where action = 'member.role_changed' order by occurred_at desc limit 1`
    expect(entry).toEqual({ visibility: 'store', store_id: t.storeA1 })
  })

  it('removes someone from this store only: they lose it on the next request, their account stays', async () => {
    const staff = (await list('staff')).find((n) => n.email === 'staff@a.example')
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.staff}, ${t.storeA2}, 'staff', 'active')`
    expect((await gql(`mutation { removeMember(membershipId: "${staff?.id}") }`, 'owner')).data?.['removeMember']).toBe(true)
    expect((await gql('{ storeState { status } }', 'staff')).code).toBe('FORBIDDEN')
    expect((await gql('{ me { name } }', 'staff', t.storeA2)).data?.['me']).toEqual({ name: 'Sam Staff' })
    expect((await list('staff')).some((n) => n.email === 'staff@a.example')).toBe(false)
    const [removed] = await db.sql<{ target_id: string; visibility: string }[]>`select target_id, visibility from activity_log where action = 'member.removed' order by occurred_at desc limit 1`
    expect(removed).toEqual({ target_id: staff?.id, visibility: 'store' })
  })

  it('never changes or removes another store’s member', async () => {
    const [theirs] = await db.sql<{ id: string }[]>`select id from membership where user_id = ${people.bOwner}`
    expect((await gql(`mutation { changeRole(membershipId: "${theirs?.id}", role: "staff") }`, 'owner')).code).toBe('NOT_FOUND')
    expect((await gql(`mutation { removeMember(membershipId: "${theirs?.id}") }`, 'owner')).code).toBe('NOT_FOUND')
    const [still] = await db.sql<{ role_key: string; status: string }[]>`select role_key, status from membership where id = ${theirs?.id ?? ''}`
    expect(still).toEqual({ role_key: 'owner', status: 'active' })
  })
})
