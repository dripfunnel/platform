import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ActivityEntry } from '#auth/activity'
import { encodeCursor } from '#core/cursor'
import type { CallerContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog, activityPageSize, listActivity } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// LOGGING.md §10: transactional, structural and isolation. The connection is a superuser, so
// every read that matters goes through `withScope` to be subject to RLS.

let db: TestDatabase
let t: Tenants

const staff: CallerContext = { caller: { kind: 'staff', staffId: 'st' } }
const partner = (partnerId: string): CallerContext => ({ caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId })
const merchant = (partnerId: string, storeId: string): CallerContext => ({
  caller: { kind: 'person', userId: 'u', sessionId: 's' },
  partnerId,
  storeId,
  sellerScope: { kind: 'all' },
  subscription: 'active',
})
const supplier = (partnerId: string, storeId: string, sellerId: string): CallerContext => ({
  ...merchant(partnerId, storeId),
  sellerScope: { kind: 'seller', sellerId },
})
const shopper = (partnerId: string, storeId: string, customerId: string | null): CallerContext => ({
  caller: { kind: 'shopper', customerId },
  partnerId,
  storeId,
  sellerScope: { kind: 'all' },
  subscription: 'active',
})

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  category: 'write',
  action: 'thing.changed',
  result: 'success',
  actorKind: 'person',
  actorId: 'u',
  actorLabel: 'Someone <s@example.com>',
  reason: null,
  requestId: 'req',
  ip: null,
  userAgent: null,
  visibility: 'store',
  ...over,
})

const record = (context: CallerContext, e: ActivityEntry) => withScope(db.sql, context, (tx) => activityLog.record(tx, e))

