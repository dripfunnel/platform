import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import { withScope } from '#db/scoped/index'
import { partnerRoleHas, partnerRoles, type PartnerRole } from '#auth/partnerPermissions'
import { activityLog } from '#saas/activity/index'
import { createPartnerStoreActions } from '#saas/partnerStores/actions'
import { createPartnerStoresService, storeActionPermission } from '#saas/partnerStores/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #160: the store actions on the Platform API over the seeded partners.

let db: TestDatabase
const now = new Date('2026-10-03T09:00:00Z')
const ids = { ns: '', bz: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }

const callerOf = (partnerId: string, role: PartnerRole): PartnerCaller => ({
  user: { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example', role },
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})
const owner = () => callerOf(ids.ns, 'partner-owner')

type Result = { ok: boolean; reason: string | null; trialEndsAt?: string | null; overrideId?: string | null; proration?: { kind: string; amount: number | null; currency: string } | null }

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const deps = { sql: db.sql, caller, facts, activity: activityLog, now: () => now }
  const contextValue = { caller, console: null, plans: null, branding: null, stores: createPartnerStoresService(deps), storeActions: createPartnerStoreActions(deps) }
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const result = 'ok reason trialEndsAt overrideId proration { kind amount currency }'
const mutations = {
  changePlan: `mutation($id: ID!, $planId: ID!, $when: String!, $reason: String!) { r: changeStorePlan(id: $id, planId: $planId, when: $when, reason: $reason) { ${result} } }`,
  extendTrial: `mutation($id: ID!, $days: Int!, $reason: String!) { r: extendTrial(id: $id, days: $days, reason: $reason) { ${result} } }`,
  addOverride: `mutation($id: ID!, $limit: String!, $amount: Int!, $duration: String!, $reason: String!) { r: addLimitOverride(id: $id, limit: $limit, amount: $amount, duration: $duration, reason: $reason) { ${result} } }`,
  removeOverride: `mutation($id: ID!, $overrideId: ID!, $reason: String!) { r: removeLimitOverride(id: $id, overrideId: $overrideId, reason: $reason) { ${result} } }`,
  suspend: `mutation($id: ID!, $reason: String!) { r: suspendStore(id: $id, reason: $reason) { ${result} } }`,
  restore: `mutation($id: ID!, $reason: String!) { r: restoreStore(id: $id, reason: $reason) { ${result} } }`,
  resendInvite: `mutation($id: ID!) { r: resendStoreOwnerInvite(id: $id) { ${result} } }`,
  retryStep: `mutation($id: ID!) { r: retryProvisioningStep(id: $id) { ${result} } }`,
}
const act = async (name: keyof typeof mutations, caller: PartnerCaller, variables: Record<string, unknown>) => {
  const { data, code } = await run<{ r: Result }>(mutations[name], caller, variables)
  return code ?? data?.r
}

const optionsQuery = `query($id: ID!) { changePlanOptions(storeId: $id) { ok reason nextBillingAt plans { id name amount currency proration { kind amount currency } } } }`
type Options = { changePlanOptions: { ok: boolean; reason: string | null; nextBillingAt: string | null; plans: { id: string; amount: number; currency: string; proration: { kind: string; amount: number | null } }[] } }
const blockQuery = `query($id: ID!) { store(id: $id) { actions {
  changePlan { allowed reason } extendTrial { allowed reason } addOverride { allowed reason } resendInvite { allowed reason }
  restore { allowed reason } suspend { allowed reason } retryStep { allowed reason } } } }`
type Block = Record<string, { allowed: boolean; reason: string | null } | null>

const entries = async (storeId: string, action: string) => (await db.sql`select 1 from activity_log where store_id = ${storeId} and action = ${action}`).length
const storeWith = async (where: string, partnerId = ids.ns) =>
  (await db.sql.unsafe<{ id: string }[]>(`select s.id from store s where s.partner_id = $1 and ${where} order by s.name limit 1`, [partnerId]))[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  ids.ns = (await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`)[0]?.id ?? ''
  ids.bz = (await db.sql<{ id: string }[]>`select id from partner where name = 'Bazaar Cloud'`)[0]?.id ?? ''
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('change plan', () => {
  it('quotes the proration from the API for a known mid-cycle date and moves the subscription to a version now', async () => {
    const store = await storeWith(`s.status = 'active' and exists (select 1 from store_subscription x where x.store_id = s.id and x.interval = 'month')`)
    const options = (await run<Options>(optionsQuery, owner(), { id: store })).data?.changePlanOptions
    const target = options?.plans[0]
    expect(target).toBeDefined()
    // A $50.00 move up on 3 Oct 09:00 with 28 d 15 h of October's 31 days left.
    await db.sql`update store_subscription set amount = ${(target?.amount ?? 0) - 5000}, period_start = '2026-10-01T00:00:00Z', period_end = '2026-11-01T00:00:00Z' where store_id = ${store}`
    const quoted = (await run<Options>(optionsQuery, owner(), { id: store })).data?.changePlanOptions
    expect(quoted?.plans.find((p) => p.id === target?.id)?.proration).toMatchObject({ kind: 'charge', amount: 4617 })
    expect(quoted?.nextBillingAt).toBe('2026-11-01T00:00:00.000Z')

    const [before] = await db.sql<{ version: number }[]>`select version from plan where id = ${target?.id ?? ''}`
    expect(await act('changePlan', owner(), { id: store, planId: target?.id, when: 'now', reason: 'Needs more products' })).toMatchObject({
      ok: true,
      proration: { kind: 'charge', amount: 4617, currency: target?.currency },
    })
    expect(await db.sql`select plan_id, plan_version, amount, proration_amount from store_subscription where store_id = ${store}`).toEqual([
      { plan_id: target?.id, plan_version: before?.version, amount: target?.amount, proration_amount: 4617 },
    ])
    expect(await db.sql`select plan_id from store where id = ${store}`).toEqual([{ plan_id: target?.id }])
    expect(await entries(store, 'store.plan_changed')).toBe(1)
    expect((await db.sql`select 1 from outbox where store_id = ${store} and payload->>'template' = 'store-plan-changed'`).length).toBe(1)

    // Retiring the plan afterwards leaves the store on the version it moved to.
    await db.sql`update plan set status = 'retired' where id = ${target?.id ?? ''}`
    expect(await db.sql`select plan_version from store_subscription where store_id = ${store}`).toEqual([{ plan_version: before?.version }])
  })

  it('schedules a move from the next billing date and refuses a plan that is not Live or is the current one', async () => {
    const store = await storeWith(`s.status = 'active' and exists (select 1 from store_subscription x where x.store_id = s.id) and s.id not in (select store_id from activity_log where action = 'store.plan_changed' and store_id is not null)`)
    const [sub] = await db.sql<{ plan_id: string; period_end: Date }[]>`select plan_id, period_end from store_subscription where store_id = ${store}`
    const target = (await run<Options>(optionsQuery, owner(), { id: store })).data?.changePlanOptions.plans[0]
    expect(await act('changePlan', owner(), { id: store, planId: target?.id, when: 'next', reason: 'From renewal' })).toMatchObject({ ok: true })
    expect(await db.sql`select next_plan_id, change_at from store_subscription where store_id = ${store}`).toEqual([{ next_plan_id: target?.id, change_at: sub?.period_end }])
    expect(await db.sql`select plan_id from store where id = ${store}`).toEqual([{ plan_id: sub?.plan_id }])
    const [retired] = await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.ns} and status <> 'live' limit 1`
    expect(await act('changePlan', owner(), { id: store, planId: retired?.id, when: 'now', reason: 'x' })).toMatchObject({ ok: false, reason: 'PLAN_NOT_LIVE' })
    expect(await act('changePlan', owner(), { id: store, planId: sub?.plan_id, when: 'now', reason: 'x' })).toMatchObject({ ok: false, reason: 'SAME_PLAN' })
    expect(await act('changePlan', owner(), { id: store, planId: target?.id, when: 'later', reason: 'x' })).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
    // Before billing subscribes a store there is no billing date to move on.
    await db.sql`delete from store_subscription where store_id = ${store}`
    expect(await act('changePlan', owner(), { id: store, planId: target?.id, when: 'next', reason: 'x' })).toMatchObject({ ok: false, reason: 'NO_BILLING_DATE' })
    expect(await db.sql`select plan_id from store where id = ${store}`).toEqual([{ plan_id: sub?.plan_id }])
  })
})

