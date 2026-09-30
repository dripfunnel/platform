import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext, SellerScope } from '#core/tenancy'
import { withScope } from '#db/scoped/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// The isolation matrix (ACCESS.md §11.1): caller kind × store × seller, asserting that a
// caller of one tenant gets nothing of another's — counts and empty results included, since
// a count that leaks is a leak.
//
// These run through `withScope`, which sets the role to `app_request`. That matters: the
// connection here is a superuser, and a superuser bypasses RLS entirely. Without the role
// change every assertion below would pass while proving nothing, which is the failure mode
// this file exists to avoid.

let db: TestDatabase
let t: Tenants

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const storeCaller = (partnerId: string, storeId: string, sellerScope: SellerScope = { kind: 'all' }): CallerContext => ({
  caller: { kind: 'person', userId: 'u', sessionId: 's' },
  partnerId,
  storeId,
  sellerScope,
  subscription: 'active',
})

const shopper = (partnerId: string, storeId: string, customerId: string | null): CallerContext => ({
  caller: { kind: 'shopper', customerId },
  partnerId,
  storeId,
  sellerScope: { kind: 'all' },
  subscription: 'active',
})

const supportSession = (partnerId: string, storeId: string, access: 'read' | 'write'): CallerContext => ({
  caller: { kind: 'support', supportSessionId: 'ss', partnerUserId: 'pu', access },
  partnerId,
  storeId,
  sellerScope: { kind: 'all' },
  subscription: 'active',
})

const partnerCaller = (partnerId: string): CallerContext => ({
  caller: { kind: 'partner-user', partnerUserId: 'pu' },
  partnerId,
})

const staff: CallerContext = { caller: { kind: 'staff', staffId: 'st' } }

const idsOf = async (context: CallerContext, table: 'partner' | 'store' | 'seller' | 'customer'): Promise<string[]> =>
  withScope(db.sql, context, async (tx) => {
    const rows = await tx<{ id: string }[]>`select id from ${tx(table)} order by id`
    return rows.map((row) => row.id)
  })

const countOf = async (context: CallerContext, table: 'partner' | 'store' | 'seller' | 'customer'): Promise<number> =>
  withScope(db.sql, context, async (tx) => {
    const [row] = await tx<{ n: string }[]>`select count(*)::text as n from ${tx(table)}`
    return Number(row?.n ?? -1)
  })

describe('a store caller', () => {
  it('sees its own store and nothing of another store or partner', async () => {
    const a1 = storeCaller(t.partnerA, t.storeA1)
    expect(await idsOf(a1, 'store')).toEqual([t.storeA1])
    expect(await idsOf(a1, 'customer')).toEqual([t.customerA1])
    expect((await idsOf(a1, 'seller')).sort()).toEqual([t.sellerA1First, t.sellerA1Second].sort())
  })

  it('sees nothing of a sibling store under the same partner', async () => {
    const a1 = storeCaller(t.partnerA, t.storeA1)
    expect(await idsOf(a1, 'customer')).not.toContain(t.customerA2)
    expect(await idsOf(a1, 'store')).not.toContain(t.storeA2)
  })

  it('cannot read the partner table at all', async () => {
    // Account-level partner data belongs to the partner console, not a merchant's (§2).
    expect(await idsOf(storeCaller(t.partnerA, t.storeA1), 'partner')).toEqual([])
  })

  it('leaks nothing through a count either', async () => {
    expect(await countOf(storeCaller(t.partnerA, t.storeA1), 'customer')).toBe(1)
    expect(await countOf(storeCaller(t.partnerB, t.storeB1), 'customer')).toBe(1)
  })

  it('claiming another partner cannot reach that partner rows', async () => {
    // The store id is what scopes the read; naming someone else's partner changes nothing.
    expect(await idsOf(storeCaller(t.partnerB, t.storeA1), 'store')).toEqual([t.storeA1])
  })
})

describe('a supplier in a store', () => {
  const supplier = () => storeCaller(t.partnerA, t.storeA1, { kind: 'seller', sellerId: t.sellerA1First })

  it('reads its own supplier record and not the store list of suppliers', async () => {
    expect(await idsOf(supplier(), 'seller')).toEqual([t.sellerA1First])
  })

  it('never reads the store customers', async () => {
    expect(await idsOf(supplier(), 'customer')).toEqual([])
    expect(await countOf(supplier(), 'customer')).toBe(0)
  })
})

describe('a shopper', () => {
  it('reads only their own customer row', async () => {
    expect(await idsOf(shopper(t.partnerA, t.storeA1, t.customerA1), 'customer')).toEqual([t.customerA1])
  })

  it('reads nothing when signed out', async () => {
    expect(await idsOf(shopper(t.partnerA, t.storeA1, null), 'customer')).toEqual([])
  })

  it('cannot read the store suppliers', async () => {
    expect(await idsOf(shopper(t.partnerA, t.storeA1, t.customerA1), 'seller')).toEqual([])
  })
})