const actionsSeen = async (context: CallerContext): Promise<string[]> => {
  const result = await listActivity(db.sql, context, {}, {})
  if (!result.ok) throw new Error(result.code)
  return result.page.items.map((row) => row.action).sort()
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('an entry commits with the change it records', () => {
  const countPartners = async () => Number((await db.sql<{ n: string }[]>`select count(*)::text as n from partner`)[0]?.n)
  const countEntries = async (action: string) =>
    Number((await db.sql<{ n: string }[]>`select count(*)::text as n from activity_log where action = ${action}`)[0]?.n)

  it('a rolled-back change leaves no entry', async () => {
    const before = await countPartners()
    await expect(
      withScope(db.sql, staff, async (tx) => {
        await tx`insert into partner default values`
        await activityLog.record(tx, entry({ action: 'partner.created.rolled_back', actorKind: 'staff', visibility: 'staff' }))
        throw new Error('something after the write failed')
      }),
    ).rejects.toThrow('something after the write failed')
    expect(await countPartners()).toBe(before)
    expect(await countEntries('partner.created.rolled_back')).toBe(0)
  })

  it('a committed change has exactly one', async () => {
    const before = await countPartners()
    await withScope(db.sql, staff, async (tx) => {
      await tx`insert into partner default values`
      await activityLog.record(tx, entry({ action: 'partner.created.committed', actorKind: 'staff', visibility: 'staff' }))
    })
    expect(await countPartners()).toBe(before + 1)
    expect(await countEntries('partner.created.committed')).toBe(1)
  })

  it('a failed entry rolls the change back', async () => {
    const before = await countPartners()
    await expect(
      withScope(db.sql, staff, async (tx) => {
        await tx`insert into partner default values`
        // A partner caller may not file an entry against another partner, so the insert fails.
        await activityLog.record(tx, entry({ action: 'x', visibility: 'partner', partnerId: t.partnerA, result: 'nonsense' as never }))
      }),
    ).rejects.toThrow()
    expect(await countPartners()).toBe(before)
  })
})

describe('append-only', () => {
  it('no request or job role may update or delete an entry', async () => {
    for (const run of [
      (work: Parameters<typeof withScope>[2]) => withScope(db.sql, staff, work),
      (work: Parameters<typeof withSystemScope>[1]) => withSystemScope(db.sql, work),
    ]) {
      await expect(run((tx) => tx`update activity_log set reason = 'edited'`)).rejects.toThrow(/permission denied/i)
      await expect(run((tx) => tx`delete from activity_log`)).rejects.toThrow(/permission denied/i)
    }
  })

  it('reaches no partition except through the parent', async () => {
    await expect(withScope(db.sql, staff, (tx) => tx`select id from activity_log_default`)).rejects.toThrow(/permission denied/i)
  })
})

describe('redaction (LOGGING.md §4.1)', () => {
  it('records a credential field as changed with no values, and keeps ordinary fields', async () => {
    const secret = 'hunter2-the-password'
    const token = 'tok_live_4eC39HqLyjWDarjtT1zdp7dc'
    await record(
      staff,
      entry({
        action: 'person.updated',
        actorKind: 'staff',
        visibility: 'staff',
        target: { type: 'person', id: 'p1', label: 'Priya' },
        changes: [
          { field: 'name', before: 'Priya', after: 'Priya S' },
          { field: 'password', before: null, after: secret },
          { field: 'stripeSecretKey', before: token, after: 'rotated' },
          { field: 'postcode', before: '560001', after: '560002' },
        ],
      }),
    )
    const [row] = await db.sql<{ changes: unknown; all: string }[]>`
      select changes, row_to_json(activity_log)::text as all from activity_log where action = 'person.updated'
    `
    expect(row?.changes).toEqual([
      { field: 'name', before: 'Priya', after: 'Priya S', redacted: false },
      { field: 'password', before: null, after: null, redacted: true },
      { field: 'stripeSecretKey', before: null, after: null, redacted: true },
      { field: 'postcode', before: '560001', after: '560002', redacted: false },
    ])
    expect(row?.all).not.toContain(secret)
    expect(row?.all).not.toContain(token)
  })
})

describe('who sees what (LOGGING.md §6)', () => {
  beforeAll(async () => {
    await withSystemScope(db.sql, async (tx) => {
      await activityLog.record(tx, entry({ action: 'security.only_staff', category: 'security', actorKind: 'anonymous', actorId: null, visibility: 'staff' }))
      await activityLog.record(tx, entry({ action: 'partner_a.account', actorKind: 'partner_user', partnerId: t.partnerA, visibility: 'partner' }))
      await activityLog.record(tx, entry({ action: 'partner_b.account', actorKind: 'partner_user', partnerId: t.partnerB, visibility: 'partner' }))
      await activityLog.record(tx, entry({ action: 'store_a1.merchant', partnerId: t.partnerA, storeId: t.storeA1, visibility: 'store' }))
      await activityLog.record(tx, entry({ action: 'store_a1.supplier_first', partnerId: t.partnerA, storeId: t.storeA1, sellerId: t.sellerA1First, visibility: 'store' }))
      await activityLog.record(tx, entry({ action: 'store_a1.supplier_second', partnerId: t.partnerA, storeId: t.storeA1, sellerId: t.sellerA1Second, visibility: 'store' }))
      await activityLog.record(tx, entry({ action: 'store_a1.shopper', actorKind: 'customer', partnerId: t.partnerA, storeId: t.storeA1, customerId: t.customerA1, visibility: 'self' }))
      await activityLog.record(tx, entry({ action: 'store_a1.about_shopper', partnerId: t.partnerA, storeId: t.storeA1, customerId: t.customerA1, visibility: 'store', reason: 'chargeback' }))
      await activityLog.record(tx, entry({ action: 'store_a1.account', actorKind: 'partner_user', partnerId: t.partnerA, storeId: t.storeA1, visibility: 'partner' }))
      await activityLog.record(tx, entry({ action: 'store_a2.merchant', partnerId: t.partnerA, storeId: t.storeA2, visibility: 'store' }))
      await activityLog.record(tx, entry({ action: 'store_b1.merchant', partnerId: t.partnerB, storeId: t.storeB1, visibility: 'store' }))
    })
  })

  it('staff see everything, security entries included', async () => {
    const seen = await actionsSeen(staff)
    for (const action of ['security.only_staff', 'partner_a.account', 'partner_b.account', 'store_a1.merchant', 'store_a1.shopper', 'store_b1.merchant']) {
      expect(seen).toContain(action)
    }
  })

  it('a partner sees its account entries and never inside a store, a shopper or another partner', async () => {
    expect(await actionsSeen(partner(t.partnerA))).toEqual(['partner_a.account', 'store_a1.account'])
    expect(await actionsSeen(partner(t.partnerB))).toEqual(['partner_b.account'])
  })

  it('a merchant sees its store, shoppers and account-level events included, and no other store', async () => {
    expect(await actionsSeen(merchant(t.partnerA, t.storeA1))).toEqual(
      ['store_a1.about_shopper', 'store_a1.account', 'store_a1.merchant', 'store_a1.shopper', 'store_a1.supplier_first', 'store_a1.supplier_second'].sort(),
    )
    expect(await actionsSeen(merchant(t.partnerA, t.storeA2))).toEqual(['store_a2.merchant'])
  })

  it('a supplier sees only what was done under its own seller', async () => {
    expect(await actionsSeen(supplier(t.partnerA, t.storeA1, t.sellerA1First))).toEqual(['store_a1.supplier_first'])
  })

  it('a shopper sees only their own entries, never what the store recorded about them, and nothing when signed out', async () => {
    expect(await actionsSeen(shopper(t.partnerA, t.storeA1, t.customerA1))).toEqual(['store_a1.shopper'])
    expect(await actionsSeen(shopper(t.partnerA, t.storeA1, null))).toEqual([])
  })

  it('a filter narrows within the scope and never widens it', async () => {
    const result = await listActivity(db.sql, partner(t.partnerA), { storeId: t.storeB1 }, {})
    expect(result.ok && result.page.items).toEqual([])
    const other = await listActivity(db.sql, partner(t.partnerA), { partnerId: t.partnerB }, {})
    expect(other.ok && other.page.items).toEqual([])
  })

  it('a caller files an entry only in its own scope', async () => {
    await expect(record(partner(t.partnerA), entry({ action: 'forged', partnerId: t.partnerB, visibility: 'partner' }))).rejects.toThrow(/row-level security/i)
    // A partner may name its own store, never another partner's, and never a seller or a shopper.
    await expect(record(partner(t.partnerA), entry({ action: 'partner_a.on_own_store', partnerId: t.partnerA, storeId: t.storeA1, visibility: 'partner' }))).resolves.toBeUndefined()
    await expect(record(partner(t.partnerA), entry({ action: 'forged', partnerId: t.partnerA, storeId: t.storeB1 }))).rejects.toThrow(/row-level security/i)
    await expect(record(partner(t.partnerA), entry({ action: 'forged', partnerId: t.partnerA, storeId: t.storeA1, sellerId: t.sellerA1First }))).rejects.toThrow(/row-level security/i)
    await expect(record(partner(t.partnerA), entry({ action: 'forged', partnerId: t.partnerA, storeId: t.storeA1, customerId: t.customerA1 }))).rejects.toThrow(/row-level security/i)
    await expect(record(merchant(t.partnerA, t.storeA1), entry({ action: 'forged', partnerId: t.partnerA, storeId: t.storeA2 }))).rejects.toThrow(/row-level security/i)
    await expect(
      record(supplier(t.partnerA, t.storeA1, t.sellerA1First), entry({ action: 'forged', partnerId: t.partnerA, storeId: t.storeA1, sellerId: t.sellerA1Second })),
    ).rejects.toThrow(/row-level security/i)
  })
})

describe('the address and user agent (LOGGING.md §4)', () => {
  it('are kept on auth and security entries only, and shown to staff only', async () => {
    const facts = { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (test)' }
    await withSystemScope(db.sql, async (tx) => {
      await activityLog.record(tx, entry({ action: 'facts.auth', category: 'auth', partnerId: t.partnerA, visibility: 'partner', ...facts }))
      await activityLog.record(tx, entry({ action: 'facts.write', category: 'write', partnerId: t.partnerA, visibility: 'partner', ...facts }))
    })
    const stored = await db.sql<{ action: string; ip: string | null; user_agent: string | null }[]>`
      select action, ip, user_agent from activity_log where action like 'facts.%' order by action
    `
    expect(stored).toEqual([
      { action: 'facts.auth', ip: facts.ip, user_agent: facts.userAgent },
      { action: 'facts.write', ip: null, user_agent: null },
    ])

    const asStaff = await listActivity(db.sql, staff, { action: 'facts.auth' }, {})
    expect(asStaff.ok && asStaff.page.items[0]).toMatchObject({ ip: facts.ip, user_agent: facts.userAgent })
    const asPartner = await listActivity(db.sql, partner(t.partnerA), { action: 'facts.auth' }, {})
    expect(asPartner.ok && asPartner.page.items).toHaveLength(1)
    expect(asPartner.ok && asPartner.page.items[0]).toMatchObject({ ip: null, user_agent: null })
  })
})

describe('the Admin API query (LOGGING.md §7)', () => {
  const total = 130
  const base = Date.UTC(2026, 9, 1)

  beforeAll(async () => {
    await withSystemScope(db.sql, async (tx) => {
      for (let i = 0; i < total; i += 1) {
        await activityLog.record(
          tx,
          entry({
            occurredAt: new Date(base + i * 60_000),
            action: i % 10 === 0 ? 'paged.special' : 'paged.plain',
            actorKind: 'staff',
            actorId: `actor-${i % 7}`,
            target: { type: 'store', id: `store-${i % 13}`, label: 'S' },
            visibility: 'staff',
          }),
        )
      }
    })
  })

  const paged = (filter: Record<string, unknown>, page: { after?: string | null; before?: string | null; first?: number } = {}) =>
    listActivity(db.sql, staff, { action: 'paged.plain', ...filter }, page).then((r) => {
      if (!r.ok) throw new Error(r.code)
      return r.page
    })

  it('is capped at the page size however much is asked for, newest first', async () => {
    const page = await paged({}, { first: 10_000 })
    expect(page.items).toHaveLength(activityPageSize)
    expect(page.pageInfo.hasNextPage).toBe(true)
    expect(page.pageInfo.hasPreviousPage).toBe(false)
    const times = page.items.map((row) => row.occurred_at.getTime())
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('pages correctly when rows share a millisecond, and when the clock is the database\'s', async () => {
    // Two rows the cursor could not tell apart by time alone, plus rows stamped by now(),
    // whose precision must match the cursor's (migrations/0006).
    const same = new Date(base + 5 * 60 * 60 * 1000)
    await withSystemScope(db.sql, async (tx) => {
      for (let i = 0; i < 3; i += 1) await activityLog.record(tx, entry({ occurredAt: same, action: 'same.ms', actorKind: 'staff', visibility: 'staff' }))
      for (let i = 0; i < 3; i += 1) await activityLog.record(tx, entry({ action: 'same.ms', actorKind: 'staff', visibility: 'staff' }))
    })
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const result = await listActivity(db.sql, staff, { action: 'same.ms' }, { first: 1, after: cursor })
      if (!result.ok) throw new Error(result.code)
      seen.push(...result.page.items.map((row) => row.id))
      cursor = result.page.pageInfo.hasNextPage ? result.page.pageInfo.endCursor : null
    } while (cursor)
    expect(seen).toHaveLength(6)
    expect(new Set(seen).size).toBe(6)
  })

  it('walks forward and back by cursor without a gap or a repeat', async () => {
    const first = await paged({}, { first: 40 })
    const second = await paged({}, { first: 40, after: first.pageInfo.endCursor })
    const third = await paged({}, { first: 40, after: second.pageInfo.endCursor })
    const ids = [...first.items, ...second.items, ...third.items].map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(117)
    expect(third.pageInfo.hasNextPage).toBe(false)
    expect(second.pageInfo.hasPreviousPage).toBe(true)

    const back = await paged({}, { first: 40, before: third.pageInfo.startCursor })
    expect(back.items.map((row) => row.id)).toEqual(second.items.map((row) => row.id))
    expect(back.pageInfo.hasPreviousPage).toBe(true)
    expect(back.pageInfo.hasNextPage).toBe(true)
  })

  it('filters by actor, target and date', async () => {
    const byActor = await listActivity(db.sql, staff, { actorKind: 'staff', actorId: 'actor-3' }, {})
    expect(byActor.ok && byActor.page.items.every((row) => row.actor_id === 'actor-3')).toBe(true)
    expect(byActor.ok && byActor.page.items.length).toBe(19)

    const byTarget = await listActivity(db.sql, staff, { targetType: 'store', targetId: 'store-4' }, {})
    expect(byTarget.ok && byTarget.page.items.length).toBe(10)

    const byDay = await listActivity(db.sql, staff, { from: '2026-10-01', to: '2026-10-01', actorId: 'actor-3' }, {})
    expect(byDay.ok && byDay.page.items.length).toBe(19)
    const none = await listActivity(db.sql, staff, { from: '2026-09-01', to: '2026-09-30' }, {})
    expect(none.ok && none.page.items).toEqual([])
  })

  it('refuses a malformed filter or cursor with a code, not a database error', async () => {
    expect(await listActivity(db.sql, staff, { partnerId: 'not-a-uuid' }, {})).toEqual({ ok: false, code: 'INVALID_FILTER' })
    expect(await listActivity(db.sql, staff, { from: '2026-02-01', to: '2026-01-01' }, {})).toEqual({ ok: false, code: 'INVALID_FILTER' })
    expect(await listActivity(db.sql, staff, { from: '2026-13-45' }, {})).toEqual({ ok: false, code: 'INVALID_FILTER' })
    expect(await listActivity(db.sql, staff, { surprise: 1 }, {})).toEqual({ ok: false, code: 'INVALID_FILTER' })
    expect(await listActivity(db.sql, staff, {}, { after: 'not a cursor' })).toEqual({ ok: false, code: 'INVALID_CURSOR' })
    expect(await listActivity(db.sql, staff, {}, { after: encodeCursor({ occurredAt: new Date(), id: 'x' }) })).toEqual({ ok: false, code: 'INVALID_CURSOR' })
  })

  it('reads one page with one query, through its index', async () => {
    // Several thousand rows, so the planner has a reason to pick the index over a scan.
    await db.sql`
      insert into activity_log (occurred_at, category, action, result, actor_kind, actor_id, visibility)
      select ${new Date(base)}::timestamptz + (g || ' seconds')::interval, 'write', 'bulk.row', 'success', 'staff', 'actor-' || (g % 50), 'staff'
      from generate_series(1, 40000) g
    `
    await db.sql`analyze activity_log`
    const plan = await withScope(db.sql, staff, async (tx) => {
      const cutoff = new Date(base + 10_000_000)
      const rows = await tx<{ 'QUERY PLAN': string }[]>`
        explain select * from activity_log
        where actor_kind = 'staff' and actor_id = 'actor-3'
          and occurred_at <= ${cutoff} and (occurred_at, id) < (${cutoff}, '00000000-0000-0000-0000-000000000000'::uuid)
        order by occurred_at desc, id desc limit 51
      `
      return rows.map((row) => row['QUERY PLAN']).join('\n')
    })
    // The month's partition is read through its copy of the actor index, and the months after
    // the cursor are pruned rather than scanned.
    expect(plan).toMatch(/Index Scan using activity_log_2026_10_actor_kind_actor_id_occurred_at_id_idx/)
    expect(plan).not.toMatch(/Seq Scan on activity_log_2026_10/)
    expect(plan).not.toMatch(/activity_log_2026_11/)
  })
})
