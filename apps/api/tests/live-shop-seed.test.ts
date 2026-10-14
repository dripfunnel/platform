import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedLiveShop } from '../scripts/local/live-shop'
import { lookupLiveHost } from '#saas/storefronts/edge'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { fakeSites, type FakeSites } from './support/sites'

// #723: the local command that stands in for a publish, so a store's own address shows a page.
let db: TestDatabase
let t: Tenants
let sites: FakeSites
const core = '1.4.0'
const seedFor = (store: string, databaseUrl = db.url) => seedLiveShop({ databaseUrl, sites, store, core })
const livePointer = async (storeId: string) => (await db.sql<{ id: string | null }[]>`select live_build_id as id from storefront where store_id = ${storeId}`)[0]?.id ?? null
const runIds = async (storeId: string) => (await db.sql<{ id: string }[]>`select id from publish_run where store_id = ${storeId} order by id`).map((r) => r.id)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`
    insert into partner_domain (partner_id, kind, host, status, record_type, expected)
    values (${t.partnerA}, 'shops', '*.shops.a.localhost', 'live', 'CNAME', 'x')`
})
afterAll(async () => {
  await db.drop()
})

describe('seed:live-shop', () => {
  it('writes the site under the store’s own build folder and the host lookup finds it', async () => {
    sites = fakeSites()
    const live = await seedFor(t.storeA1)
    const folder = `stores/${t.storeA1}/builds/${live.buildId}/`
    expect(sites.keys('')).toEqual([`${folder}_edge.json`, `${folder}_manifest.json`, `${folder}index.html`])
    expect(await livePointer(t.storeA1)).toBe(live.buildId)
    expect(live.address).toBe('store-a1.shops.a.localhost')
    const [run] = await db.sql<{ state: string; commit: string }[]>`select state, commit from publish_run where id = ${live.buildId}`
    expect(run?.state).toBe('live')
    const host = await lookupLiveHost(db.sql, live.address ?? '', { localhost: true })
    expect(host).toMatchObject({ kind: 'store', storeId: t.storeA1, buildId: live.buildId })
  })

  it('takes a store’s code as well as its id', async () => {
    sites = fakeSites()
    const live = await seedFor('store-a1')
    expect(live.storeId).toBe(t.storeA1)
  })

  it('replaces its own earlier build and leaves other stores’ files and pointers alone', async () => {
    sites = fakeSites()
    const other = await seedFor(t.storeB1)
    const otherKeys = sites.keys(`stores/${t.storeB1}/`)
    const first = await seedFor(t.storeA1)
    const second = await seedFor(t.storeA1)
    expect(second.buildId).not.toBe(first.buildId)
    expect(sites.keys(`stores/${t.storeA1}/`).every((k) => k.startsWith(`stores/${t.storeA1}/builds/${second.buildId}/`))).toBe(true)
    expect(sites.keys(`stores/${t.storeA1}/`)).toHaveLength(3)
    expect(await runIds(t.storeA1)).toEqual([second.buildId])
    expect(await livePointer(t.storeA1)).toBe(second.buildId)
    expect(sites.keys(`stores/${t.storeB1}/`)).toEqual(otherKeys)
    expect(await livePointer(t.storeB1)).toBe(other.buildId)
    expect(await livePointer(t.storeA2)).toBeNull()
  })

  it('refuses a database that is not on this machine, before touching anything', async () => {
    sites = fakeSites()
    await expect(seedFor(t.storeA1, 'postgres://app@db.example.com:5432/platform')).rejects.toThrow(/non-local host/)
    expect(sites.keys('')).toEqual([])
  })

  it('refuses a code two partners share, writing nothing', async () => {
    sites = fakeSites()
    await db.sql`insert into store (partner_id, name, code) values (${t.partnerA}, 'Twin', 'twin'), (${t.partnerB}, 'Twin', 'twin')`
    const runsBefore = (await db.sql<{ n: number }[]>`select count(*)::int as n from publish_run`)[0]?.n
    await expect(seedFor('twin')).rejects.toThrow(/code of 2 stores/)
    expect(sites.keys('')).toEqual([])
    expect((await db.sql<{ n: number }[]>`select count(*)::int as n from publish_run`)[0]?.n).toBe(runsBefore)
  })

  it('names a store that is not there', async () => {
    sites = fakeSites()
    await expect(seedFor('no-such-store')).rejects.toThrow(/No store/)
    expect(sites.keys('')).toEqual([])
  })
})