describe('trial and overrides', () => {
  it('extends a trial by 3, 7 or 14 days, Finance included, and only on trial', async () => {
    const store = await storeWith(`s.status = 'trial' and s.trial_ends_at > '2026-10-03T09:00:00Z' and exists (select 1 from store_subscription x where x.store_id = s.id and x.status = 'trial')`)
    const [before] = await db.sql<{ trial_ends_at: Date }[]>`select trial_ends_at from store where id = ${store}`
    // A plan change "from the next billing date" chosen during the trial moves with its end.
    await db.sql`update store_subscription set trial_ends_at = ${before?.trial_ends_at ?? now}, next_plan_id = plan_id, next_plan_version = plan_version, change_at = ${before?.trial_ends_at ?? now} where store_id = ${store}`
    const logged = await entries(store, 'store.trial_extended')
    const extended = await act('extendTrial', callerOf(ids.ns, 'partner-finance'), { id: store, days: 7, reason: 'Waiting on their catalogue' })
    const expected = new Date((before?.trial_ends_at.getTime() ?? 0) + 7 * 24 * 60 * 60 * 1000)
    expect(extended).toMatchObject({ ok: true, trialEndsAt: expected.toISOString() })
    expect(await db.sql`select trial_ends_at from store where id = ${store}`).toEqual([{ trial_ends_at: expected }])
    expect(await db.sql`select trial_ends_at, change_at from store_subscription where store_id = ${store}`).toEqual([{ trial_ends_at: expected, change_at: expected }])
    expect(await db.sql`select days, reason from store_trial_extension where store_id = ${store} and ends_at = ${expected}`).toEqual([{ days: 7, reason: 'Waiting on their catalogue' }])
    expect(await entries(store, 'store.trial_extended')).toBe(logged + 1)
    expect(await act('extendTrial', owner(), { id: store, days: 5, reason: 'x' })).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
    expect(await act('extendTrial', owner(), { id: await storeWith(`s.status = 'active'`), days: 7, reason: 'x' })).toMatchObject({ ok: false, reason: 'NOT_ON_TRIAL' })
  })

  it('adds an override for this month or until removed, and removes it once', async () => {
    const store = await storeWith(`s.status = 'active'`)
    const added = await act('addOverride', owner(), { id: store, limit: 'publish_now', amount: 10, duration: 'month', reason: 'Launch week' })
    expect(added).toMatchObject({ ok: true })
    const overrideId = (added as Result).overrideId
    expect(await db.sql`select key, amount, month::text from store_limit_override where id = ${overrideId ?? ''}`).toEqual([{ key: 'publish_now', amount: 10, month: '2026-10-01' }])
    expect(await act('removeOverride', owner(), { id: store, overrideId, reason: 'Launch done' })).toMatchObject({ ok: true })
    expect(await act('removeOverride', owner(), { id: store, overrideId, reason: 'Again' })).toMatchObject({ ok: false, reason: 'NOT_FOUND' })
    expect(await entries(store, 'store.limit_override_added')).toBe(1)
    expect(await entries(store, 'store.limit_override_removed')).toBe(1)
    expect(await act('addOverride', owner(), { id: store, limit: 'products', amount: 0, duration: 'always', reason: 'x' })).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
  })
})