describe('a partner user', () => {
  it('sees its own partner and its own stores', async () => {
    const a = partnerCaller(t.partnerA)
    expect(await idsOf(a, 'partner')).toEqual([t.partnerA])
    expect((await idsOf(a, 'store')).sort()).toEqual([t.storeA1, t.storeA2].sort())
  })

  it('sees nothing of another partner', async () => {
    const b = partnerCaller(t.partnerB)
    expect(await idsOf(b, 'store')).toEqual([t.storeB1])
    expect(await idsOf(b, 'partner')).not.toContain(t.partnerA)
  })

  it('never reaches inside a store: no customers, no suppliers', async () => {
    const a = partnerCaller(t.partnerA)
    expect(await idsOf(a, 'customer')).toEqual([])
    expect(await idsOf(a, 'seller')).toEqual([])
    expect(await countOf(a, 'customer')).toBe(0)
  })
})

describe('staff on the Admin API', () => {
  it('see every partner and store at account level', async () => {
    expect((await idsOf(staff, 'partner')).sort()).toEqual([t.partnerA, t.partnerB].sort())
    expect((await idsOf(staff, 'store')).sort()).toEqual([t.storeA1, t.storeA2, t.storeB1].sort())
  })

  it('see customer accounts, which is the one kind of store data they read directly', async () => {
    expect((await idsOf(staff, 'customer')).sort()).toEqual(
      [t.customerA1, t.customerA2, t.customerB1].sort(),
    )
  })

  it('cannot change a customer even though they can read one', async () => {
    // FIRST-RELEASE §5.4: the Customers menu is read-only, and the policy is what enforces
    // it rather than the absence of a button.
    //
    // An UPDATE filtered out by a USING clause affects no rows rather than raising — that is
    // how Postgres applies RLS to updates — so the assertion is that nothing changed, not
    // that it threw. A silent no-op would be a poor error message but it is not a leak, and
    // the API never offers the write in the first place.
    const changed = await withScope(db.sql, staff, async (tx) => {
      const rows = await tx`update customer set name = 'changed' where id = ${t.customerA1} returning id`
      return rows.length
    })
    expect(changed).toBe(0)

    const [row] = await db.sql<{ name: string | null }[]>`select name from customer where id = ${t.customerA1}`
    expect(row?.name).toBeNull()
  })

  it('cannot insert a customer: WITH CHECK refuses it outright', async () => {
    await expect(
      withScope(db.sql, staff, async (tx) => {
        await tx`insert into customer (store_id, email, status) values (${t.storeA1}, 'new@example.com', 'active')`
      }),
    ).rejects.toThrow(/row-level security/i)
  })

  it('cannot read a store supplier without impersonating', async () => {
    expect(await idsOf(staff, 'seller')).toEqual([])
  })
})

describe('a read-only support session', () => {
  const readOnly = () => supportSession(t.partnerA, t.storeA1, 'read')

  it('reads the store it was opened for', async () => {
    expect(await idsOf(readOnly(), 'customer')).toEqual([t.customerA1])
  })

  it('cannot update', async () => {
    await expect(
      withScope(db.sql, readOnly(), async (tx) => {
        await tx`update customer set name = 'changed' where id = ${t.customerA1}`
      }),
    ).rejects.toThrow(/row-level security/i)
  })

  it('cannot insert', async () => {
    await expect(
      withScope(db.sql, readOnly(), async (tx) => {
        await tx`insert into customer (store_id, email, status) values (${t.storeA1}, 'new@example.com', 'active')`
      }),
    ).rejects.toThrow(/row-level security/i)
  })

  it('cannot delete — the case WITH CHECK does not cover', async () => {
    // DATA-MODEL §5.2 described the read-only session as refused by "write policies (WITH
    // CHECK)". WITH CHECK does not apply to DELETE, so a single FOR ALL policy left a
    // read-only session able to delete the very rows it was only meant to look at.
    await withScope(db.sql, readOnly(), async (tx) => {
      const rows = await tx`delete from customer where id = ${t.customerA1} returning id`
      expect(rows.length).toBe(0)
    })
    const [row] = await db.sql<{ n: string }[]>`select count(*)::text as n from customer where id = ${t.customerA1}`
    expect(Number(row?.n)).toBe(1)
  })

  it('may write once the merchant elevates it', async () => {
    await withScope(db.sql, supportSession(t.partnerA, t.storeA1, 'write'), async (tx) => {
      const rows = await tx`update customer set name = 'fixed by support' where id = ${t.customerA1} returning id`
      expect(rows.length).toBe(1)
    })
    await db.sql`update customer set name = null where id = ${t.customerA1}`
  })
})

describe('the backstop itself', () => {
  it('refuses everything when no scope is set', async () => {
    const bare = async (table: 'partner' | 'store' | 'seller' | 'customer') =>
      db.sql.begin(async (tx: postgres.TransactionSql) => {
        await tx`set local role app_request`
        const rows = await tx<{ id: string }[]>`select id from ${tx(table)}`
        return rows.length
      })
    for (const table of ['partner', 'store', 'seller', 'customer'] as const) {
      expect(await bare(table)).toBe(0)
    }
  })

  it('is forced on every tenant table, so the owner is subject to it too', async () => {
    const rows = await db.sql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relname in ('partner', 'store', 'seller', 'customer') and relkind = 'r'
    `
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect({ [row.relname]: [row.relrowsecurity, row.relforcerowsecurity] }).toEqual({
        [row.relname]: [true, true],
      })
    }
  })

  it('leaves no tenant table without a policy', async () => {
    const rows = await db.sql<{ relname: string }[]>`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    `
    expect(rows.map((row) => row.relname)).toEqual([])
  })
})
