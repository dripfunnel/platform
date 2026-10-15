import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifyPassword } from '#auth/password'
import { resolvePortalPartner } from '#auth/storeCaller'
import { finishLocally, localHost } from '../scripts/seed/local'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// The seed's local finish (docs/setup/local.md §7): every partner's portal opens on a .localhost host, and SEED_PASSWORD signs seeded people in.

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, new Date('2026-10-06T09:00:00Z'))
})

afterAll(async () => {
  await db?.drop()
})

describe('the seed', () => {
  it('keeps the template gallery the migrations wrote through a second run, without the demo store it removed', async () => {
    const offered = () => db.sql<{ key: string }[]>`select key from storefront_template where state = 'offered' order by key`
    const before = await offered()
    expect(before.map((t) => t.key)).toEqual(['atelier', 'baseline', 'bloom', 'circuit', 'concrete', 'linen', 'market'])
    await db.sql`update storefront_template set demo_store_id = (select id from store limit 1) where key = 'linen'`
    await seed(db.url, new Date('2026-10-06T09:00:00Z'))
    expect(await offered()).toEqual(before)
    expect(await db.sql`select key from storefront_template where demo_store_id is not null`).toEqual([])
  })
})

describe('the local finish of the seed', () => {
  it('moves each partner’s addresses and their records to .localhost, so the portal host finds its partner', async () => {
    expect(localHost('store.northstar.example')).toBe('store.northstar.localhost')
    expect(localHost('*.shops.northstar.example')).toBe('*.shops.northstar.localhost')
    const northstar = (await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`)[0]?.id
    expect(await resolvePortalPartner(db.sql, 'store.northstar.localhost')).toBeNull()
    const done = await finishLocally(db.url, undefined)
    expect(done.passwords).toBe(0)
    expect(await resolvePortalPartner(db.sql, 'store.northstar.localhost')).toBe(northstar)
    expect(await db.sql`select 1 from partner_domain where host like '%.example'`).toEqual([])
    expect(await db.sql`select 1 from partner_domain_record where name like '%.example'`).toEqual([])
  })

  it('gives every active seeded person SEED_PASSWORD, and refuses one shorter than any password may be', async () => {
    await expect(finishLocally(db.url, 'short')).rejects.toThrow(/at least 10 characters/)
    const done = await finishLocally(db.url, 'local-seed-pass-1')
    expect(done.passwords).toBeGreaterThan(0)
    const [person] = await db.sql<{ password_hash: string }[]>`select password_hash from "user" where status = 'active' limit 1`
    const [partnerUser] = await db.sql<{ password_hash: string }[]>`select password_hash from partner_user where status = 'active' limit 1`
    expect(await verifyPassword('local-seed-pass-1', person?.password_hash ?? null)).toBe(true)
    expect(await verifyPassword('local-seed-pass-1', partnerUser?.password_hash ?? null)).toBe(true)
    expect(await db.sql`select 1 from "user" where status <> 'active' and password_hash is not null`).toEqual([])
  })

  it('refuses any database that isn’t on this machine', async () => {
    await expect(finishLocally('postgres://u:p@db.example.com:5432/x', undefined)).rejects.toThrow()
  })
})
