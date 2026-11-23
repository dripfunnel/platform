import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext, SellerScope } from '#core/tenancy'
import { deleteCourierAccount, saveCourierAccount, selectCourierAccounts, selectSealedCourierAccounts } from '#db/scoped/courierAccounts'
import { withScope, withSystemScope } from '#db/scoped/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// #1489's isolation matrix for `courier_account` (migration 0409; ACCESS.md §11.1): a store's own Shiprocket login is
// reached by that store's own scope only, never another store's, a supplier's, a shopper's, a partner's or the platform's,
// never changed in a read-only support session, and its sealed value is never selected by the store's own scope at all.
// `withScope` sets each caller kind's role: the test connection is a superuser, which would bypass row security.

let db: TestDatabase
let t: Tenants

const storeCaller = (partnerId: string, storeId: string, sellerScope: SellerScope = { kind: 'all' }): CallerContext => ({
  caller: { kind: 'person', userId: '00000000-0000-4000-8000-0000000000aa', sessionId: 's' },
  partnerId,
  storeId,
  sellerScope,
  subscription: 'active',
})
const shopper = (partnerId: string, storeId: string): CallerContext => ({ caller: { kind: 'shopper', customerId: null }, partnerId, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })
const support = (partnerId: string, storeId: string, access: 'read' | 'write'): CallerContext => ({
  caller: { kind: 'support', supportSessionId: 'ss', partnerUserId: 'pu', access },
  partnerId,
  storeId,
  sellerScope: { kind: 'all' },
  subscription: 'active',
})
const partnerUser = (partnerId: string): CallerContext => ({ caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId })
const staff: CallerContext = { caller: { kind: 'staff', staffId: 'st' } }

