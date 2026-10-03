import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { secretBox } from '#auth/secretBox'
import { hashSessionId } from '#auth/session'
import { codeAt, newTotpSecret, stepAt } from '#auth/totp'
import { withScope, withSystemScope } from '#db/scoped/index'
import { insertSupportSession, spendSupportHandoff } from '#db/scoped/supportSessions'
import { activityLog } from '#saas/activity/index'
import { createPartnerConsoleService } from '#saas/partnerConsole/index'
import { createPartnerSupportService } from '#saas/support/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #202: partner support sessions on the Platform API (ACCESS.md §8, FIRST-RELEASE §12).

let db: TestDatabase
let secrets: Awaited<ReturnType<typeof secretBox>>
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
const totp = newTotpSecret()
const start = new Date('2026-10-03T09:00:00Z')
let clock = start
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }
const ids = { ns: '', bz: '', priya: '', sam: '', ana: '', reader: '', bzAgent: '', portal: '' }

const agent = async (partnerId: string, email: string, role: PartnerRole) =>
  (
    await db.sql<{ id: string }[]>`
      insert into partner_user (partner_id, email, name, role_key, status, two_factor_secret_enc, two_factor_enrolled_at)
      values (${partnerId}, ${email}, ${email.split('@')[0] ?? 'x'}, ${role}, 'active', ${await secrets.seal(totp)}, ${start}) returning id
    `
  )[0]?.id ?? ''

