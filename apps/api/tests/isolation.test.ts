import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext, SellerScope } from '#core/tenancy'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// The isolation matrix (ACCESS.md §11.1), counts included, since a count that leaks is a
// leak. `withScope` sets the role to `app_request`: the connection here is a superuser, and
// a superuser bypasses RLS, so without that every assertion would pass proving nothing.

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

  it('never reads the store row', async () => {
    // Nothing leaks today — the row is little more than a key — but #32 adds the plan, the
    // store code, the owner, the storefront and the domains to it. ACCESS §7: "A vendor never
    // sees anything of the merchant's or another vendor's."
    expect(await idsOf(supplier(), 'store')).toEqual([])
    expect(await countOf(supplier(), 'store')).toBe(0)
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
    // The Customers menu is read-only (FIRST-RELEASE §5.4). An UPDATE filtered out by USING
    // affects no rows rather than raising, so the assertion is that nothing changed.
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

// Every one of these was possible until the policies were split per command. A permissive
// policy written `for all` with only a USING clause reuses it as the WITH CHECK, so what a
// caller may *see* silently became what it may *write*. None of them had a test.
describe('the write path', () => {
  const attempt = (context: CallerContext, work: (tx: ScopedSql) => Promise<void>) =>
    withScope(db.sql, context, work)

  it('a store caller cannot re-parent its own store to another partner', async () => {
    await expect(
      attempt(storeCaller(t.partnerA, t.storeA1), async (tx) => {
        await tx`update store set partner_id = ${t.partnerB} where id = ${t.storeA1}`
      }),
    ).resolves.toBeUndefined()
    // The update is filtered out rather than refused, so the proof is the row, read as owner.
    const [row] = await db.sql<{ partner_id: string }[]>`select partner_id from store where id = ${t.storeA1}`
    expect(row?.partner_id).toBe(t.partnerA)
  })

  it('a partner cannot move a store to another partner either', async () => {
    await expect(
      attempt(partnerCaller(t.partnerA), async (tx) => {
        await tx`update store set partner_id = ${t.partnerB} where id = ${t.storeA1}`
      }),
    ).rejects.toThrow(/row-level security/i)
    const [row] = await db.sql<{ partner_id: string }[]>`select partner_id from store where id = ${t.storeA1}`
    expect(row?.partner_id).toBe(t.partnerA)
  })

  it('a store caller cannot delete its own store row', async () => {
    await attempt(storeCaller(t.partnerA, t.storeA2), async (tx) => {
      await tx`delete from store where id = ${t.storeA2}`
    })
    const [row] = await db.sql<{ n: string }[]>`select count(*)::text as n from store where id = ${t.storeA2}`
    expect(Number(row?.n)).toBe(1)
  })

  it('a supplier cannot raise its own access level', async () => {
    const supplier = storeCaller(t.partnerA, t.storeA1, { kind: 'seller', sellerId: t.sellerA1First })
    await attempt(supplier, async (tx) => {
      await tx`update seller set access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1First}`
    })
    const [row] = await db.sql<{ access_level: string }[]>`select access_level from seller where id = ${t.sellerA1First}`
    expect(row?.access_level).toBe('vendor-stock')
  })

  it('an anonymous shopper cannot create a customer', async () => {
    const before = await db.sql<{ n: string }[]>`select count(*)::text as n from customer`
    await expect(
      attempt(shopper(t.partnerA, t.storeA1, null), async (tx) => {
        await tx`insert into customer (store_id, email, status) values (${t.storeA1}, 'spam@example.com', 'active')`
      }),
    ).rejects.toThrow(/row-level security/i)
    // Counted as the owner: RLS hides the row from the caller that made it, so a count taken
    // inside the session would say zero whether or not the insert landed.
    const after = await db.sql<{ n: string }[]>`select count(*)::text as n from customer`
    expect(after[0]?.n).toBe(before[0]?.n)
  })

  it('a signed-in shopper cannot create one either', async () => {
    await expect(
      attempt(shopper(t.partnerA, t.storeA1, t.customerA1), async (tx) => {
        await tx`insert into customer (store_id, email, status) values (${t.storeA1}, 'also-spam@example.com', 'active')`
      }),
    ).rejects.toThrow(/row-level security/i)
  })

  it('the merchant side can still manage its own suppliers and customers', async () => {
    await attempt(storeCaller(t.partnerA, t.storeA1), async (tx) => {
      const rows = await tx`update seller set status = 'suspended' where id = ${t.sellerA1Second} returning id`
      expect(rows.length).toBe(1)
    })
    await db.sql`update seller set status = 'active' where id = ${t.sellerA1Second}`
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
