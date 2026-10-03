import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { insertOutboxMany } from '#db/scoped/outbox'
import { backoffMs, defaultRelayOptions, relayDue, type Deliverers, type Effect, type RelayOptions } from '#jobs/queues/outbox-relay'
import { queueSideEffect } from '#saas/outbox/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

let db: TestDatabase
let t: Tenants

const staff: CallerContext = { caller: { kind: 'staff', staffId: 'st' } }
const partner = (partnerId: string): CallerContext => ({ caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId })

// A row is due from the database's own now, so the clock catches up to it before each relay
// and otherwise only moves when a test moves it.
let clock = Date.now()
const now = () => new Date(clock)
// Read from the database itself: its clock can run a millisecond ahead of this process's.
const catchUp = async (sql: typeof db.sql) => {
  const [r] = await sql<{ ms: string }[]>`select ceil(extract(epoch from clock_timestamp()) * 1000)::text as ms`
  clock = Math.max(clock, Number(r?.ms ?? 0))
}
const options: RelayOptions = { ...defaultRelayOptions, now, timeoutMs: 100, maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 60_000, leaseMs: 5_000, batch: 10 }

const sweep: typeof relayDue = async (...args) => {
  await catchUp(args[0])
  return relayDue(...args)
}

// One row at a time: every other kind is kept out of the sweep by giving it no deliverer.
const relay = async (sql: typeof db.sql, kind: string, all: Deliverers = deliverers, opts = options) => {
  const only: Deliverers = { [kind]: all[kind] ?? { deliver: async () => {} } }
  const counts = await sweep(sql, only, opts)
  const outcome = (Object.keys(counts) as (keyof typeof counts)[]).find((k) => counts[k] > 0)
  return outcome ?? 'skipped'
}

const delivered: Effect[] = []
const deliverers: Deliverers = {
  email: { deliver: async (effect) => void delivered.push(effect) },
  flaky: {
    deliver: async () => {
      throw new Error('provider said no, and named someone@example.com while doing so')
    },
  },
  // Ignores the signal and never settles: the relay must not wait for it.
  hanging: { deliver: () => new Promise<void>(() => {}) },
}

const row = async (id: string) => {
  const [r] = await db.sql<{ attempts: number; next_attempt_at: Date; delivered_at: Date | null; failed_at: Date | null; last_error: string | null; claimed_at: Date | null }[]>`
    select attempts, next_attempt_at, delivered_at, failed_at, last_error, claimed_at from outbox where id = ${id}
  `
  if (!r) throw new Error('row missing')
  return r
}

const queued = (context: CallerContext, kind: string, key: string, scope: { partnerId?: string; storeId?: string } = {}) =>
  withScope(db.sql, context, (tx) =>
    queueSideEffect(tx, { kind, idempotencyKey: key, payload: { to: 'someone' }, partnerId: scope.partnerId ?? null, storeId: scope.storeId ?? null }),
  )

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('a side effect follows its transaction', () => {
  it('a rolled-back transaction queues nothing, so nothing is delivered', async () => {
    await expect(
      withScope(db.sql, staff, async (tx) => {
        await queueSideEffect(tx, { kind: 'email', idempotencyKey: 'rolled-back', payload: {}, partnerId: null, storeId: null })
        throw new Error('later step failed')
      }),
    ).rejects.toThrow('later step failed')
    const counts = await sweep(db.sql, deliverers, options)
    expect(counts.delivered).toBe(0)
    expect(delivered.map((e) => e.idempotencyKey)).not.toContain('rolled-back')
  })

  it('a committed one is delivered once, with its idempotency key, and a replay delivers nothing', async () => {
    const id = await queued(staff, 'email', 'welcome-1')
    if (!id) throw new Error('not queued')
    expect(await relay(db.sql, 'email')).toBe('delivered')
    expect(await relay(db.sql, 'email')).toBe('skipped')
    const swept = await sweep(db.sql, deliverers, options)
    expect(swept.delivered).toBe(0)
    expect(delivered.filter((e) => e.idempotencyKey.endsWith(':welcome-1'))).toHaveLength(1)
    expect((await row(id)).delivered_at).not.toBeNull()
  })

  it('the same idempotency key is queued once per kind and per scope', async () => {
    expect(await queued(staff, 'email', 'twice')).not.toBeNull()
    expect(await queued(staff, 'email', 'twice')).toBeNull()
    // Another kind, and another store, are other effects (DATA-MODEL.md §2).
    expect(await queued(staff, 'webhook', 'twice')).not.toBeNull()
    expect(await queued(partner(t.partnerA), 'email', 'twice', { partnerId: t.partnerA, storeId: t.storeA1 })).not.toBeNull()
    expect(await queued(partner(t.partnerA), 'email', 'twice', { partnerId: t.partnerA, storeId: t.storeA2 })).not.toBeNull()
    const [r] = await db.sql<{ n: string }[]>`select count(*)::text as n from outbox where idempotency_key like '%:twice'`
    expect(Number(r?.n)).toBe(4)
  })
})

