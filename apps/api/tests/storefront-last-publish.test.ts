import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'

// Card #682: `storefront.lastPublish`, which the Overview's rolled-back notice reads (FIRST-RELEASE §14): the store's
// newest finished design or catalogue publish, never a page render and never another store's.

let db: TestDatabase
let t: Tenants
let w: StoreWorld
let minute = 0
const at = () => new Date(Date.UTC(2026, 9, 13, 9, minute++))

interface Run {
  kind: string
  state: string
  error?: string
  switched?: Date
  attemptOf?: string
  storeId?: string
}

const run = async ({ kind, state, error, switched, attemptOf, storeId = t.storeA1 }: Run): Promise<string> => {
  const went = switched ?? (state === 'rolled_back' ? at() : null)
  const finished = at()
  const [row] = await db.sql<{ id: string }[]>`
    insert into publish_run (store_id, kind, state, commit, template, core_version, started_by_kind, error, switched_at, finished_at, rolled_back_at, attempt_of, attempt, render)
    values (${storeId}, ${kind}, ${state}, ${'c'.repeat(40)}, 'linen', '1.0.0', 'system', ${error ?? null}, ${went}, ${finished}, ${state === 'rolled_back' ? finished : null}, ${attemptOf ?? null},
      ${attemptOf ? 'repair' : null}, ${kind === 'page' ? db.sql.json({ pages: ['/'], drop: [] }) : null})
    returning id`
  return row?.id ?? ''
}

/** A publish that went live, numbered as switchLive numbers it: the version is stamped with the switch's time. */
const livePublish = async (kind: string, number: number, storeId = t.storeA1): Promise<string> => {
  const switched = at()
  const id = await run({ kind, state: 'live', switched, storeId })
  await db.sql`update design_version set state = 'kept' where store_id = ${storeId} and state = 'live'`
  await db.sql`insert into design_version (store_id, number, commit, template, core_version, build_id, published_at, state) values (${storeId}, ${number}, ${'c'.repeat(40)}, 'linen', '1.0.0', ${id}, ${switched}, 'live')`
  await db.sql`update storefront set live_build_id = ${id} where store_id = ${storeId}`
  return id
}

const lastPublish = async (who: Who) => {
  const read = await w.gql(who, '{ storefront { lastPublish { state error version finishedAt } } }')
  return read.code ?? (read.data?.['storefront'] as { lastPublish: unknown }).lastPublish
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, { now: () => new Date('2026-10-13T09:00:00.000Z'), secrets: null, lookup: null })
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('storefront.lastPublish', () => {
  it('is null before the first publish', async () => {
    expect(await lastPublish('owner')).toBeNull()
  })

  it('answers a live design publish with its version, and a later page render leaves it the last', async () => {
    const design = await livePublish('design', 4)
    expect(await lastPublish('owner')).toEqual({ state: 'live', error: null, version: 4, finishedAt: expect.any(String) })
    const page = await run({ kind: 'page', state: 'live', switched: at() })
    // A page render is the live version's own build again (LIVE-SHOP §7).
    await db.sql`update design_version set build_id = ${page} where build_id = ${design}`
    expect(await lastPublish('owner')).toMatchObject({ state: 'live', version: 4 })
    await run({ kind: 'page', state: 'rolled_back', error: 'check_home' })
    await run({ kind: 'staff', state: 'failed', error: 'deploy_failed' })
    expect(await lastPublish('manager')).toMatchObject({ state: 'live', version: 4 })
  })

  it('answers a rolled-back publish with its check, whose version was withdrawn, to the Owner and the Manager alike', async () => {
    await run({ kind: 'manual', state: 'rolled_back', error: 'check_checkout' })
    for (const who of ['owner', 'manager'] as const) expect(await lastPublish(who)).toEqual({ state: 'rolled_back', error: 'check_checkout', version: null, finishedAt: expect.any(String) })
  })

  it('reads rolled back when a repair’s build went live in the publish’s place and was put back', async () => {
    const root = await run({ kind: 'design', state: 'failed', error: 'check_cart' })
    await run({ kind: 'design', state: 'rolled_back', error: 'check_cart', attemptOf: root })
    expect(await lastPublish('owner')).toMatchObject({ state: 'rolled_back', error: 'check_cart', version: null })
  })

  it('answers a refused publish as failed, and is live again once a later publish goes live', async () => {
    await run({ kind: 'design', state: 'failed', error: 'gate_failed' })
    expect(await lastPublish('owner')).toMatchObject({ state: 'failed', error: 'gate_failed', version: null })
    await livePublish('automatic', 5)
    expect(await lastPublish('owner')).toMatchObject({ state: 'live', error: null, version: 5 })
  })

  it('never answers another store’s publish: each store reads its own, and Staff and suppliers are refused', async () => {
    await run({ kind: 'design', state: 'rolled_back', error: 'check_home', storeId: t.storeB1 })
    expect(await lastPublish('owner')).toMatchObject({ state: 'live', version: 5 })
    expect(await lastPublish('a2Owner')).toBeNull()
    expect(await lastPublish('bOwner')).toMatchObject({ state: 'rolled_back', error: 'check_home' })
    for (const who of ['staff', 'supplier'] as const) expect(await lastPublish(who)).toBe('FORBIDDEN')
  })
})