describe('suspend and restore', () => {
  it('needs a plain reason the merchant sees, queues the email, and restores the status it had', async () => {
    const store = await storeWith(`s.status = 'past_due'`)
    expect(await act('suspend', owner(), { id: store, reason: '   ' })).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
    expect(await act('suspend', owner(), { id: store, reason: '<b>Pay up</b>' })).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
    expect(await act('suspend', owner(), { id: store, reason: 'Three invoices unpaid' })).toMatchObject({ ok: true })
    expect(await db.sql`select status, suspended_reason from store where id = ${store}`).toEqual([{ status: 'suspended', suspended_reason: 'Three invoices unpaid' }])
    expect(await db.sql`select payload->>'reason' as reason from outbox where store_id = ${store} and payload->>'template' = 'store-suspended'`).toEqual([{ reason: 'Three invoices unpaid' }])
    expect(await act('suspend', owner(), { id: store, reason: 'Again' })).toMatchObject({ ok: false, reason: 'ALREADY_SUSPENDED' })
    expect(await act('restore', owner(), { id: store, reason: 'Paid in full' })).toMatchObject({ ok: true })
    expect(await db.sql`select status, suspended_reason from store where id = ${store}`).toEqual([{ status: 'past_due', suspended_reason: null }])
    expect((await db.sql`select 1 from outbox where store_id = ${store} and payload->>'template' = 'store-restored'`).length).toBe(1)
    expect(await act('restore', owner(), { id: store, reason: 'Again' })).toMatchObject({ ok: false, reason: 'NOT_SUSPENDED' })
    expect([await entries(store, 'store.suspended'), await entries(store, 'store.restored')]).toEqual([1, 1])
  })
})