const callerOf = (partnerId: string, userId: string, role: PartnerRole): PartnerCaller => ({
  user: { id: userId, name: userId === ids.priya ? 'Priya' : userId === ids.sam ? 'Sam' : 'Ana', email: 'agent@northstar.example', role },
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const deps = { sql: db.sql, caller, facts, activity: activityLog, now: () => clock }
  const contextValue = { caller, console: createPartnerConsoleService(deps), support: createPartnerSupportService({ ...deps, secrets }) }
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const q = {
  targets: `query($s: String) { supportTargets(search: $s, first: 25) { items { membershipId name email type store { id name } role supplier status start { allowed reason } storeOwner colleague { name minutesLeft } mySessionId } } }`,
  reauth: `mutation($c: String!) { reauthenticate(code: $c) { ok reason proof triesLeft lockedMinutes } }`,
  start: `mutation($m: ID!, $r: String!, $t: String, $p: String!) { startSupportSession(membershipId: $m, reason: $r, ticket: $t, proof: $p) { ok reason sessionId expiresAt link } }`,
  back: `mutation($id: ID!) { returnToSupportSession(id: $id) { ok reason link } }`,
  end: `mutation($id: ID!) { endSupportSession(id: $id) { ok reason } }`,
  sessions: `query($open: Boolean!) { supportSessions(open: $open, first: 25) { items { id you agent { name } user { name } endedBy endedByName end { allowed reason } return { allowed reason } } } }`,
  mine: `{ mySupportSession { id expiresAt } }`,
}
type Target = { membershipId: string; name: string; email: string; type: string; store: { id: string; name: string }; status: string; start: { allowed: boolean; reason: string | null }; storeOwner: string | null; colleague: { name: string; minutesLeft: number } | null; mySessionId: string | null }
type Started = { startSupportSession: { ok: boolean; reason: string | null; sessionId: string | null; expiresAt: string | null; link: string | null } }

const targets = async (caller: PartnerCaller, search?: string) => (await run<{ supportTargets: { items: Target[] } }>(q.targets, caller, { s: search ?? null })).data?.supportTargets.items ?? []

/** A fresh 2-factor code on a fresh time step, so no code is a replay of the last. */
const proofOf = async (caller: PartnerCaller): Promise<string> => {
  clock = new Date(clock.getTime() + 31_000)
  const r = (await run<{ reauthenticate: { ok: boolean; proof: string } }>(q.reauth, caller, { c: await codeAt(totp, stepAt(clock)) })).data?.reauthenticate
  if (!r?.ok) throw new Error('reauthentication failed')
  return r.proof
}

const openOn = async (caller: PartnerCaller, membershipId: string, reason = 'Order stuck at payment') =>
  (await run<Started>(q.start, caller, { m: membershipId, r: reason, t: 'ZD-4411', p: await proofOf(caller) })).data?.startSupportSession

const membershipOf = async (email: string) => (await db.sql<{ id: string }[]>`select m.id from membership m join "user" u on u.id = m.user_id where u.email = ${email}`)[0]?.id ?? ''
const tokenOf = (link: string | null | undefined) => new URL(link ?? 'https://x/').searchParams.get('token') ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, start)
  secrets = await secretBox(key)
  ids.ns = (await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`)[0]?.id ?? ''
  ids.bz = (await db.sql<{ id: string }[]>`select id from partner where name = 'Bazaar Cloud'`)[0]?.id ?? ''
  ids.portal = (await db.sql<{ host: string }[]>`select host from partner_domain where partner_id = ${ids.ns} and kind = 'portal' and status = 'live'`)[0]?.host ?? ''
  ids.priya = await agent(ids.ns, 'priya.support@northstar.example', 'partner-support')
  ids.sam = await agent(ids.ns, 'sam.support@northstar.example', 'partner-support')
  ids.ana = await agent(ids.ns, 'ana.admin@northstar.example', 'partner-admin')
  ids.reader = await agent(ids.ns, 'rita.reader@northstar.example', 'partner-read-only')
  ids.bzAgent = await agent(ids.bz, 'bo.support@bazaar.example', 'partner-support')
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('targets', () => {
  it('lists its merchants’ store and supplier users, never its own team, another partner’s people or a shopper', async () => {
    const priya = callerOf(ids.ns, ids.priya, 'partner-support')
    expect(ids.portal).not.toBe('')
    const items = await targets(priya)
    expect(items.length).toBeGreaterThan(0)
    const nsStores = new Set((await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns}`).map((s) => s.id))
    expect(items.every((t) => nsStores.has(t.store.id))).toBe(true)
    const team = new Set((await db.sql<{ email: string }[]>`select lower(email) as email from partner_user`).map((r) => r.email))
    const shoppers = new Set((await db.sql<{ email: string }[]>`select lower(email) as email from customer`).map((r) => r.email))
    expect(items.some((t) => team.has(t.email.toLowerCase()) || shoppers.has(t.email.toLowerCase()))).toBe(false)
    expect(new Set(items.map((t) => t.type)).has('store')).toBe(true)
    expect((await targets(priya, 'jenna')).map((t) => t.email)).toContain('jenna@harborcoffee.example')
    expect(await targets(callerOf(ids.bz, ids.bzAgent, 'partner-support'), 'jenna@harborcoffee')).toEqual([])
  })

  it('says why a session can’t start: support off (naming the Owner), not accepted, suspended, cancelled', async () => {
    const priya = callerOf(ids.ns, ids.priya, 'partner-support')
    const [store] = await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns} and name = 'Harbor Coffee Co.'`
    await db.sql`update store set support_access_allowed = false where id = ${store?.id ?? ''}`
    const off = (await targets(priya, 'tom@harborcoffee')).at(0)
    expect(off?.start).toEqual({ allowed: false, reason: 'SUPPORT_OFF' })
    expect(off?.storeOwner).toBe('Jenna Park')
    expect((await run<Started>(q.start, priya, { m: off?.membershipId, r: 'Help', p: await proofOf(priya) })).data?.startSupportSession.reason).toBe('SUPPORT_OFF')
    await db.sql`update store set support_access_allowed = true where id = ${store?.id ?? ''}`

    const tom = await membershipOf('tom@harborcoffee.example')
    await db.sql`update membership set status = 'invited' where id = ${tom}`
    expect((await targets(priya, 'tom@harborcoffee')).at(0)?.start.reason).toBe('NOT_ACCEPTED')
    await db.sql`update membership set status = 'suspended' where id = ${tom}`
    expect((await targets(priya, 'tom@harborcoffee')).at(0)?.start.reason).toBe('SUSPENDED')
    await db.sql`update membership set status = 'active' where id = ${tom}`
    await db.sql`update store set status = 'cancelled' where id = ${store?.id ?? ''}`
    expect((await targets(priya, 'tom@harborcoffee')).at(0)?.start.reason).toBe('STORE_CANCELLED')
    await db.sql`update store set status = 'trial' where id = ${store?.id ?? ''}`
    expect((await targets(priya, 'tom@harborcoffee')).at(0)?.start).toEqual({ allowed: true, reason: null })
  })
})

describe('re-authentication', () => {
  it('buys one proof with a 2-factor code; a wrong code counts toward the lock and a proof opens one session only', async () => {
    const sam = callerOf(ids.ns, ids.sam, 'partner-support')
    clock = new Date(clock.getTime() + 31_000)
    const wrong = (await run<{ reauthenticate: { ok: boolean; reason: string; triesLeft: number } }>(q.reauth, sam, { c: '000000' })).data?.reauthenticate
    expect(wrong).toMatchObject({ ok: false, reason: 'WRONG_CODE', triesLeft: 4 })
    const target = await membershipOf('tom@harborcoffee.example')
    expect((await run<Started>(q.start, sam, { m: target, r: 'Help', p: 'not-a-proof' })).data?.startSupportSession.reason).toBe('REAUTH_REQUIRED')
    const proof = await proofOf(sam)
    const opened = (await run<Started>(q.start, sam, { m: target, r: 'Help', p: proof })).data?.startSupportSession
    expect(opened?.ok).toBe(true)
    await run(q.end, sam, { id: opened?.sessionId })
    expect((await run<Started>(q.start, sam, { m: target, r: 'Again', p: proof })).data?.startSupportSession.reason).toBe('REAUTH_REQUIRED')
    const [row] = await db.sql<{ action: string }[]>`select action from activity_log where action = 'partner_user.reauthenticated' and actor_id = ${ids.sam}`
    expect(row).toBeDefined()
    expect(JSON.stringify(await db.sql`select * from activity_log where actor_id = ${ids.sam}`)).not.toContain(proof)
  })
})

describe('sessions', () => {
  it('opens one session at a time for 30 minutes on the portal host, logged in the partner’s and the store’s log', async () => {
    const priya = callerOf(ids.ns, ids.priya, 'partner-support')
    const jenna = await membershipOf('jenna@harborcoffee.example')
    const opened = await openOn(priya, jenna)
    expect(opened?.ok).toBe(true)
    expect(new Date(opened?.expiresAt ?? '').getTime() - clock.getTime()).toBe(30 * 60_000)
    expect(new URL(opened?.link ?? '').host).toBe(ids.portal)
    const second = (await run<Started>(q.start, priya, { m: await membershipOf('tom@harborcoffee.example'), r: 'Another', p: await proofOf(priya) })).data?.startSupportSession
    expect(second).toMatchObject({ ok: false, reason: 'SUPPORT_SESSION_ALREADY_OPEN', sessionId: opened?.sessionId })
    const [logged] = await db.sql<{ store_id: string; access_kind: string; visibility: string; category: string }[]>`
      select store_id, access_kind, visibility, category from activity_log where action = 'support_session.started' and access_ref = ${opened?.sessionId ?? ''}`
    expect(logged).toMatchObject({ access_kind: 'support_session', visibility: 'partner', category: 'support' })
    const asStore = { caller: { kind: 'person' as const, userId: crypto.randomUUID(), sessionId: 's' }, partnerId: ids.ns, storeId: logged?.store_id ?? '', sellerScope: { kind: 'all' as const }, subscription: 'trial' as const }
    const storeSees = await withScope(db.sql, asStore, (tx) =>
      tx`select 1 from activity_log where access_ref = ${opened?.sessionId ?? ''}`,
    )
    expect(storeSees.length).toBe(1)
    const badges = (await run<{ navBadges: { supportOpenSessions: number } }>(`{ navBadges { supportOpenSessions } }`, priya)).data?.navBadges
    expect(badges?.supportOpenSessions).toBe(1)

    // A colleague sees who is in, and for how long, and can't start on the same user.
    const sam = callerOf(ids.ns, ids.sam, 'partner-support')
    const row = (await targets(sam, 'jenna@harborcoffee')).at(0)
    expect(row?.start.reason).toBe('COLLEAGUE_IN_SESSION')
    expect(row?.colleague).toEqual({ name: 'priya.support', minutesLeft: 30 })
    expect((await openOn(sam, jenna))?.reason).toBe('COLLEAGUE_IN_SESSION')
    expect((await targets(priya, 'jenna@harborcoffee')).at(0)?.mySessionId).toBe(opened?.sessionId)

    // No extension: past 30 minutes it is history, and a new session needs a new reason and code.
    clock = new Date(new Date(opened?.expiresAt ?? '').getTime() + 1000)
    expect((await run<{ mySupportSession: unknown }>(q.mine, priya)).data?.mySupportSession).toBeNull()
    expect((await run<{ returnToSupportSession: { reason: string } }>(q.back, priya, { id: opened?.sessionId })).data?.returnToSupportSession.reason).toBe('SESSION_EXPIRED')
    expect((await openOn(priya, jenna, 'Follow-up'))?.ok).toBe(true)
    // The new start closed the old row; History still says it ran out.
    const history = (await run<{ supportSessions: { items: { id: string; endedBy: string; return: { reason: string } }[] } }>(q.sessions, priya, { open: false })).data?.supportSessions.items ?? []
    expect(history.find((s) => s.id === opened?.sessionId)).toMatchObject({ endedBy: 'expired', return: { reason: 'SESSION_EXPIRED' } })
  })

  it('spends a handoff once, before it expires; returning mints a fresh one and the old stops working', async () => {
    const ana = callerOf(ids.ns, ids.ana, 'partner-admin')
    const opened = await openOn(ana, await membershipOf('tom@harborcoffee.example'))
    expect(opened?.ok).toBe(true)
    const first = tokenOf(opened?.link)
    const spend = async (token: string, at = clock) => withSystemScope(db.sql, async (tx) => spendSupportHandoff(tx, await hashSessionId(token), at))
    expect((await spend(first))?.id).toBe(opened?.sessionId)
    expect(await spend(first)).toBeNull()
    const again = (await run<{ returnToSupportSession: { ok: boolean; link: string } }>(q.back, ana, { id: opened?.sessionId })).data?.returnToSupportSession
    const second = tokenOf(again?.link)
    const third = tokenOf((await run<{ returnToSupportSession: { link: string } }>(q.back, ana, { id: opened?.sessionId })).data?.returnToSupportSession.link)
    expect(await spend(second)).toBeNull()
    expect(await spend(third, new Date(clock.getTime() + 6 * 60_000))).toBeNull()
    expect((await spend(third))?.id).toBe(opened?.sessionId)
    const stored = await db.sql`select handoff_hash from support_session where id = ${opened?.sessionId ?? ''}`
    expect(stored[0]?.['handoff_hash']).toBeNull()
    await run(q.end, ana, { id: opened?.sessionId })
  })

  it('refuses a return, and the exchange refuses a link already sent, once support is off, the store cancelled or the user suspended', async () => {
    const ana = callerOf(ids.ns, ids.ana, 'partner-admin')
    const membership = await membershipOf('tom@harborcoffee.example')
    const opened = await openOn(ana, membership, 'Revoked later')
    expect(opened?.ok).toBe(true)
    const [row] = await db.sql<{ store_id: string; status: string; handoff_hash: string }[]>`
      select ss.store_id, s.status, ss.handoff_hash from support_session ss join store s on s.id = ss.store_id where ss.id = ${opened?.sessionId ?? ''}`
    const back = async () => (await run<{ returnToSupportSession: { ok: boolean; reason: string | null } }>(q.back, ana, { id: opened?.sessionId })).data?.returnToSupportSession
    const spend = async (token: string) => withSystemScope(db.sql, async (tx) => spendSupportHandoff(tx, await hashSessionId(token), clock))
    const revocations = [
      { refusal: 'SUPPORT_OFF', revoke: db.sql`update store set support_access_allowed = false where id = ${row?.store_id ?? ''}`, undo: db.sql`update store set support_access_allowed = true where id = ${row?.store_id ?? ''}` },
      { refusal: 'STORE_CANCELLED', revoke: db.sql`update store set status = 'cancelled' where id = ${row?.store_id ?? ''}`, undo: db.sql`update store set status = ${row?.status ?? ''} where id = ${row?.store_id ?? ''}` },
      { refusal: 'SUSPENDED', revoke: db.sql`update membership set status = 'suspended' where id = ${membership}`, undo: db.sql`update membership set status = 'active' where id = ${membership}` },
    ]
    for (const { refusal, revoke, undo } of revocations) {
      await revoke
      expect(await back()).toMatchObject({ ok: false, reason: refusal })
      expect((await db.sql<{ handoff_hash: string }[]>`select handoff_hash from support_session where id = ${opened?.sessionId ?? ''}`)[0]?.handoff_hash).toBe(row?.handoff_hash)
      expect(await spend(tokenOf(opened?.link))).toBeNull()
      await undo
    }
    expect((await spend(tokenOf(opened?.link)))?.id).toBe(opened?.sessionId)
    await run(q.end, ana, { id: opened?.sessionId })
  })

  it('lets the agent or an Owner or Admin end a session, never a colleague in Support; and no Read-only user reaches Support', async () => {
    const priya = callerOf(ids.ns, ids.priya, 'partner-support')
    const sam = callerOf(ids.ns, ids.sam, 'partner-support')
    const ana = callerOf(ids.ns, ids.ana, 'partner-admin')
    const mine = (await run<{ mySupportSession: { id: string } }>(q.mine, priya)).data?.mySupportSession
    expect(mine).toBeTruthy()
    const open = (await run<{ supportSessions: { items: { id: string; end: { allowed: boolean; reason: string } }[] } }>(q.sessions, sam, { open: true })).data?.supportSessions.items ?? []
    expect(open.find((s) => s.id === mine?.id)?.end).toEqual({ allowed: false, reason: 'NOT_SESSION_OWNER' })
    expect((await run<{ endSupportSession: { reason: string } }>(q.end, sam, { id: mine?.id })).data?.endSupportSession.reason).toBe('NOT_SESSION_OWNER')
    expect((await run<{ endSupportSession: { ok: boolean } }>(q.end, ana, { id: mine?.id })).data?.endSupportSession.ok).toBe(true)
    const ended = (await run<{ supportSessions: { items: { id: string; endedBy: string; endedByName: string }[] } }>(q.sessions, priya, { open: false })).data?.supportSessions.items ?? []
    expect(ended.find((s) => s.id === mine?.id)).toMatchObject({ endedBy: 'colleague', endedByName: 'ana.admin' })
    expect((await run<{ endSupportSession: { reason: string } }>(q.end, priya, { id: mine?.id })).data?.endSupportSession.reason).toBe('SESSION_ENDED')

    const reader = callerOf(ids.ns, ids.reader, 'partner-read-only')
    for (const source of [q.targets, q.mine]) expect((await run(source, reader)).code).toBe('FORBIDDEN')
    expect((await run(q.reauth, reader, { c: '123456' })).code).toBe('FORBIDDEN')
  })
})

describe('isolation', () => {
  it('never lets one partner see, start, return to or end another’s sessions, at the API and in the database', async () => {
    const priya = callerOf(ids.ns, ids.priya, 'partner-support')
    const opened = await openOn(priya, await membershipOf('jenna@harborcoffee.example'), 'Isolation')
    expect(opened?.ok).toBe(true)
    const bo = callerOf(ids.bz, ids.bzAgent, 'partner-support')
    expect((await openOn(bo, await membershipOf('tom@harborcoffee.example')))?.reason).toBe('NOT_FOUND')
    expect((await run<{ returnToSupportSession: { reason: string } }>(q.back, bo, { id: opened?.sessionId })).data?.returnToSupportSession.reason).toBe('NOT_FOUND')
    expect((await run<{ endSupportSession: { reason: string } }>(q.end, bo, { id: opened?.sessionId })).data?.endSupportSession.reason).toBe('NOT_FOUND')
    for (const open of [true, false]) {
      const seen = (await run<{ supportSessions: { items: { id: string }[] } }>(q.sessions, bo, { open })).data?.supportSessions.items ?? []
      expect(seen.some((s) => s.id === opened?.sessionId)).toBe(false)
    }
    // The database refuses it too: a session for someone else, or on another partner's user.
    const [bzStore] = await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.bz} limit 1`
    const [bzMember] = await db.sql<{ id: string }[]>`select id from membership where store_id = ${bzStore?.id ?? ''} limit 1`
    const asPriya = { caller: { kind: 'partner-user' as const, partnerUserId: ids.priya }, partnerId: ids.ns }
    const insert = (partnerUserId: string, storeId: string, membershipId: string) =>
      withScope(db.sql, asPriya, (tx) => tx`
        insert into support_session (partner_id, store_id, membership_id, partner_user_id, reason, started_at, expires_at)
        values (${ids.ns}, ${storeId}, ${membershipId}, ${partnerUserId}, 'x', ${clock}, ${new Date(clock.getTime() + 60_000)})`)
    const [ns] = await db.sql<{ store_id: string; id: string }[]>`select m.store_id, m.id from membership m join "user" u on u.id = m.user_id where u.email = 'tom@harborcoffee.example'`
    await expect(insert(ids.sam, ns?.store_id ?? '', ns?.id ?? '')).rejects.toThrow(/row-level security/)
    await expect(insert(ids.priya, bzStore?.id ?? '', bzMember?.id ?? '')).rejects.toThrow(/row-level security/)
    await expect(withScope(db.sql, asPriya, (tx) => tx`select handoff_hash from support_session`)).rejects.toThrow(/permission denied/)
  })

  it('keeps the proof when a start loses the race for a user to a colleague', async () => {
    const sam = callerOf(ids.ns, ids.sam, 'partner-support')
    const jenna = await membershipOf('jenna@harborcoffee.example')
    const [taken] = await db.sql<{ store_id: string }[]>`select store_id from support_session where membership_id = ${jenna} and ended_at is null`
    expect(taken).toBeDefined()
    const proof = await proofOf(sam)
    const asSam = { caller: { kind: 'partner-user' as const, partnerUserId: ids.sam }, partnerId: ids.ns }
    const session = { partnerId: ids.ns, storeId: taken?.store_id ?? '', membershipId: jenna, partnerUserId: ids.sam, reason: 'Race', ticket: null, startedAt: clock, expiresAt: new Date(clock.getTime() + 60_000), handoffHash: 'h', handoffExpiresAt: clock }
    expect(await withScope(db.sql, asSam, async (tx) => insertSupportSession(tx, await hashSessionId(proof), session))).toEqual({ ok: false, refused: 'target' })
    expect((await run<Started>(q.start, sam, { m: await membershipOf('tom@harborcoffee.example'), r: 'Still mine', p: proof })).data?.startSupportSession.ok).toBe(true)
  })
})