const by = '00000000-0000-4000-8000-0000000000aa'
const connect = (storeId: string, email: string) => (tx: Parameters<typeof saveCourierAccount>[0]) => saveCourierAccount(tx, { storeId, provider: 'shiprocket', email, channelId: '4321', sealed: 'v1.sealed', by, at: new Date() })

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  for (const [storeId, email] of [[t.storeA1, 'a1@example.com'], [t.storeA2, 'a2@example.com'], [t.storeB1, 'b1@example.com']] as const) {
    await db.sql`insert into courier_account (store_id, provider, email, credentials_sealed, connected_by) values (${storeId}, 'shiprocket', ${email}, 'v1.sealed', ${by})`
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const owner = () => storeCaller(t.partnerA, t.storeA1)
const emailsOf = (context: CallerContext) => withScope(db.sql, context, async (tx) => (await tx<{ email: string }[]>`select email from courier_account order by email`).map((r) => r.email))

describe('who reads a store’s courier login', () => {
  it('shows a store its own and no other store’s, a store of the same partner included, counts too', async () => {
    expect(await emailsOf(owner())).toEqual(['a1@example.com'])
    expect(await emailsOf(storeCaller(t.partnerA, t.storeA2))).toEqual(['a2@example.com'])
    expect(await emailsOf(storeCaller(t.partnerB, t.storeB1))).toEqual(['b1@example.com'])
    expect(await withScope(db.sql, owner(), async (tx) => Number((await tx<{ n: string }[]>`select count(*) as n from courier_account`)[0]?.n))).toBe(1)
    expect(await withScope(db.sql, owner(), (tx) => selectCourierAccounts(tx, t.storeA2))).toEqual([])
  })

  it('refuses a shopper, a supplier, a partner user and the platform outright (no grant at all)', async () => {
    await expect(emailsOf(shopper(t.partnerA, t.storeA1))).rejects.toThrow(/permission denied/)
    await expect(emailsOf(storeCaller(t.partnerA, t.storeA1, { kind: 'seller', sellerId: t.sellerA1First }))).rejects.toThrow(/permission denied/)
    await expect(emailsOf(partnerUser(t.partnerA))).rejects.toThrow(/permission denied/)
    await expect(emailsOf(staff)).rejects.toThrow(/permission denied/)
  })

  it('lets a read-only support session see who the login is, as the store would', async () => {
    expect(await emailsOf(support(t.partnerA, t.storeA1, 'read'))).toEqual(['a1@example.com'])
    expect(await emailsOf(support(t.partnerA, t.storeA2, 'read'))).toEqual(['a2@example.com'])
  })

  it('never lets a store’s own scope select the sealed login, by name or with *', async () => {
    await expect(withScope(db.sql, owner(), (tx) => tx`select credentials_sealed from courier_account`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, owner(), (tx) => tx`select * from courier_account`)).rejects.toThrow(/permission denied/)
  })

  it('lets system scope read the sealed login of the one store a call goes out for, and no store’s scope do it', async () => {
    expect((await withSystemScope(db.sql, (tx) => selectSealedCourierAccounts(tx, t.storeA1))).map((r) => [r.email, r.credentials_sealed])).toEqual([['a1@example.com', 'v1.sealed']])
    expect(await withSystemScope(db.sql, (tx) => selectSealedCourierAccounts(tx, t.storeB1))).toHaveLength(1)
  })
})

describe('who changes a store’s courier login', () => {
  it('lets a store connect and disconnect its own, and refuses a write for another store', async () => {
    await withScope(db.sql, storeCaller(t.partnerA, t.storeA2), async (tx) => {
      await connect(t.storeA2, 'a2-new@example.com')(tx)
      expect((await selectCourierAccounts(tx, t.storeA2)).map((r) => [r.email, r.channel_id])).toEqual([['a2-new@example.com', '4321']])
    })
    await expect(withScope(db.sql, owner(), connect(t.storeA2, 'stolen@example.com'))).rejects.toThrow()
    await expect(withScope(db.sql, owner(), connect(t.storeB1, 'stolen@example.com'))).rejects.toThrow()
    expect(await withScope(db.sql, owner(), (tx) => deleteCourierAccount(tx, t.storeA2, 'shiprocket'))).toBe(false)
    expect(await withScope(db.sql, owner(), (tx) => deleteCourierAccount(tx, t.storeB1, 'shiprocket'))).toBe(false)
    const [a2, b1] = await db.sql<{ email: string }[]>`select email from courier_account where store_id in (${t.storeA2}, ${t.storeB1}) order by email`
    expect([a2?.email, b1?.email]).toEqual(['a2-new@example.com', 'b1@example.com'])
  })

  it('refuses a read-only support session a write, and a shopper, a supplier, a partner user and the platform outright', async () => {
    const readOnly = support(t.partnerA, t.storeA1, 'read')
    await expect(withScope(db.sql, readOnly, connect(t.storeA1, 'x@example.com'))).rejects.toThrow(/row-level security/)
    expect(await withScope(db.sql, readOnly, (tx) => deleteCourierAccount(tx, t.storeA1, 'shiprocket'))).toBe(false)
    const supplier = storeCaller(t.partnerA, t.storeA1, { kind: 'seller', sellerId: t.sellerA1First })
    for (const context of [shopper(t.partnerA, t.storeA1), supplier, partnerUser(t.partnerA), staff]) {
      await expect(withScope(db.sql, context, connect(t.storeA1, 'x@example.com'))).rejects.toThrow(/permission denied/)
      await expect(withScope(db.sql, context, (tx) => deleteCourierAccount(tx, t.storeA1, 'shiprocket'))).rejects.toThrow(/permission denied/)
    }
    expect((await db.sql<{ email: string }[]>`select email from courier_account where store_id = ${t.storeA1}`).map((r) => r.email)).toEqual(['a1@example.com'])
  })

  it('refuses a provider the table does not hold, and an email that is not one', async () => {
    await expect(db.sql`insert into courier_account (store_id, provider, email, credentials_sealed, connected_by) values (${t.storeA1}, 'usps', 'a@example.com', 'v1.x', ${by})`).rejects.toThrow()
    await expect(db.sql`insert into courier_account (store_id, provider, email, credentials_sealed, connected_by) values (${t.storeA1}, 'shiprocket', 'a', 'v1.x', ${by})`).rejects.toThrow()
  })
})