describe('invitation and setup', () => {
  it('resends the owner invitation once, the old link revoked, and refuses when none is pending', async () => {
    const store = await storeWith(`s.status = 'active'`)
    await db.sql`insert into invitation (store_id, email, role_key, expires_at, invited_by_label) values (${store}, 'owner@shop.example', 'owner', '2026-10-05T00:00:00Z', 'Seed')`
    expect(await act('resendInvite', owner(), { id: store })).toMatchObject({ ok: true })
    const rows = await db.sql<{ revoked: boolean }[]>`select revoked_at is not null as revoked from invitation where store_id = ${store} and role_key = 'owner' and seller_id is null order by created_at`
    expect(rows.map((r) => r.revoked)).toEqual([true, false])
    await db.sql`update invitation set accepted_at = ${now} where store_id = ${store} and revoked_at is null`
    expect(await act('resendInvite', owner(), { id: store })).toMatchObject({ ok: false, reason: 'NO_PENDING_INVITATION' })
    expect(await entries(store, 'store.invitation_resent')).toBe(1)
  })

  it('restarts only a failed step, once on a double call', async () => {
    const store = await storeWith(`exists (select 1 from job j where j.store_id = s.id)`)
    const [job] = await db.sql<{ id: string; step: string; attempts: number }[]>`
      update job set state = 'failed', last_error = 'The build failed.' where id = (select id from job where store_id = ${store} order by started_at desc limit 1)
      returning id, step, attempts`
    expect(await act('retryStep', owner(), { id: store })).toMatchObject({ ok: true })
    expect(await act('retryStep', owner(), { id: store })).toMatchObject({ ok: false, reason: 'NOT_STUCK' })
    expect(await db.sql`select state, step, attempts, last_error from job where id = ${job?.id ?? ''}`).toEqual([{ state: 'running', step: job?.step, attempts: (job?.attempts ?? 0) + 1, last_error: null }])
    expect((await db.sql`select 1 from outbox where kind = 'provisioning.retry' and store_id = ${store}`).length).toBe(1)
    expect(await entries(store, 'store.setup_step_retried')).toBe(1)
  })
})

