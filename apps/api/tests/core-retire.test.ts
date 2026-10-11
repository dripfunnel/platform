import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recordCoreRelease, selectImagesToDelete, selectSandboxImage, markImageDeleted } from '#db/scoped/coreReleases'
import { withSystemScope } from '#db/scoped/index'
import { imageBudget, keptImages, retireCoreImages } from '#saas/fleet/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #485 part 5: old core versions' studio images (storefront AI-STUDIO §9). The newest 20 always keep theirs; an
// older one is retired once no store needs it, after a forced rollout moved the stores still on it.

let db: TestDatabase
let t: Tenants
const image = (n: number) => `registry.cloudflare.com/acct123/storefront-build@sha256:${n.toString(16).padStart(64, '0')}`
const version = (minor: number) => `1.${minor}.0`

/** A store live on `v` through a build of its own. */
const liveOn = async (storeId: string, v: string) => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into publish_run (store_id, kind, state, commit, template, core_version, started_by_kind)
    values (${storeId}, 'design', 'live', ${'a'.repeat(40)}, 'linen', ${v}, 'system') returning id`
  await db.sql`update storefront set live_build_id = ${run?.id ?? ''} where store_id = ${storeId}`
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await withSystemScope(db.sql, async (tx) => {
    for (let minor = 0; minor < 23; minor += 1) await recordCoreRelease(tx, version(minor), image(minor + 1))
  })
  await liveOn(t.storeA1, version(0))
  await db.sql`insert into design_draft (store_id, head_commit, template, core_version) values (${t.storeA2}, ${'b'.repeat(40)}, 'linen', ${version(1)})`
  // A closed store's code needs no image.
  await liveOn(t.storeB1, version(2))
  await db.sql`update store set status = 'closed', closed_at = now() where id = ${t.storeB1}`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('the retirement of old core images', () => {
  it('retires an old version no store needs, and moves the stores still on old ones with a forced rollout first', async () => {
    expect(keptImages).toBeLessThan(imageBudget)
    const first = await retireCoreImages(db.sql, new Date())
    expect(first.retired).toEqual([version(2)])
    expect(first.kept).toBe(22)
    expect(await withSystemScope(db.sql, (tx) => selectSandboxImage(tx, version(2)))).toBeNull()
    expect(await withSystemScope(db.sql, (tx) => selectSandboxImage(tx, version(0)))).toBe(image(1))
    const [rollout] = await db.sql<{ version: string; started_by: string | null; state: string }[]>`select version, started_by, state from core_rollout where id = ${first.rolloutId ?? ''}`
    expect(rollout).toEqual({ version: version(22), started_by: null, state: 'canary' })
    const [entry] = await db.sql<{ actor_kind: string; reason: string }[]>`select actor_kind, reason from activity_log where target_id = ${first.rolloutId ?? ''}`
    expect(entry).toEqual({ actor_kind: 'job', reason: 'retire_images' })
    // One rollout at a time: the next day waits for it.
    expect((await retireCoreImages(db.sql, new Date())).rolloutId).toBeNull()
  })

  it('retires the rest once the stores moved, and the workflow deletes each image once', async () => {
    await db.sql`update core_rollout set state = 'done'`
    await liveOn(t.storeA1, version(22))
    await db.sql`update design_draft set core_version = ${version(22)} where store_id = ${t.storeA2}`
    const done = await retireCoreImages(db.sql, new Date())
    expect(done.retired.sort()).toEqual([version(0), version(1)])
    expect(done.rolloutId).toBeNull()
    expect(done.kept).toBe(20)
    expect(await withSystemScope(db.sql, selectImagesToDelete)).toEqual(expect.arrayContaining([version(0), version(1), version(2)]))
    await withSystemScope(db.sql, (tx) => markImageDeleted(tx, version(2), new Date()))
    expect(await withSystemScope(db.sql, selectImagesToDelete)).not.toContain(version(2))
    // The newest twenty are never retired, whatever uses them.
    expect(await db.sql`select 1 from core_release where retired_at is not null and string_to_array(version, '.')::int[] >= '{1,3,0}'::int[]`).toHaveLength(0)
  })
})
