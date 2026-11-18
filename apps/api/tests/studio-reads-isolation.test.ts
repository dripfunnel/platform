import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext, SellerScope } from '#core/tenancy'
import { selectLibraryImageByChecksum } from '#db/scoped/catalog'
import { selectRecentTurns } from '#db/scoped/design'
import { withScope } from '#db/scoped/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// The studio's reads of earlier turns and copied pictures (#1563): a store's own scope only (DATA-MODEL §5.3).

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
const partnerUser = (partnerId: string): CallerContext => ({ caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId })
const staff: CallerContext = { caller: { kind: 'staff', staffId: 'st' } }

const checksum = 'a'.repeat(64)
let imageA1 = ''

const turn = (storeId: string, text: string) => db.sql`insert into design_message (store_id, role, text, sample_url) values (${storeId}, 'user', ${text}, ${'https://example.com/'})`
const image = async (storeId: string, sellerId: string | null) =>
  (await db.sql<{ id: string }[]>`insert into asset (store_id, seller_id, r2_key, kind, mime, bytes, checksum) values (${storeId}, ${sellerId}, ${`stores/${storeId}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 1, ${checksum}) returning id`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await turn(t.storeA1, 'A1 asks for a site like this')
  await turn(t.storeB1, 'B1 asks for a site like this')
  imageA1 = await image(t.storeA1, null)
  await image(t.storeB1, null)
})

afterAll(async () => {
  await db.drop()
})

const turnsOf = (context: CallerContext, storeId: string) => withScope(db.sql, context, (tx) => selectRecentTurns(tx, storeId, 8)).then((rows) => rows.map((r) => r.text))
const imageOf = (context: CallerContext, storeId: string) => withScope(db.sql, context, (tx) => selectLibraryImageByChecksum(tx, storeId, checksum))

describe('the studio’s earlier turns', () => {
  it('are read by their own store only, never another store’s even when its id is passed', async () => {
    expect(await turnsOf(storeCaller(t.partnerA, t.storeA1), t.storeA1)).toEqual(['A1 asks for a site like this'])
    expect(await turnsOf(storeCaller(t.partnerA, t.storeA1), t.storeB1)).toEqual([])
    expect(await turnsOf(storeCaller(t.partnerB, t.storeB1), t.storeA1)).toEqual([])
  })

  it('refuses a supplier, a shopper, a partner user and the platform', async () => {
    const supplier = storeCaller(t.partnerA, t.storeA1, { kind: 'seller', sellerId: t.sellerA1First })
    for (const context of [supplier, shopper(t.partnerA, t.storeA1), partnerUser(t.partnerA), staff]) {
      await expect(turnsOf(context, t.storeA1)).rejects.toThrow(/permission denied/)
    }
  })
})

describe('a copied picture found by its bytes', () => {
  it('is found in its own store’s library only, never another store’s or a supplier’s', async () => {
    expect(await imageOf(storeCaller(t.partnerA, t.storeA1), t.storeA1)).toBe(imageA1)
    expect(await imageOf(storeCaller(t.partnerA, t.storeA1), t.storeB1)).toBeNull()
    expect(await imageOf(storeCaller(t.partnerB, t.storeB1), t.storeA1)).toBeNull()
    expect(await imageOf(storeCaller(t.partnerA, t.storeA1, { kind: 'seller', sellerId: t.sellerA1First }), t.storeA1)).toBeNull()
  })
})