describe('the block and the mutations agree', () => {
  // Every role on a store in each state, every action: allowed in the block passes the mutation's
  // gate, refused is FORBIDDEN by the same permission, absent is refused with the state's code.
  const input: Record<string, Record<string, unknown>> = {
    changePlan: { planId: crypto.randomUUID(), when: 'now', reason: 'x' },
    extendTrial: { days: 3, reason: 'x' },
    addOverride: { limit: 'products', amount: 1, duration: 'always', reason: 'x' },
    suspend: { reason: 'x' },
    restore: { reason: 'x' },
    resendInvite: {},
    retryStep: {},
  }
  const absentCode = (action: string, status: string) =>
    ({ extendTrial: 'NOT_ON_TRIAL', restore: 'NOT_SUSPENDED', retryStep: 'NOT_STUCK', suspend: status === 'suspended' ? 'ALREADY_SUSPENDED' : 'CANCELLED' })[action] ?? 'CANCELLED'
  // Past the gate, an unknown plan and a store with no open invitation are the only refusals.
  const pastTheGate = ['PLAN_NOT_LIVE', 'NO_PENDING_INVITATION']

  it('answers every action as store(id) does, for every role and state', async () => {
    const failing = await storeWith(`s.status = 'active' and exists (select 1 from job j where j.store_id = s.id) and s.name > 'M'`)
    await db.sql`update job set state = 'failed' where id = (select id from job where store_id = ${failing} order by started_at desc limit 1)`
    const stores: [string, string][] = [['failed', failing]]
    for (const status of ['trial', 'active', 'suspended', 'cancelled']) stores.push([status, await storeWith(`s.status = '${status}' and not exists (select 1 from job j where j.store_id = s.id and j.state <> 'done')`)])
    for (const [status, store] of stores) {
      const [snapshot] = await db.sql`select status, trial_ends_at, suspended_at, suspended_reason, suspended_by_label, suspended_previous_status from store where id = ${store}`
      const jobs = await db.sql`select id, state, step_started_at, attempts, last_error, finished_at from job where store_id = ${store}`
      for (const role of partnerRoles) {
        const block = (await run<{ store: { actions: Block } }>(blockQuery, callerOf(ids.ns, role), { id: store })).data?.store?.actions ?? {}
        for (const action of ['changePlan', 'extendTrial', 'addOverride', 'suspend', 'restore', 'resendInvite', 'retryStep'] as const) {
          const verdict = block[action]
          const answer = await act(action, callerOf(ids.ns, role), { id: store, ...input[action] })
          const label = `${status} ${role} ${action}`
          if (verdict?.allowed) {
            expect(typeof answer, label).toBe('object')
            const r = answer as Result
            expect(r.ok || pastTheGate.includes(r.reason ?? ''), `${label}: ${r.reason}`).toBe(true)
            await db.sql`update store set ${db.sql(snapshot as Record<string, unknown>)} where id = ${store}`
            for (const job of jobs) await db.sql`update job set ${db.sql(job as Record<string, unknown>, 'state', 'step_started_at', 'attempts', 'last_error', 'finished_at')} where id = ${job['id'] as string}`
          } else if (verdict || !partnerRoleHas(role, storeActionPermission[action])) {
            expect(answer, label).toBe('FORBIDDEN')
          } else {
            expect(answer, label).toMatchObject({ ok: false, reason: absentCode(action, status === 'failed' ? 'active' : status) })
          }
        }
      }
    }
  })

  it('lets a partner add or revoke only an owner invitation on its own store, at the database', async () => {
    const scope = { caller: { kind: 'partner-user' as const, partnerUserId: 'pu' }, partnerId: ids.ns }
    const mine = await storeWith(`s.status = 'active'`)
    const theirs = await storeWith(`s.status = 'active'`, ids.bz)
    const [seller] = await db.sql<{ id: string }[]>`select se.id from seller se join store s on s.id = se.store_id where s.partner_id = ${ids.ns} limit 1`
    const invite = (storeId: string, role: string) =>
      withScope(db.sql, scope, (tx) => tx`
        insert into invitation (store_id, email, role_key, expires_at, invited_by_label)
        values (${storeId}, 'x@shop.example', ${role}, ${now}, 'Northstar Commerce') returning id`)
    expect(await invite(mine, 'owner')).toHaveLength(1)
    await expect(invite(mine, 'manager')).rejects.toThrow(/row-level security/)
    await expect(invite(theirs, 'owner')).rejects.toThrow(/row-level security/)
    // A supplier's invitation names its seller, a column the partner role is not granted (0018).
    await expect(
      withScope(db.sql, scope, (tx) => tx`insert into invitation (store_id, seller_id, email, role_key, expires_at, invited_by_label) values (${mine}, ${seller?.id ?? null}, 's@shop.example', 'owner', ${now}, 'x')`),
    ).rejects.toThrow(/permission denied/)
    const [theirInvite] = await db.sql<{ id: string }[]>`
      insert into invitation (store_id, email, role_key, expires_at, invited_by_label) values (${theirs}, 'o@bz.example', 'owner', ${now}, 'Seed') returning id`
    const [staffInvite] = await db.sql<{ id: string }[]>`
      insert into invitation (store_id, email, role_key, expires_at, invited_by_label) values (${mine}, 'm@shop.example', 'manager', ${now}, 'Seed') returning id`
    for (const id of [theirInvite?.id ?? '', staffInvite?.id ?? '']) {
      expect(await withScope(db.sql, scope, (tx) => tx`update invitation set revoked_at = ${now} where id = ${id} returning id`)).toEqual([])
    }
    await expect(withScope(db.sql, scope, (tx) => tx`update invitation set email = 'y@shop.example' where store_id = ${mine}`)).rejects.toThrow(/permission denied/)
  })

  it('lets a partner restart only its store’s latest failed or running job, at the database', async () => {
    const scope = { caller: { kind: 'partner-user' as const, partnerUserId: 'pu' }, partnerId: ids.ns }
    const [done] = await db.sql<{ id: string }[]>`select j.id from job j join store s on s.id = j.store_id where s.partner_id = ${ids.ns} and j.state = 'done' limit 1`
    const [theirs] = await db.sql<{ id: string }[]>`update job set state = 'failed' where id = (select j.id from job j join store s on s.id = j.store_id where s.partner_id = ${ids.bz} limit 1) returning id`
    for (const id of [done?.id ?? '', theirs?.id ?? '']) {
      expect(await withScope(db.sql, scope, (tx) => tx`update job set state = 'running' where id = ${id} returning id`)).toEqual([])
    }
  })
})