describe('many at once', () => {
  it('queues a batch in one statement and, with a key already queued, skips just that row', async () => {
    const row = (key: string) => ({ kind: 'email', idempotencyKey: key, payload: { key }, partnerId: t.partnerA, storeId: t.storeA1 })
    await withScope(db.sql, partner(t.partnerA), (tx) => insertOutboxMany(tx, [row('many-1'), row('many-2')]))
    await withScope(db.sql, partner(t.partnerA), (tx) => insertOutboxMany(tx, [row('many-2'), row('many-3')]))
    const keys = await db.sql<{ k: string }[]>`select payload->>'key' as k from outbox where payload->>'key' like 'many-%' order by 1`
    expect(keys.map((r) => r.k)).toEqual(['many-1', 'many-2', 'many-3'])
  })
})

describe('failures (AGENTS.md "Reliability")', () => {
  it('a hanging delivery is cut off at the timeout and retried with backoff', async () => {
    const id = await queued(staff, 'hanging', 'hang-1')
    if (!id) throw new Error('not queued')
    const started = Date.now()
    expect(await relay(db.sql, 'hanging')).toBe('retry')
    expect(Date.now() - started).toBeLessThan(options.timeoutMs * 10)
    const first = await row(id)
    expect(first).toMatchObject({ attempts: 1, last_error: 'timeout', delivered_at: null, failed_at: null, claimed_at: null })
    expect(first.next_attempt_at.getTime()).toBe(clock + 1_000)

    // Not due yet: the sweep leaves it alone.
    expect((await sweep(db.sql, { hanging: deliverers['hanging'] ?? { deliver: async () => {} } }, options)).retry).toBe(0)

    clock += 1_000
    expect(await relay(db.sql, 'hanging')).toBe('retry')
    expect((await row(id)).next_attempt_at.getTime()).toBe(clock + 2_000)
  })

  it('stops at the attempt limit and records a code, never the provider words', async () => {
    const id = await queued(staff, 'flaky', 'flaky-1')
    if (!id) throw new Error('not queued')
    const outcomes: string[] = []
    for (let i = 0; i < 3; i += 1) {
      outcomes.push(await relay(db.sql, 'flaky'))
      clock += 60_000
    }
    expect(outcomes).toEqual(['retry', 'retry', 'dead'])
    const r = await row(id)
    expect(r).toMatchObject({ attempts: 3, last_error: 'failed' })
    expect(r.failed_at).not.toBeNull()
    expect(JSON.stringify(r)).not.toContain('someone@example.com')
    expect(await relay(db.sql, 'flaky')).toBe('skipped')
  })

  it('a row with no deliverer is left untouched, attempts included', async () => {
    const id = await queued(staff, 'carrier-pigeon', 'pigeon-1')
    if (!id) throw new Error('not queued')
    await sweep(db.sql, deliverers, options)
    expect(await sweep(db.sql, {}, options)).toEqual({ delivered: 0, retry: 0, dead: 0, skipped: 0 })
    expect(await row(id)).toMatchObject({ attempts: 0, claimed_at: null, last_error: null, failed_at: null })
  })

  it('a claimed row is not claimed again until its lease runs out', async () => {
    const id = await queued(staff, 'email', 'leased-1')
    if (!id) throw new Error('not queued')
    await withSystemScope(db.sql, (tx) => tx`update outbox set claimed_at = ${now()} where id = ${id}`)
    expect(await relay(db.sql, 'email')).toBe('skipped')
    clock += options.leaseMs + 1
    expect(await relay(db.sql, 'email')).toBe('delivered')
  })

  it('backs off exponentially to a cap', () => {
    expect([1, 2, 3, 4, 10].map((attempt) => backoffMs(attempt, 1_000, 10_000))).toEqual([1_000, 2_000, 4_000, 8_000, 10_000])
  })
})

describe('who may touch the outbox', () => {
  it('a partner queues under its own partner only', async () => {
    expect(await queued(partner(t.partnerA), 'email', 'partner-own', { partnerId: t.partnerA })).not.toBeNull()
    await expect(queued(partner(t.partnerA), 'email', 'partner-forged', { partnerId: t.partnerB })).rejects.toThrow(/row-level security/i)
  })

  it('a request may add to it and nothing more', async () => {
    await expect(withScope(db.sql, staff, (tx) => tx`select id from outbox`)).rejects.toThrow(/permission denied/i)
    await expect(withScope(db.sql, staff, (tx) => tx`update outbox set delivered_at = now()`)).rejects.toThrow(/permission denied/i)
    await expect(withScope(db.sql, staff, (tx) => tx`delete from outbox`)).rejects.toThrow(/permission denied/i)
  })

  it('the relay may not delete either', async () => {
    await expect(withSystemScope(db.sql, (tx) => tx`delete from outbox`)).rejects.toThrow(/permission denied/i)
  })
})
