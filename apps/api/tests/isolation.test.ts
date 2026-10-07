import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext, SellerScope } from '#core/tenancy'
import { pgArray, type ScopedSql, withScope } from '#db/scoped/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// The isolation matrix (ACCESS.md §11.1), counts included, since a count that leaks is a
// leak. `withScope` sets the caller kind's role: the connection here is a superuser, and
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
  caller: { kind: 'person', userId: '00000000-0000-4000-8000-0000000000aa', sessionId: 's' },
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

  it('never reads the store customers: its role holds no grant on them (#295)', async () => {
    await expect(idsOf(supplier(), 'customer')).rejects.toThrow(/permission denied/i)
    await expect(countOf(supplier(), 'customer')).rejects.toThrow(/permission denied/i)
  })
})

describe('a shopper', () => {
  it('reads only their own customer row', async () => {
    expect(await idsOf(shopper(t.partnerA, t.storeA1, t.customerA1), 'customer')).toEqual([t.customerA1])
  })

  it('reads nothing when signed out', async () => {
    expect(await idsOf(shopper(t.partnerA, t.storeA1, null), 'customer')).toEqual([])
  })

  it('cannot read the store suppliers: app_shop holds no grant on them (#306)', async () => {
    await expect(idsOf(shopper(t.partnerA, t.storeA1, t.customerA1), 'seller')).rejects.toThrow(/permission denied/)
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

  it('never reaches inside a store: no customers, not even a count', async () => {
    // app_partner holds no grant on customer (#155), so the read is refused outright.
    const a = partnerCaller(t.partnerA)
    await expect(idsOf(a, 'customer')).rejects.toThrow(/permission denied/i)
    await expect(countOf(a, 'customer')).rejects.toThrow(/permission denied/i)
  })

  it('reads its own stores suppliers at account level, and no other partner stores suppliers', async () => {
    // Who a store's suppliers are is account-level (DATA-MODEL §2, decided on #32); what they
    // stock and sell stays inside the store.
    expect((await idsOf(partnerCaller(t.partnerA), 'seller')).sort()).toEqual([t.sellerA1First, t.sellerA1Second].sort())
    expect(await idsOf(partnerCaller(t.partnerB), 'seller')).toEqual([t.sellerB1])
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
    // The Customers menu is read-only (FIRST-RELEASE §5.4): app_platform holds select alone on
    // customer (#205), so the write is refused before any policy runs.
    await expect(
      withScope(db.sql, staff, async (tx) => tx`update customer set name = 'changed' where id = ${t.customerA1} returning id`),
    ).rejects.toThrow(/permission denied/i)

    const [row] = await db.sql<{ name: string | null }[]>`select name from customer where id = ${t.customerA1}`
    expect(row?.name).toBeNull()
  })

  it('never read a customer’s password hash', async () => {
    await expect(withScope(db.sql, staff, (tx) => tx`select password_hash from customer`)).rejects.toThrow(/permission denied/i)
  })

  it('cannot insert a customer: the grant refuses it outright', async () => {
    await expect(
      withScope(db.sql, staff, async (tx) => {
        await tx`insert into customer (store_id, email, status) values (${t.storeA1}, 'new@example.com', 'active')`
      }),
    ).rejects.toThrow(/permission denied/i)
  })

  it('read every supplier at account level, for the Users tab', async () => {
    expect((await idsOf(staff, 'seller')).sort()).toEqual([t.sellerA1First, t.sellerA1Second, t.sellerB1].sort())
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
    // app_supplier holds no write on seller (0047).
    await expect(
      attempt(supplier, async (tx) => {
        await tx`update seller set access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1First}`
      }),
    ).rejects.toThrow(/permission denied/i)
    const [row] = await db.sql<{ access_level: string }[]>`select access_level from seller where id = ${t.sellerA1First}`
    expect(row?.access_level).toBe('vendor-stock')
  })

  it('an anonymous shopper cannot create a customer', async () => {
    const before = await db.sql<{ n: string }[]>`select count(*)::text as n from customer`
    await expect(
      attempt(shopper(t.partnerA, t.storeA1, null), async (tx) => {
        await tx`insert into customer (store_id, email, status) values (${t.storeA1}, 'spam@example.com', 'active')`
      }),
    ).rejects.toThrow(/permission denied/i)
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
    ).rejects.toThrow(/permission denied/i)
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
    // `activity_log` is partitioned (relkind p); its policies apply to every partition read
    // through it, and nothing is granted on a partition directly (migrations/0006).
    const tables = [
      'partner', 'store', 'seller', 'customer', 'activity_log', 'outbox',
      'partner_user', 'partner_invitation', 'partner_domain', 'partner_setup_item', 'plan',
      'custom_domain', 'user', 'membership', 'invitation', 'job', 'job_detail', 'store_note',
      'merchant_charge', 'partner_payout', 'store_sales_month', 'partner_billing_feed', 'partner_domain_record', 'export_job', 'catalog_export', 'catalog_import', 'external_connection',
      'partner_password_reset', 'user_session', 'user_backup_code', 'verification_code',
      'user_password_reset', 'user_email_change', 'signup', 'signup_text',
      'product', 'product_option', 'product_option_value', 'product_version', 'product_version_option_value', 'version_price', 'price_history',
      'asset', 'product_photo', 'product_video',
      'filter', 'filter_value', 'product_filter_value', 'collection', 'collection_rule', 'collection_product', 'menu', 'menu_item',
      'store_feature', 'badge', 'size_chart', 'product_spec', 'product_highlight', 'product_faq', 'product_related', 'product_badge', 'product_flag', 'product_compliance', 'product_market_rule',
      'product_story', 'story_block', 'warehouse', 'stock_level', 'stock_movement',
    ]
    const rows = await db.sql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relname = any(${pgArray(tables)}::text[]) and relkind in ('r', 'p')
    `
    expect(rows).toHaveLength(tables.length)
    for (const row of rows) {
      expect({ [row.relname]: [row.relrowsecurity, row.relforcerowsecurity] }).toEqual({
        [row.relname]: [true, true],
      })
    }
  })

  it('keeps password resets to system scope: no request, partner or staff role reads or writes one (#208)', async () => {
    const [user] = await db.sql<{ id: string }[]>`
      insert into partner_user (partner_id, email, name, role_key, status) values (${t.partnerA}, 'reset.isolation@partner-a.example', 'Reset', 'partner-owner', 'active') returning id
    `
    await db.sql`
      insert into partner_password_reset (request_id, partner_id, partner_user_id, token_hash, expires_at)
      values (gen_random_uuid(), ${t.partnerA}, ${user?.id ?? ''}, 'isolation-hash', now() + interval '30 minutes')
    `
    const as = (role: string, scope: string, work: (tx: postgres.TransactionSql) => Promise<unknown>) =>
      db.sql.begin(async (tx: postgres.TransactionSql) => {
        await tx.unsafe(`set local role ${role}`)
        await tx`select set_config('app.scope', ${scope}, true)`
        await tx`select set_config('app.partner_id', ${t.partnerA}, true)`
        await tx`select set_config('app.store_id', ${t.storeA1}, true)`
        return work(tx)
      })
    for (const [role, scope] of [['app_request', 'store'], ['app_partner', 'partner'], ['app_platform', 'platform']] as const) {
      await expect(as(role, scope, (tx) => tx`select token_hash from partner_password_reset`)).rejects.toThrow(/permission denied/)
      await expect(
        as(role, scope, (tx) => tx`insert into partner_password_reset (request_id, partner_id, partner_user_id) values (gen_random_uuid(), ${t.partnerA}, ${user?.id ?? ''})`),
      ).rejects.toThrow(/permission denied/)
    }
    expect(await as('app_system', 'system', async (tx) => (await tx`select 1 from partner_password_reset where token_hash = 'isolation-hash'`).length)).toBe(1)
  })

  it('keeps sign-ups, merchant resets and email changes to system scope: no request, partner or staff role reads or writes one (#290)', async () => {
    const [person] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'signup.isolation@a.example', 'Iso', 'active') returning id`
    const userId = person?.id ?? ''
    await db.sql`insert into signup (partner_id, token_hash, stage, name, email, password_hash, expires_at) values (${t.partnerA}, 'iso-signup', 'email', 'Iso', 'iso@a.example', 'hash', now() + interval '1 day')`
    await db.sql`insert into signup_text (partner_id, phone, sent_at) values (${t.partnerA}, '+16145550000', now())`
    await db.sql`insert into user_password_reset (request_id, partner_id, user_id, token_hash, expires_at) values (gen_random_uuid(), ${t.partnerA}, ${userId}, 'iso-reset', now() + interval '30 minutes')`
    await db.sql`insert into user_email_change (partner_id, user_id, new_email, token_hash, expires_at) values (${t.partnerA}, ${userId}, 'new@a.example', 'iso-change', now() + interval '1 day')`
    const as = (role: string, scope: string, work: (tx: postgres.TransactionSql) => Promise<unknown>) =>
      db.sql.begin(async (tx: postgres.TransactionSql) => {
        await tx.unsafe(`set local role ${role}`)
        await tx`select set_config('app.scope', ${scope}, true)`
        await tx`select set_config('app.partner_id', ${t.partnerA}, true)`
        await tx`select set_config('app.store_id', ${t.storeA1}, true)`
        await tx`select set_config('app.user_id', ${userId}, true)`
        return work(tx)
      })
    for (const [role, scope] of [['app_request', 'store'], ['app_partner', 'partner'], ['app_platform', 'platform']] as const) {
      for (const table of ['signup', 'signup_text', 'user_password_reset', 'user_email_change']) {
        await expect(as(role, scope, (tx) => tx.unsafe(`select * from ${table}`))).rejects.toThrow(/permission denied/)
      }
      await expect(as(role, scope, (tx) => tx`insert into signup (partner_id, token_hash, stage, name, email, password_hash, expires_at) values (${t.partnerA}, 'x', 'email', 'x', 'x@a.example', 'h', now())`)).rejects.toThrow(/permission denied/)
      await expect(as(role, scope, (tx) => tx`insert into user_email_change (partner_id, user_id, new_email, expires_at) values (${t.partnerA}, ${userId}, 'x@a.example', now())`)).rejects.toThrow(/permission denied/)
    }
    expect(await as('app_system', 'system', async (tx) => (await tx`select 1 from signup where token_hash = 'iso-signup'`).length)).toBe(1)
  })

  it('holds the catalogue to the store and its supplier, with no partner, staff or forged history (#293)', async () => {
    const inStore = (storeId: string, sellerScope: SellerScope, work: (tx: ScopedSql) => Promise<unknown>) => withScope(db.sql, storeCaller(storeId === t.storeB1 ? t.partnerB : t.partnerA, storeId, sellerScope), work)
    const product = async (storeId: string, sellerId: string | null, slug: string) =>
      (await db.sql<{ id: string }[]>`insert into product (store_id, seller_id, name, slug) values (${storeId}, ${sellerId}, ${slug}, ${slug}) returning id`)[0]?.id ?? ''
    const own = await product(t.storeA1, null, 'iso-own')
    const first = await product(t.storeA1, t.sellerA1First, 'iso-first')
    const second = await product(t.storeA1, t.sellerA1Second, 'iso-second')
    const other = await product(t.storeB1, null, 'iso-b')
    for (const id of [own, first, second, other]) {
      const storeId = id === other ? t.storeB1 : t.storeA1
      const [v] = await db.sql<{ id: string }[]>`insert into product_version (product_id, store_id, position) values (${id}, ${storeId}, 0) returning id`
      await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${v?.id ?? ''}, ${storeId}, 'INR', 100)`
      const [o] = await db.sql<{ id: string }[]>`insert into product_option (product_id, store_id, name, position) values (${id}, ${storeId}, 'Size', 0) returning id`
      const [ov] = await db.sql<{ id: string }[]>`insert into product_option_value (option_id, store_id, name, position) values (${o?.id ?? ''}, ${storeId}, 'S', 0) returning id`
      await db.sql`insert into product_version_option_value (version_id, option_id, value_id, store_id) values (${v?.id ?? ''}, ${o?.id ?? ''}, ${ov?.id ?? ''}, ${storeId})`
    }
    const seen = (storeId: string, sellerScope: SellerScope, table: string) =>
      inStore(storeId, sellerScope, async (tx) => (await tx.unsafe(`select count(*)::int as n from ${table}`))[0]?.['n'] as number)
    const supplier = { kind: 'seller', sellerId: t.sellerA1First } as const
    for (const table of ['product', 'product_version', 'version_price', 'price_history', 'product_option', 'product_option_value', 'product_version_option_value']) {
      expect({ [table]: await seen(t.storeA1, { kind: 'all' }, table) }).toEqual({ [table]: 3 })
      expect({ [table]: await seen(t.storeA1, supplier, table) }).toEqual({ [table]: 1 })
      expect({ [table]: await seen(t.storeB1, { kind: 'all' }, table) }).toEqual({ [table]: 1 })
      // No partner or staff branch, nor a grant: they can't even ask (§7.11).
      await expect(withScope(db.sql, partnerCaller(t.partnerA), (tx) => tx.unsafe(`select count(*) from ${table}`))).rejects.toThrow(/permission denied/)
      await expect(withScope(db.sql, staff, (tx) => tx.unsafe(`select count(*) from ${table}`))).rejects.toThrow(/permission denied/)
    }
    // A supplier can't attach to another's product, take one over, or show and hide its own.
    await expect(inStore(t.storeA1, supplier, (tx) => tx`insert into product_version (product_id, store_id, position) values (${second}, ${t.storeA1}, 1)`)).rejects.toThrow(/no such product/)
    await expect(inStore(t.storeA1, supplier, (tx) => tx`insert into product (store_id, seller_id, name, slug) values (${t.storeA1}, ${t.sellerA1Second}, 'x', 'iso-x')`)).rejects.toThrow()
    await expect(inStore(t.storeA1, supplier, (tx) => tx`update product set visibility = 'visible' where id = ${first}`)).rejects.toThrow(/supplier changes no visibility/)
    // Nor create one as a sample, sent back or hidden, which would sit outside the plan's count and the lists.
    for (const column of ['is_sample', 'sent_back_reason', 'status_before_hide']) {
      const value = column === 'is_sample' ? true : column === 'sent_back_reason' ? 'x' : 'visible'
      await expect(inStore(t.storeA1, supplier, (tx) => tx.unsafe(`insert into product (store_id, seller_id, name, slug, ${column}) values ($1, $2, 'x', 'iso-${column.replaceAll('_', '-')}', $3)`, [t.storeA1, t.sellerA1First, value]))).rejects.toThrow(/no approval, hide or sample/)
    }
    expect(await inStore(t.storeA1, supplier, async (tx) => (await tx`update product set name = 'taken' where id = ${second}`).count)).toBe(0)
    // Nobody points a child into another store, or writes price history by hand.
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`insert into product_version (product_id, store_id, position) values (${other}, ${t.storeA1}, 1)`)).rejects.toThrow(/no such product/)
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`insert into product (store_id, name, slug) values (${t.storeB1}, 'x', 'iso-forged')`)).rejects.toThrow(/row-level security/)
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`insert into price_history (version_id, store_id, currency, amount, from_at) select id, store_id, 'INR', 1, now() from product_version limit 1`)).rejects.toThrow(/permission denied/)
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`update product set store_id = ${t.storeB1} where id = ${own}`)).rejects.toThrow(/permission denied/)
    // A read-only support session writes nothing.
    await expect(withScope(db.sql, supportSession(t.partnerA, t.storeA1, 'read'), (tx) => tx`insert into product (store_id, name, slug) values (${t.storeA1}, 'x', 'iso-support')`)).rejects.toThrow(/row-level security/)
    // Files: a supplier reads only its own, partner and staff can't ask, and nobody uploads as someone else.
    const file = async (sellerId: string | null, n: number) =>
      (await db.sql<{ id: string }[]>`insert into asset (store_id, seller_id, r2_key, kind, mime, bytes, checksum) values (${t.storeA1}, ${sellerId}, ${`stores/${t.storeA1}/assets/00000000-0000-4000-8000-00000000000${n}.png`}, 'image', 'image/png', 1, ${'0'.repeat(64)}) returning id`)[0]?.id ?? ''
    const ownFile = await file(null, 1)
    await file(t.sellerA1First, 2)
    await file(t.sellerA1Second, 3)
    expect(await seen(t.storeA1, { kind: 'all' }, 'asset')).toBe(3)
    expect(await seen(t.storeA1, supplier, 'asset')).toBe(1)
    expect(await seen(t.storeB1, { kind: 'all' }, 'asset')).toBe(0)
    await expect(withScope(db.sql, partnerCaller(t.partnerA), (tx) => tx`select count(*) from asset`)).rejects.toThrow(/permission denied/)
    await expect(inStore(t.storeA1, supplier, (tx) => tx`insert into asset (store_id, seller_id, r2_key, kind, mime, bytes, checksum) values (${t.storeA1}, null, ${`stores/${t.storeA1}/assets/00000000-0000-4000-8000-000000000009.png`}, 'image', 'image/png', 1, ${'0'.repeat(64)})`)).rejects.toThrow(/uploads as itself/)
    await expect(inStore(t.storeA1, supplier, (tx) => tx`insert into product_photo (product_id, store_id, asset_id, position) values (${first}, ${t.storeA1}, ${ownFile}, 0)`)).rejects.toThrow(/no such file/)
    // A photo or video never points across stores, whoever asks.
    await expect(inStore(t.storeB1, { kind: 'all' }, (tx) => tx`insert into product_photo (product_id, store_id, asset_id, position) values (${other}, ${t.storeB1}, ${ownFile}, 0)`)).rejects.toThrow(/no such file/)
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`insert into product_photo (product_id, store_id, asset_id, position) values (${other}, ${t.storeA1}, ${ownFile}, 0)`)).rejects.toThrow(/no such product/)
    await expect(inStore(t.storeB1, { kind: 'all' }, (tx) => tx`insert into product_video (product_id, store_id, asset_id) values (${other}, ${t.storeB1}, ${ownFile})`)).rejects.toThrow(/no such file/)
    expect(await seen(t.storeB1, { kind: 'all' }, 'product_photo')).toBe(0)
    // Structure: a supplier reads filters but writes none, never sees a collection or menu, and tags only its own products.
    const [filterRow] = await db.sql<{ id: string }[]>`insert into filter (store_id, name, position) values (${t.storeA1}, 'Iso filter', 0) returning id`
    const [valueRow] = await db.sql<{ id: string }[]>`insert into filter_value (filter_id, store_id, name, position) values (${filterRow?.id ?? ''}, ${t.storeA1}, 'Iso value', 0) returning id`
    await db.sql`insert into collection (store_id, name, slug, kind) values (${t.storeA1}, 'Iso', 'iso-collection', 'manual')`
    await db.sql`insert into menu (store_id, key, name) values (${t.storeA1}, 'main', 'Main')`
    expect(await seen(t.storeA1, supplier, 'filter')).toBe(1)
    expect(await seen(t.storeA1, supplier, 'filter_value')).toBe(1)
    // The supplier role holds no grant on collections or menus at all (#295).
    for (const table of ['collection', 'menu']) await expect(seen(t.storeA1, supplier, table)).rejects.toThrow(/permission denied/i)
    for (const table of ['filter', 'collection', 'menu']) expect({ [table]: await seen(t.storeB1, { kind: 'all' }, table) }).toEqual({ [table]: 0 })
    // Filters are the merchant's: the supplier reads them and holds no write (0047).
    await expect(inStore(t.storeA1, supplier, (tx) => tx`insert into filter (store_id, name, position) values (${t.storeA1}, 'Supplier filter', 1)`)).rejects.toThrow(/permission denied/)
    await expect(inStore(t.storeA1, supplier, (tx) => tx`update filter set name = 'taken' where id = ${filterRow?.id ?? ''}`)).rejects.toThrow(/permission denied/)
    await inStore(t.storeA1, supplier, (tx) => tx`insert into product_filter_value (product_id, filter_value_id, store_id) values (${first}, ${valueRow?.id ?? ''}, ${t.storeA1})`)
    await expect(inStore(t.storeA1, supplier, (tx) => tx`insert into product_filter_value (product_id, filter_value_id, store_id) values (${second}, ${valueRow?.id ?? ''}, ${t.storeA1})`)).rejects.toThrow(/no such product/)
    expect(await seen(t.storeA1, { kind: 'all' }, 'product_filter_value')).toBe(1)
    await expect(withScope(db.sql, partnerCaller(t.partnerA), (tx) => tx`select count(*) from collection`)).rejects.toThrow(/permission denied/)
    // Listing: a supplier reads the store's switches and badges but writes neither, keeps to its own charts,
    // and adds sections only to its own products.
    await db.sql`insert into store_feature (store_id, key, enabled) values (${t.storeA1}, 'faqs', true)`
    await db.sql`insert into badge (store_id, label, tone, rule) values (${t.storeA1}, 'Iso badge', 'ok', 'manual')`
    await db.sql`insert into size_chart (store_id, seller_id, name, unit) values (${t.storeA1}, null, 'Merchant chart', 'cm'), (${t.storeA1}, ${t.sellerA1First}, 'First chart', 'cm'), (${t.storeA1}, ${t.sellerA1Second}, 'Second chart', 'cm')`
    expect(await seen(t.storeA1, supplier, 'store_feature')).toBe(1)
    expect(await seen(t.storeA1, supplier, 'badge')).toBe(1)
    expect(await seen(t.storeA1, supplier, 'size_chart')).toBe(1)
    expect(await seen(t.storeA1, { kind: 'all' }, 'size_chart')).toBe(3)
    for (const table of ['store_feature', 'badge', 'size_chart']) expect({ [table]: await seen(t.storeB1, { kind: 'all' }, table) }).toEqual({ [table]: 0 })
    await expect(inStore(t.storeA1, supplier, (tx) => tx`insert into badge (store_id, label, tone, rule) values (${t.storeA1}, 'Supplier badge', 'ok', 'manual')`)).rejects.toThrow(/permission denied/)
    await expect(inStore(t.storeA1, supplier, (tx) => tx`insert into size_chart (store_id, seller_id, name, unit) values (${t.storeA1}, null, 'As merchant', 'cm')`)).rejects.toThrow(/makes its own size charts/)
    await inStore(t.storeA1, supplier, (tx) => tx`insert into product_highlight (product_id, store_id, text, position) values (${first}, ${t.storeA1}, 'Own', 0)`)
    await expect(inStore(t.storeA1, supplier, (tx) => tx`insert into product_highlight (product_id, store_id, text, position) values (${second}, ${t.storeA1}, 'Theirs', 0)`)).rejects.toThrow(/no such product/)
    expect(await seen(t.storeA1, supplier, 'product_highlight')).toBe(1)
    // Even the merchant side can't relate another owner's product onto a supplier's, which the supplier reads.
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`insert into product_related (product_id, related_product_id, store_id, position) values (${first}, ${own}, ${t.storeA1}, 0)`)).rejects.toThrow(/no such product to relate/)
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`insert into product_related (product_id, related_product_id, store_id, position) values (${first}, ${second}, ${t.storeA1}, 0)`)).rejects.toThrow(/no such product to relate/)
    await expect(withScope(db.sql, partnerCaller(t.partnerA), (tx) => tx`select count(*) from size_chart`)).rejects.toThrow(/permission denied/)
    // A+: a supplier keeps to its own products' stories and never reads the merchant's brand stories, and
    // no story on a supplier's product names another owner's product or a brand story, whoever writes it.
    await db.sql`insert into story_block (store_id, name, content) values (${t.storeA1}, 'Iso brand', '{"title":"T","body":"B","photo":null}')`
    const [block] = await db.sql<{ id: string }[]>`select id from story_block where name = 'Iso brand'`
    await inStore(t.storeA1, supplier, (tx) => tx`insert into product_story (product_id, store_id) values (${first}, ${t.storeA1})`)
    await expect(inStore(t.storeA1, supplier, (tx) => tx`insert into product_story (product_id, store_id) values (${second}, ${t.storeA1})`)).rejects.toThrow(/no such product/)
    await inStore(t.storeA1, { kind: 'all' }, (tx) => tx`insert into product_story (product_id, store_id) values (${own}, ${t.storeA1})`)
    expect(await seen(t.storeA1, supplier, 'product_story')).toBe(1)
    expect(await seen(t.storeA1, supplier, 'story_block')).toBe(0)
    expect(await seen(t.storeB1, { kind: 'all' }, 'product_story')).toBe(0)
    const compare = (id: string) => [{ id: 'c', kind: 'compare', productIds: [id] }]
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`update product_story set draft = ${tx.json(compare(own))} where product_id = ${first}`)).rejects.toThrow(/compares a product it can't/)
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`update product_story set draft = ${tx.json(compare(second))} where product_id = ${first}`)).rejects.toThrow(/compares a product it can't/)
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`update product_story set draft = ${tx.json([{ id: 'b', kind: 'brand', blockId: block?.id ?? null }])} where product_id = ${first}`)).rejects.toThrow(/brand story it can't/)
    await expect(inStore(t.storeA1, supplier, (tx) => tx`insert into story_block (store_id, name, content) values (${t.storeA1}, 'Supplier brand', '{}')`)).rejects.toThrow(/permission denied/)
    // Stock: quantities move only through stock_change(), which writes the movement itself, so no caller
    // sets a count, a reservation or a history row directly (migration 0046).
    const [version] = await db.sql<{ id: string }[]>`select id from product_version where product_id = ${own} limit 1`
    const [location] = await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${t.storeA1} and seller_id is null and is_default`
    await inStore(t.storeA1, { kind: 'all' }, (tx) => tx`select stock_change(${version?.id ?? ''}, ${location?.id ?? ''}, 2, null, 'received')`)
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`update stock_level set on_hand = 99 where version_id = ${version?.id ?? ''}`)).rejects.toThrow(/permission denied/)
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`update stock_level set reserved = 1 where version_id = ${version?.id ?? ''}`)).rejects.toThrow(/permission denied/)
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`insert into stock_movement (store_id, version_id, warehouse_id, delta, resulting_quantity, reason, actor_kind) values (${t.storeA1}, ${version?.id ?? ''}, ${location?.id ?? ''}, 5, 5, 'received', 'system')`)).rejects.toThrow(/permission denied/)
    // `import` is the importer's own (0059, #301), under the same location and owner checks as `received`.
    for (const reason of ['order', 'starting', 'transfer']) {
      await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`select stock_change(${version?.id ?? ''}, ${location?.id ?? ''}, 1, null, ${reason})`)).rejects.toThrow(/known reason/)
    }
    await expect(inStore(t.storeA1, supplier, (tx) => tx`select stock_change(${version?.id ?? ''}, ${location?.id ?? ''}, 1, null, 'received')`)).rejects.toThrow(/no such version or location/)
    await expect(inStore(t.storeB1, { kind: 'all' }, (tx) => tx`select stock_change(${version?.id ?? ''}, ${location?.id ?? ''}, 1, null, 'received')`)).rejects.toThrow(/no such version or location/)
    // `import` reaches no further than `received`: not another seller's location or version, not another store's, never read-only support.
    await expect(inStore(t.storeA1, supplier, (tx) => tx`select stock_change(${version?.id ?? ''}, ${location?.id ?? ''}, 1, null, 'import')`)).rejects.toThrow(/no such version or location/)
    await expect(inStore(t.storeB1, { kind: 'all' }, (tx) => tx`select stock_change(${version?.id ?? ''}, ${location?.id ?? ''}, 1, null, 'import')`)).rejects.toThrow(/no such version or location/)
    const readOnlySupport: CallerContext = { caller: { kind: 'support', supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: 'read' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' }
    await expect(withScope(db.sql, readOnlySupport, (tx) => tx`select stock_change(${version?.id ?? ''}, ${location?.id ?? ''}, 1, null, 'import')`)).rejects.toThrow(/not in this scope/)
    expect(await seen(t.storeA1, supplier, 'stock_movement')).toBe(0)
    expect(await seen(t.storeA1, supplier, 'stock_level')).toBe(0)
    expect(await seen(t.storeB1, { kind: 'all' }, 'stock_movement')).toBe(0)
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`insert into warehouse (store_id, seller_id, name) values (${t.storeA1}, ${t.sellerA1First}, 'For them')`)).rejects.toThrow(/theirs to change/)
    await expect(inStore(t.storeA1, supplier, (tx) => tx`insert into warehouse (store_id, seller_id, name) values (${t.storeA1}, null, 'As merchant')`)).rejects.toThrow(/adds its own locations/)
    const [theirs] = await db.sql<{ id: string }[]>`insert into warehouse (store_id, seller_id, name) values (${t.storeA1}, ${t.sellerA1First}, 'Iso godown') returning id`
    const [theirVersion] = await db.sql<{ id: string }[]>`select v.id from product_version v join product p on p.id = v.product_id where p.seller_id = ${t.sellerA1First} limit 1`
    await db.sql`insert into stock_level (version_id, warehouse_id, store_id) values (${theirVersion?.id ?? ''}, ${theirs?.id ?? ''}, ${t.storeA1})`
    await expect(inStore(t.storeA1, { kind: 'all' }, (tx) => tx`update stock_level set low_stock_threshold = 0 where warehouse_id = ${theirs?.id ?? ''}`)).rejects.toThrow(/theirs to change/)
    await expect(withScope(db.sql, partnerCaller(t.partnerA), (tx) => tx`select stock_change(${version?.id ?? ''}, ${location?.id ?? ''}, 1, null, 'received')`)).rejects.toThrow(/permission denied/)
    for (const table of ['warehouse', 'stock_level', 'stock_movement']) {
      await expect(withScope(db.sql, partnerCaller(t.partnerA), (tx) => tx.unsafe(`select count(*) from ${table}`))).rejects.toThrow(/permission denied/)
      await expect(withScope(db.sql, staff, (tx) => tx.unsafe(`select count(*) from ${table}`))).rejects.toThrow(/permission denied/)
    }
    for (const table of ['product_story', 'story_block']) {
      await expect(withScope(db.sql, partnerCaller(t.partnerA), (tx) => tx.unsafe(`select count(*) from ${table}`))).rejects.toThrow(/permission denied/)
      await expect(withScope(db.sql, staff, (tx) => tx.unsafe(`select count(*) from ${table}`))).rejects.toThrow(/permission denied/)
    }
    // The plan count is the whole store's, a number only, whoever asks.
    expect(await inStore(t.storeA1, supplier, async (tx) => (await tx<{ n: number }[]>`select store_product_count() as n`)[0]?.n)).toBe(3)
    await expect(withScope(db.sql, partnerCaller(t.partnerA), (tx) => tx`select store_product_count()`)).rejects.toThrow(/permission denied/)
  })

  it('runs staff as app_platform, partner callers as app_partner, suppliers as app_supplier, shoppers as app_shop and other store callers as app_request (#205, #155, #295, #306)', async () => {
    const roleOf = async (context: CallerContext) =>
      withScope(db.sql, context, async (tx) => (await tx<{ role: string }[]>`select current_user as role`)[0]?.role)
    expect(await roleOf(staff)).toBe('app_platform')
    expect(await roleOf(storeCaller(t.partnerA, t.storeA1))).toBe('app_request')
    expect(await roleOf(storeCaller(t.partnerA, t.storeA1, { kind: 'seller', sellerId: t.sellerA1First }))).toBe('app_supplier')
    expect(await roleOf(shopper(t.partnerA, t.storeA1, null))).toBe('app_shop')
    expect(await roleOf(supportSession(t.partnerA, t.storeA1, 'read'))).toBe('app_request')
    expect(await roleOf(partnerCaller(t.partnerA))).toBe('app_partner')
  })

  it('holds each role to its own scopes, whatever app.scope says', async () => {
    const partnersSeen = async (role: string, scope: string) =>
      db.sql.begin(async (tx: postgres.TransactionSql) => {
        await tx.unsafe(`set local role ${role}`)
        await tx`select set_config('app.scope', ${scope}, true)`
        await tx`select set_config('app.partner_id', ${t.partnerA}, true)`
        return (await tx`select id from partner`).length
      })
    expect(await partnersSeen('app_platform', 'platform')).toBeGreaterThan(1)
    expect(await partnersSeen('app_partner', 'partner')).toBe(1)
    expect(await partnersSeen('app_request', 'partner')).toBe(0)
    // Until #210: the Worker live before #205 serves staff as app_request, and must keep working
    // until the new one is promoted. #210 makes this 0.
    expect(await partnersSeen('app_request', 'platform')).toBeGreaterThan(1)
    expect(await partnersSeen('app_partner', 'platform')).toBe(0)
    expect(await partnersSeen('app_platform', 'partner')).toBe(0)
    expect(await partnersSeen('app_system', 'platform')).toBe(0)
  })

  it('names a role on every policy, and pins every role to its scopes on every tenant table', async () => {
    const toPublic = await db.sql<{ policy: string }[]>`
      select c.relname || '.' || p.polname as policy from pg_policy p
      join pg_class c on c.oid = p.polrelid
      where c.relnamespace = 'public'::regnamespace and 0 = any(p.polroles)
    `
    expect(toPublic.map((row) => row.policy)).toEqual([])
    const unpinned = await db.sql<{ relname: string }[]>`
      select c.relname from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity
        and (select count(*) from pg_policy p
             where p.polrelid = c.oid and not p.polpermissive
               and p.polname in ('request_scope', 'partner_scope', 'platform_scope', 'system_scope')) <> 4
    `
    expect(unpinned.map((row) => row.relname)).toEqual([])
  })

  it('reserves app_definer: no login, and the one role that bypasses RLS', async () => {
    const roles = await db.sql<{ rolname: string; rolcanlogin: boolean; rolbypassrls: boolean }[]>`
      select rolname, rolcanlogin, rolbypassrls from pg_roles where rolname like 'app\_%' order by rolname
    `
    expect(roles.filter((r) => r.rolbypassrls).map((r) => r.rolname)).toEqual(['app_definer'])
    expect(roles.filter((r) => r.rolcanlogin)).toEqual([])
  })

  it('shows a supplier only its own activity entries and none of the outbox (#295)', async () => {
    const entry = (sellerId: string | null, action: string) =>
      db.sql`insert into activity_log (category, action, result, actor_kind, visibility, store_id, partner_id, seller_id) values ('write', ${action}, 'success', 'person', 'store', ${t.storeA1}, ${t.partnerA}, ${sellerId})`
    await entry(t.sellerA1First, 'own.entry')
    await entry(t.sellerA1Second, 'other.supplier.entry')
    await entry(null, 'merchant.entry')
    const seen = await withScope(db.sql, storeCaller(t.partnerA, t.storeA1, { kind: 'seller', sellerId: t.sellerA1First }), (tx) => tx<{ action: string }[]>`select action from activity_log where action like '%entry'`)
    expect(seen.map((r) => r.action)).toEqual(['own.entry'])
    await expect(withScope(db.sql, storeCaller(t.partnerA, t.storeA1, { kind: 'seller', sellerId: t.sellerA1First }), (tx) => tx`select id from outbox`)).rejects.toThrow(/permission denied/i)
  })

  it('keeps app_supplier to the tables a supplier reaches (DATA-MODEL §5.3, #295)', async () => {
    const tables = async (sql: string) => (await db.sql.unsafe<{ t: string }[]>(sql)).map((r) => r.t)
    // A new one is a decision: add it to 0047's list and here, with what the supplier does with it.
    expect(await tables(`select distinct table_name as t from information_schema.role_table_grants where grantee = 'app_supplier'
      union select distinct table_name from information_schema.column_privileges where grantee = 'app_supplier' and table_name not in ('store', 'story_block') order by 1`)).toEqual([
      'activity_log', 'asset', 'badge', 'catalog_export', 'catalog_import', 'external_connection', 'filter', 'filter_value', 'invitation', 'membership',
      // Its own parts and lines without money, and the two views of the order and its lines' money (#310, 0070).
      'order_for_supplier', 'order_line', 'order_line_for_supplier', 'order_part', 'outbox', 'price_history',
      'product', 'product_badge', 'product_compliance', 'product_faq', 'product_filter_value', 'product_flag', 'product_highlight',
      'product_market_rule', 'product_option', 'product_option_value', 'product_photo', 'product_related', 'product_spec', 'product_story',
      'product_version', 'product_version_option_value', 'product_video', 'seller', 'size_chart', 'stock_level', 'stock_movement',
      'store_feature', 'store_language', 'tax_class', 'translation', 'user', 'version_price', 'warehouse',
    ])
    // Writes only on its catalogue, stock, its own exports (#301) and what every write records; price history and stock movements only through
    // their definer functions; its team's invitations and memberships by column (0049); the settings and its seller it only reads.
    expect(await tables(`select distinct table_name as t from information_schema.role_table_grants where grantee = 'app_supplier' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      union select distinct table_name from information_schema.column_privileges where grantee = 'app_supplier' and privilege_type in ('INSERT', 'UPDATE') order by 1`)).toEqual([
      'activity_log', 'asset', 'catalog_export', 'catalog_import', 'external_connection', 'invitation', 'membership', 'outbox', 'product', 'product_badge', 'product_compliance', 'product_faq', 'product_filter_value',
      'product_flag', 'product_highlight', 'product_market_rule', 'product_option', 'product_option_value', 'product_photo', 'product_related',
      'product_spec', 'product_story', 'product_version', 'product_version_option_value', 'product_video', 'size_chart', 'stock_level',
      'translation', 'version_price', 'warehouse',
    ])
    // By column only: the two a policy names (store) and a file check reads (story_block).
    expect(await tables(`select distinct table_name || '(' || column_name || ')' as t from information_schema.column_privileges where grantee = 'app_supplier' and table_name in ('store', 'story_block') order by 1`)).toEqual([
      'store(id)', 'store(partner_id)', 'story_block(asset_ids)', 'story_block(id)',
    ])
    // Copied from app_request, so the credential columns stay withheld (DATA-MODEL §2.1); backup codes' table it never holds.
    const withheld = [['user', 'password_hash'], ['user', 'two_factor_secret_enc'], ['user', 'phone'], ['invitation', 'token_hash']] as const
    for (const [table, column] of withheld) {
      const [held] = await db.sql<{ ok: boolean }[]>`select has_column_privilege('app_supplier', ${`"${table}"`}, ${column}, 'SELECT') as ok`
      expect({ table, column, readable: held?.ok }).toEqual({ table, column, readable: false })
      await expect(withScope(db.sql, storeCaller(t.partnerA, t.storeA1, { kind: 'seller', sellerId: t.sellerA1First }), (tx) => tx.unsafe(`select ${column} from "${table}"`))).rejects.toThrow(/permission denied/i)
    }
    // Grants that look wide are held to the supplier's own rows by policy; no store or brand story row is ever its.
    expect(await idsOf(storeCaller(t.partnerA, t.storeA1, { kind: 'seller', sellerId: t.sellerA1First }), 'store')).toEqual([])
  })

  it('keeps app_definer to the functions DATA-MODEL §5.3 lists, each pinning its search path', async () => {
    const owned = await db.sql<{ proname: string; prosecdef: boolean; pinned: boolean }[]>`
      select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false) as pinned
      from pg_proc p join pg_roles r on r.oid = p.proowner where r.rolname = 'app_definer' order by p.proname
    `
    // A new one is a decision: add it here and to DATA-MODEL §5.3's app_definer row, with its filter.
    expect(owned.map((f) => f.proname)).toEqual([
      'acting_store_main_language',
      'current_order_token_hash',
      'end_partner_user_sessions',
      'end_staff_user_sessions',
      'latest_job_of',
      'membership_check_parents',
      'open_support_banner',
      'partner_domain_record_owner',
      'partner_host_claimed',
      'partner_may_add_owner',
      'partner_move_subscription',
      'partner_user_email_limit',
      'plan_entitlement_within_ceiling',
      'plan_first_version',
      'save_store_info',
      'set_store_main_language',
      'set_store_tax_inclusive',
      'set_store_vendor_approval',
      'shop_stock',
      'spend_partner_reauth',
      'stock_change',
      'store_billing_status_own_billing',
      'store_default_customer_auth',
      'store_default_market',
      'store_default_tax',
      'store_default_warehouse',
      'store_delivers_to',
      'store_invitee',
      'store_markets_follow_currency',
      'store_pricing_currency',
      'store_product_count',
      'store_unit_system',
      'store_vendor_approval',
      'storefront_catalog_touched',
      'storefront_for_store',
      'storefront_store_touched',
      'version_price_history',
    ])
    expect(owned.filter((f) => f.prosecdef && !f.pinned).map((f) => f.proname)).toEqual([])
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