describe('isolation', () => {
  it('never acts on another partner’s store', async () => {
    const theirs = await storeWith(`s.status = 'trial'`, ids.bz)
    const [override] = await db.sql<{ id: string }[]>`select o.id from store_limit_override o join store s on s.id = o.store_id where s.partner_id = ${ids.bz} limit 1`
    for (const [action, variables] of Object.entries({
      changePlan: { planId: crypto.randomUUID(), when: 'now', reason: 'x' },
      extendTrial: { days: 3, reason: 'x' },
      addOverride: { limit: 'products', amount: 1, duration: 'always', reason: 'x' },
      removeOverride: { overrideId: override?.id ?? crypto.randomUUID(), reason: 'x' },
      suspend: { reason: 'x' },
      restore: { reason: 'x' },
      resendInvite: {},
      retryStep: {},
    })) {
      expect(await act(action as keyof typeof mutations, owner(), { id: theirs, ...variables }), action).toMatchObject({ ok: false, reason: 'NOT_FOUND' })
    }
    expect((await run<Options>(optionsQuery, owner(), { id: theirs })).data?.changePlanOptions).toMatchObject({ ok: false, reason: 'NOT_FOUND' })
    expect((await db.sql`select 1 from activity_log where store_id = ${theirs} and actor_kind = 'partner_user'`).length).toBe(0)
  })

  it('moves a subscription only through 0018’s function, to the partner’s own Live plan', async () => {
    const scope = { caller: { kind: 'partner-user' as const, partnerUserId: 'pu' }, partnerId: ids.ns }
    const mine = await storeWith(`exists (select 1 from store_subscription x where x.store_id = s.id)`)
    const theirs = await storeWith(`exists (select 1 from store_subscription x where x.store_id = s.id)`, ids.bz)
    const [live] = await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.ns} and status = 'live' limit 1`
    const [notLive] = await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.ns} and status <> 'live' limit 1`
    const [bazaars] = await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.bz} and status = 'live' limit 1`
    const move = (store: string, plan: string) => withScope(db.sql, scope, (tx) => tx`select partner_move_subscription(${store}, ${plan}, 0, ${now})`)
    await expect(move(theirs, live?.id ?? '')).rejects.toThrow(/no such store or Live plan/)
    await expect(move(mine, notLive?.id ?? '')).rejects.toThrow(/no such store or Live plan/)
    await expect(move(mine, bazaars?.id ?? '')).rejects.toThrow(/no such store or Live plan/)
    const [sub] = await db.sql<{ amount: number }[]>`select amount from store_subscription where store_id = ${mine}`
    const [price] = await db.sql<{ monthly: number }[]>`
      select pp.monthly_amount as monthly from plan_price pp join plan p on p.id = pp.plan_id and pp.version = p.version
      join store_subscription x on x.currency = pp.currency where p.id = ${live?.id ?? ''} and x.store_id = ${mine}`
    const outside = ((price?.monthly ?? 0) - (sub?.amount ?? 0)) * 2 + 1
    await expect(withScope(db.sql, scope, (tx) => tx`select partner_move_subscription(${mine}, ${live?.id ?? ''}, ${outside}, ${now})`)).rejects.toThrow(/proration outside/)
    await expect(withScope(db.sql, scope, (tx) => tx`update store_subscription set plan_id = ${live?.id ?? ''} where store_id = ${mine}`)).rejects.toThrow(/permission denied/i)
  })
})
